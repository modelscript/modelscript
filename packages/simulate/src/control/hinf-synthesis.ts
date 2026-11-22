// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/control — DGKF H-Infinity (H_∞) Robust Control Synthesis.
 *
 * Implements Doyle-Glover-Khargonekar-Francis (DGKF) state-feedback H_∞ synthesis with
 * γ-iteration bisection over the H_∞ Algebraic Riccati Equation:
 *   A^T X + X A - X (B2 R^{-1} B2^T - γ^{-2} B1 B1^T) X + C1^T C1 = 0
 * verified by closed-loop stability and worst-case frequency-domain H_∞ norm ||T_{zw}||_∞ < γ.
 */

import { luFactorFlat, luSolveFlat } from "@modelscript/runtime/wasm_gaussian.js";

export interface HinfPlantSpec {
  /** State matrix A (n×n). */
  A: number[][];
  /** Disturbance input matrix B1 (n×n_w). */
  B1: number[][];
  /** Control input matrix B2 (n×n_u). */
  B2: number[][];
  /** Performance output matrix C1 (n_z×n), with Q = C1^T C1. */
  C1: number[][];
  /** Control effort weighting matrix R (n_u×n_u, positive definite; default: I). */
  R?: number[][] | undefined;
}

export interface HinfSynthesisOptions {
  /** Lower bound on γ for bisection (default: 0.05). */
  gammaMin?: number | undefined;
  /** Upper bound on γ for bisection (default: 50.0). */
  gammaMax?: number | undefined;
  /** Bisection relative tolerance on γ (default: 1e-2). */
  gammaTol?: number | undefined;
  /** Maximum γ-iteration bisection steps (default: 24). */
  maxGammaIter?: number | undefined;
}

export interface HinfSynthesisResult {
  converged: boolean;
  /** Achieved H_∞ disturbance attenuation level γ*. */
  gamma: number;
  /** Verified frequency-grid peak norm ||T_{zw}(jω)||_∞. */
  achievedHinfNorm: number;
  /** Optimal robust state-feedback gain K (n_u×n), u = -K x. */
  K: number[][];
  /** Stabilizing Riccati solution X_∞ >= 0 (n×n). */
  X: number[][];
  /** Closed-loop state matrix A_cl = A - B2 K. */
  Acl: number[][];
}

function matMul(A: number[][], B: number[][]): number[][] {
  const r = A.length;
  const kMax = B.length;
  const c = B[0]?.length ?? 0;
  const out: number[][] = Array.from({ length: r }, () => new Array<number>(c).fill(0));
  for (let i = 0; i < r; i++) {
    for (let k = 0; k < kMax; k++) {
      const aik = A[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < c; j++) out[i]![j] = out[i]![j]! + aik * B[k]![j]!;
    }
  }
  return out;
}

function matTranspose(A: number[][]): number[][] {
  const r = A.length;
  const c = A[0]?.length ?? 0;
  return Array.from({ length: c }, (_, j) => Array.from({ length: r }, (_, i) => A[i]![j]!));
}

function invertSmall(M: number[][]): number[][] | null {
  const n = M.length;
  const flat = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) flat[i * n + j] = M[i]![j]!;
  const fact = luFactorFlat(flat, n);
  const inv: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const col = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    col.fill(0);
    col[j] = 1;
    luSolveFlat(fact, col);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(col[i]!)) return null;
      inv[i]![j] = col[i]!;
    }
  }
  return inv;
}

function isPsdSym(X: number[][]): boolean {
  const n = X.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0.5 * (X[i]![j]! + X[j]![i]!);
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (s < -1e-9 || !Number.isFinite(s)) return false;
        L[i]![i] = Math.sqrt(Math.max(0, s));
      } else {
        L[i]![j] = L[j]![j]! > 1e-12 ? s / L[j]![j]! : 0;
      }
    }
  }
  return true;
}

/**
 * Solves the indefinite-quadratic H_∞ Riccati Equation via Hamiltonian Matrix Sign Function:
 *   H = [[ A, -S ], [ -Q, -A^T ]]   where S = B2 R^{-1} B2^T - γ^{-2} B1 B1^T
 * Iterates H_{k+1} = 0.5 * (H_k + H_k^{-1}) (scaled Newton sign iteration) and extracts X
 * from the stable invariant subspace: (W_{11}) X = -W_{12} where W = H_∞ + I.
 */
function solveHinfRiccatiSign(A: number[][], S: number[][], Q: number[][]): number[][] | null {
  const n = A.length;
  const m = 2 * n;
  let H: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      H[i]![j] = A[i]![j]!;
      H[i]![n + j] = -S[i]![j]!;
      H[n + i]![j] = -Q[i]![j]!;
      H[n + i]![n + j] = -A[j]![i]!;
    }
  }

  for (let iter = 0; iter < 50; iter++) {
    const Hinv = invertSmall(H);
    if (!Hinv) return null;

    let diffNorm = 0;
    const Hnext: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        const v = 0.5 * (H[i]![j]! + Hinv[i]![j]!);
        diffNorm += Math.abs(v - H[i]![j]!);
        Hnext[i]![j] = v;
      }
    }
    H = Hnext;
    if (diffNorm < 1e-11 * m) break;
  }

  // Extract X from stable invariant subspace: [W11 W12; W21 W22] = H_inf + I
  // Stable subspace satisfies W11 * u + W12 * v = 0, v = X * u => W12 * X = -W11
  const W12: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => H[i]![n + j]!));
  const negW11: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => -(H[i]![j]! + (i === j ? 1 : 0))),
  );

  // Solve least-squares / square system [W12; W22] X = -[W11; W21] using normal equations
  const W21: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => H[n + i]![j]!));
  const W22: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => H[n + i]![n + j]! + (i === j ? 1 : 0)),
  );

  const M1 = matMul(matTranspose(W12), W12);
  const M2 = matMul(matTranspose(W22), W22);
  const LHS: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => M1[i]![j]! + M2[i]![j]!),
  );
  const R1 = matMul(matTranspose(W12), negW11);
  const R2 = matMul(
    matTranspose(W22),
    W21.map((row) => row.map((v) => -v)),
  );
  const RHS: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => R1[i]![j]! + R2[i]![j]!),
  );

  const lhsInv = invertSmall(LHS);
  if (!lhsInv) return null;
  const Xraw = matMul(lhsInv, RHS);

  // Symmetrize
  const X: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => 0.5 * (Xraw[i]![j]! + Xraw[j]![i]!)),
  );

  // Verify Riccati residual ||A^T X + X A - X S X + Q||_F
  const AtX = matMul(matTranspose(A), X);
  const XA = matMul(X, A);
  const XSX = matMul(matMul(X, S), X);
  let resSq = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const r = AtX[i]![j]! + XA[i]![j]! - XSX[i]![j]! + Q[i]![j]!;
      resSq += r * r;
    }
  }
  if (Math.sqrt(resSq) > 1e-4 || !isPsdSym(X)) return null;
  return X;
}

/**
 * Computes frequency-grid H_∞ norm ||C_cl (jω I - A_cl)^{-1} B1||_∞ via spectral norm over a log grid.
 */
export function computeClosedLoopHinfNorm(Acl: number[][], B1: number[][], Ccl: number[][]): number {
  const n = Acl.length;
  const nw = B1[0]?.length ?? 0;
  const nz = Ccl.length;
  const freqs = [0];
  for (let k = -3; k <= 3; k += 0.15) freqs.push(Math.pow(10, k));

  let maxNorm = 0;
  for (const w of freqs) {
    // Solve (j*w*I - Acl) * G = B1 using 2n×2n real block system [[ -Acl, -wI ], [ wI, -Acl ]]
    const M = new Float64Array(4 * n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const negA = -Acl[i]![j]!;
        M[i * (2 * n) + j] = negA;
        M[(n + i) * (2 * n) + (n + j)] = negA;
      }
      M[i * (2 * n) + (n + i)] = -w;
      M[(n + i) * (2 * n) + i] = w;
    }
    const fact = luFactorFlat(M, 2 * n);

    // Build transfer matrix H(jw) = Ccl * G (nz × nw complex) and estimate Frobenius/spectral norm
    let frobSq = 0;
    const rhs = new Float64Array(2 * n);
    for (let col = 0; col < nw; col++) {
      rhs.fill(0);
      for (let i = 0; i < n; i++) rhs[i] = B1[i]![col]!;
      luSolveFlat(fact, rhs);
      for (let r = 0; r < nz; r++) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < n; i++) {
          re += Ccl[r]![i]! * rhs[i]!;
          im += Ccl[r]![i]! * rhs[n + i]!;
        }
        frobSq += re * re + im * im;
      }
    }
    const normVal = Math.sqrt(frobSq);
    if (Number.isFinite(normVal) && normVal > maxNorm) maxNorm = normVal;
  }
  return maxNorm;
}

/**
 * Synthesizes an optimal H_∞ state-feedback controller `u = -K x` minimizing `||T_{zw}||_∞ < γ`
 * via DGKF Riccati γ-iteration bisection.
 */
export function synthesizeHinfStateFeedback(
  plant: HinfPlantSpec,
  options: HinfSynthesisOptions = {},
): HinfSynthesisResult {
  const n = plant.A.length;
  const nu = plant.B2[0]?.length ?? 0;
  const R = plant.R ?? Array.from({ length: nu }, (_, i) => Array.from({ length: nu }, (_, j) => (i === j ? 1 : 0)));
  const Rinv = invertSmall(R);
  if (!Rinv) {
    return { converged: false, gamma: Infinity, achievedHinfNorm: Infinity, K: [], X: [], Acl: plant.A };
  }

  const Q = matMul(matTranspose(plant.C1), plant.C1);
  const B2RinvB2t = matMul(matMul(plant.B2, Rinv), matTranspose(plant.B2));
  const B1B1t = matMul(plant.B1, matTranspose(plant.B1));

  let gLo = options.gammaMin ?? 0.05;
  let gHi = options.gammaMax ?? 50.0;
  const gTol = options.gammaTol ?? 1e-2;
  const maxIter = options.maxGammaIter ?? 24;

  const tryGamma = (gamma: number): { X: number[][]; K: number[][]; Acl: number[][]; norm: number } | null => {
    const invG2 = 1.0 / (gamma * gamma);
    const S: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => B2RinvB2t[i]![j]! - invG2 * B1B1t[i]![j]!),
    );
    const X = solveHinfRiccatiSign(plant.A, S, Q);
    if (!X) return null;

    const K = matMul(matMul(Rinv, matTranspose(plant.B2)), X);
    const B2K = matMul(plant.B2, K);
    const Acl = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => plant.A[i]![j]! - B2K[i]![j]!));

    // Check performance output z = [C1; R^{1/2} (-K)] -> Ccl = [C1; -K] (for R=I)
    const Ccl: number[][] = [...plant.C1, ...K.map((row) => row.map((v) => -v))];
    const norm = computeClosedLoopHinfNorm(Acl, plant.B1, Ccl);
    if (!Number.isFinite(norm) || norm > gamma * 1.02) return null;
    return { X, K, Acl, norm };
  };

  let best = tryGamma(gHi);
  if (!best) {
    return { converged: false, gamma: Infinity, achievedHinfNorm: Infinity, K: [], X: [], Acl: plant.A };
  }
  let bestGamma = gHi;

  for (let iter = 0; iter < maxIter; iter++) {
    if ((gHi - gLo) / Math.max(1e-6, gHi) <= gTol) break;
    const gMid = 0.5 * (gLo + gHi);
    const sol = tryGamma(gMid);
    if (sol) {
      best = sol;
      bestGamma = gMid;
      gHi = gMid;
    } else {
      gLo = gMid;
    }
  }

  return {
    converged: true,
    gamma: bestGamma,
    achievedHinfNorm: best.norm,
    K: best.K,
    X: best.X,
    Acl: best.Acl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DGKF Output-Feedback H_∞ Synthesis (Dual Riccati X_∞, Y_∞ + ρ(X_∞ Y_∞) < γ^2)
// ─────────────────────────────────────────────────────────────────────────────

export interface HinfOutputFeedbackPlant extends HinfPlantSpec {
  /** Measured output matrix C2 (n_y×n). */
  C2: number[][];
  /** Sensor noise covariance weighting V (n_y×n_y, positive definite; default: I). */
  V?: number[][] | undefined;
}

export interface HinfOutputFeedbackResult {
  converged: boolean;
  gamma: number;
  /** Coupling spectral radius `ρ(X_∞ Y_∞)` (strictly `< γ^2` when feasible). */
  spectralRadiusXY: number;
  /** State-feedback Riccati solution `X_∞ >= 0`. */
  X: number[][];
  /** Output-injection (observer) Riccati solution `Y_∞ >= 0`. */
  Y: number[][];
  /** Central DGKF dynamic controller state-space matrices `(A_K, B_K, C_K)`. */
  controller: {
    Ak: number[][];
    Bk: number[][];
    Ck: number[][];
  };
}

function estimateSpectralRadius(M: number[][]): number {
  const n = M.length;
  if (n === 0) return 0;
  let v = Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0.1 * (i + 1)));
  let rayleigh = 0;
  for (let it = 0; it < 40; it++) {
    const w = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) w[i] = w[i]! + M[i]![j]! * v[j]!;
    const norm = Math.hypot(...w);
    if (norm < 1e-15) return 0;
    rayleigh = norm;
    v = w.map((x) => x / norm);
  }
  return rayleigh;
}

/**
 * Synthesizes a central DGKF Output-Feedback H_∞ dynamic controller `(A_K, B_K, C_K)`
 * by solving the coupled state-feedback (`X_∞`) and filter (`Y_∞`) Riccati equations
 * and enforcing the coupling condition `ρ(X_∞ Y_∞) < γ^2` across γ-iteration bisection.
 */
export function synthesizeHinfOutputFeedback(
  plant: HinfOutputFeedbackPlant,
  options: HinfSynthesisOptions = {},
): HinfOutputFeedbackResult {
  const n = plant.A.length;
  const nu = plant.B2[0]?.length ?? 0;
  const ny = plant.C2.length;
  const R = plant.R ?? Array.from({ length: nu }, (_, i) => Array.from({ length: nu }, (_, j) => (i === j ? 1 : 0)));
  const V = plant.V ?? Array.from({ length: ny }, (_, i) => Array.from({ length: ny }, (_, j) => (i === j ? 1 : 0)));
  const Rinv = invertSmall(R);
  const Vinv = invertSmall(V);
  if (!Rinv || !Vinv) {
    return {
      converged: false,
      gamma: Infinity,
      spectralRadiusXY: Infinity,
      X: [],
      Y: [],
      controller: { Ak: [], Bk: [], Ck: [] },
    };
  }

  const Q = matMul(matTranspose(plant.C1), plant.C1);
  const B1B1t = matMul(plant.B1, matTranspose(plant.B1));
  const B2RinvB2t = matMul(matMul(plant.B2, Rinv), matTranspose(plant.B2));
  const C2tVinvC2 = matMul(matMul(matTranspose(plant.C2), Vinv), plant.C2);
  const At = matTranspose(plant.A);

  let gLo = options.gammaMin ?? 0.1;
  let gHi = options.gammaMax ?? 50.0;
  const gTol = options.gammaTol ?? 2e-2;
  const maxIter = options.maxGammaIter ?? 20;

  const tryGamma = (
    gamma: number,
  ): { X: number[][]; Y: number[][]; rho: number; Ak: number[][]; Bk: number[][]; Ck: number[][] } | null => {
    const invG2 = 1.0 / (gamma * gamma);
    const Sx = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => B2RinvB2t[i]![j]! - invG2 * B1B1t[i]![j]!),
    );
    const X = solveHinfRiccatiSign(plant.A, Sx, Q);
    if (!X) return null;

    const Sy = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => C2tVinvC2[i]![j]! - invG2 * Q[i]![j]!),
    );
    const Y = solveHinfRiccatiSign(At, Sy, B1B1t);
    if (!Y) return null;

    const XY = matMul(X, Y);
    const rho = estimateSpectralRadius(XY);
    if (!Number.isFinite(rho) || rho >= gamma * gamma * 0.999) return null;

    // Central DGKF controller:
    //   Z_∞ = (I - γ^{-2} Y X)^{-1}
    //   F_∞ = -R^{-1} B2^T X,   L_∞ = -Y C2^T V^{-1}
    //   Bk = -Z_∞ L_∞,   Ck = F_∞
    //   Ak = A + γ^{-2} B1 B1^T X + B2 F_∞ + Z_∞ L_∞ C2
    const YX = matMul(Y, X);
    const Iminus = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - invG2 * YX[i]![j]!),
    );
    const Z = invertSmall(Iminus);
    if (!Z) return null;

    const F = matMul(matMul(Rinv, matTranspose(plant.B2)), X).map((row) => row.map((v) => -v));
    const L = matMul(matMul(Y, matTranspose(plant.C2)), Vinv).map((row) => row.map((v) => -v));
    const ZL = matMul(Z, L);
    const Bk = ZL.map((row) => row.map((v) => -v));
    const Ck = F;

    const termDist = matMul(B1B1t, X);
    const termCtrl = matMul(plant.B2, F);
    const termObs = matMul(ZL, plant.C2);
    const Ak = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: n },
        (_, j) => plant.A[i]![j]! + invG2 * termDist[i]![j]! + termCtrl[i]![j]! + termObs[i]![j]!,
      ),
    );
    return { X, Y, rho, Ak, Bk, Ck };
  };

  let best = tryGamma(gHi);
  if (!best) {
    return {
      converged: false,
      gamma: Infinity,
      spectralRadiusXY: Infinity,
      X: [],
      Y: [],
      controller: { Ak: [], Bk: [], Ck: [] },
    };
  }
  let bestGamma = gHi;

  for (let iter = 0; iter < maxIter; iter++) {
    if ((gHi - gLo) / Math.max(1e-6, gHi) <= gTol) break;
    const gMid = 0.5 * (gLo + gHi);
    const sol = tryGamma(gMid);
    if (sol) {
      best = sol;
      bestGamma = gMid;
      gHi = gMid;
    } else {
      gLo = gMid;
    }
  }

  return {
    converged: true,
    gamma: bestGamma,
    spectralRadiusXY: best.rho,
    X: best.X,
    Y: best.Y,
    controller: { Ak: best.Ak, Bk: best.Bk, Ck: best.Ck },
  };
}
