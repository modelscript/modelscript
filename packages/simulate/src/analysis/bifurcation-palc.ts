// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Bifurcation Analysis & Pseudo-Arclength Continuation (PALC) Engine.
 *
 * Implements Keller's Pseudo-Arclength Continuation with bordered Newton-Raphson
 * correction, full QR eigenvalue spectrum tracking, and high-precision secant/bisection
 * localization of Saddle-Node (Fold / Limit Point) and Hopf bifurcations.
 *
 * Academic Citations:
 * - Keller, H. B. (1977). "Numerical solution of bifurcation and nonlinear eigenvalue problems."
 *   In Applications of Bifurcation Theory (pp. 359-384). Academic Press.
 * - Kuznetsov, Y. A. (2004). Elements of Applied Bifurcation Theory (3rd ed.).
 *   Applied Mathematical Sciences 112, Springer. https://doi.org/10.1007/978-1-4757-3978-7
 * - Govaerts, W. J. F. (2000). Numerical Methods for Bifurcations of Dynamical Equilibria.
 *   SIAM. https://doi.org/10.1137/1.9780898719543
 */

import { luFactor, luSolve } from "@modelscript/runtime/wasm_gaussian.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplexEigenvalue {
  re: number;
  im: number;
}

export interface BifurcationProblem {
  /** Equilibrium residual vector $F(x, p) = 0$. */
  f: (x: number[], p: number) => number[];
  /** Initial state guess $x_0 \in \mathbb{R}^n$. */
  x0: number[];
  /** Initial continuation parameter $p_0 \in \mathbb{R}$. */
  p0: number;
  /** Continuation parameter domain $[p_{\min}, p_{\max}]$. */
  pSpan: [number, number];
  /** Optional analytical state Jacobian $J_x(x, p) = \frac{\partial F}{\partial x} \in \mathbb{R}^{n \times n}$. */
  jacX?: ((x: number[], p: number) => number[][]) | undefined;
  /** Optional analytical parameter sensitivity $J_p(x, p) = \frac{\partial F}{\partial p} \in \mathbb{R}^n$. */
  jacP?: ((x: number[], p: number) => number[]) | undefined;
}

export interface PALCOptions {
  /** Initial arclength step size $\Delta s$ (default: 0.05). */
  ds?: number | undefined;
  /** Minimum arclength step size (default: 1e-5). */
  minDs?: number | undefined;
  /** Maximum arclength step size (default: 0.25). */
  maxDs?: number | undefined;
  /** Maximum continuation steps (default: 400). */
  maxSteps?: number | undefined;
  /** Newton corrector residual tolerance (default: 1e-9). */
  tol?: number | undefined;
  /** Maximum Newton corrector iterations per step (default: 12). */
  maxNewtonIter?: number | undefined;
  /** Initial parameter continuation direction (default: 1 if pSpan[1] >= p0 else -1). */
  initialDirection?: 1 | -1 | undefined;
  /** Locate exact Fold and Hopf bifurcation points via secant/bisection refinement (default: true). */
  detectBifurcations?: boolean | undefined;
}

export interface ContinuationPoint {
  /** Step index along the equilibrium branch. */
  step: number;
  /** Cumulative pseudo-arclength $s$. */
  s: number;
  /** Equilibrium state vector $x(s)$. */
  x: number[];
  /** Parameter value $p(s)$. */
  p: number;
  /** Unit tangent state component $\dot{x}(s)$. */
  tangentX: number[];
  /** Unit tangent parameter component $\dot{p}(s)$. */
  tangentP: number;
  /** Eigenvalues of $J_x(x, p)$ sorted by descending real part. */
  eigenvalues: ComplexEigenvalue[];
  /** True iff all eigenvalues have strictly negative real part ($\max_i \text{Re}(\lambda_i) < 0$). */
  stable: boolean;
  /** Count of eigenvalues in the open right-half complex plane ($\text{Re}(\lambda_i) > 0$). */
  nUnstable: number;
}

export interface BifurcationPoint {
  /** Bifurcation classification: `"fold"` (Saddle-Node / Limit Point) or `"hopf"` (Andronov-Hopf). */
  type: "fold" | "hopf";
  /** Pseudo-arclength coordinate $s^*$. */
  s: number;
  /** Critical state vector $x^*$. */
  x: number[];
  /** Critical parameter value $p^*$. */
  p: number;
  /** Jacobian eigenvalue spectrum at $(x^*, p^*)$. */
  eigenvalues: ComplexEigenvalue[];
  /** Critical oscillation frequency $\omega_0 = |\text{Im}(\lambda_{\text{crit}})| > 0$ for Hopf bifurcations. */
  hopfFrequency?: number | undefined;
}

export interface BifurcationDiagram {
  /** Computed equilibrium branch points. */
  branch: ContinuationPoint[];
  /** Detected and refined Fold and Hopf bifurcation points. */
  bifurcations: BifurcationPoint[];
  /** True if continuation completed cleanly. */
  converged: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eigenvalue Solver (Closed-Form 1x1, 2x2 + Upper Hessenberg Francis QR for NxN)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes all real and complex eigenvalues of an $n \times n$ row-major matrix $J$.
 * Returns eigenvalues sorted by descending real part.
 */
export function computeRealMatrixEigenvalues(J: Float64Array, n: number): ComplexEigenvalue[] {
  if (n === 0) return [];
  if (n === 1) {
    return [{ re: J[0]!, im: 0.0 }];
  }
  if (n === 2) {
    const tr = J[0]! + J[3]!;
    const det = J[0]! * J[3]! - J[1]! * J[2]!;
    const disc = tr * tr - 4.0 * det;
    if (disc >= 0.0) {
      const sq = Math.sqrt(disc);
      const l1 = 0.5 * (tr + sq);
      const l2 = 0.5 * (tr - sq);
      return l1 >= l2
        ? [
            { re: l1, im: 0.0 },
            { re: l2, im: 0.0 },
          ]
        : [
            { re: l2, im: 0.0 },
            { re: l1, im: 0.0 },
          ];
    } else {
      const re = 0.5 * tr;
      const im = 0.5 * Math.sqrt(-disc);
      return [
        { re, im },
        { re, im: -im },
      ];
    }
  }

  // Copy J for in-place Householder reduction to Upper Hessenberg form
  const H = new Float64Array(J);

  for (let k = 0; k < n - 2; k++) {
    let scale = 0.0;
    for (let i = k + 1; i < n; i++) {
      scale += Math.abs(H[i * n + k]!);
    }
    if (scale === 0.0) continue;

    const v = new Float64Array(n - (k + 1));
    let normSq = 0.0;
    for (let i = k + 1; i < n; i++) {
      const val = H[i * n + k]! / scale;
      v[i - (k + 1)] = val;
      normSq += val * val;
    }
    let norm = Math.sqrt(normSq);
    if (v[0]! >= 0.0) norm = -norm;
    v[0] = v[0]! - norm;
    const beta = 1.0 / (norm * (norm - H[(k + 1) * n + k]! / scale));

    // Left multiplication: H[k+1..n-1, k..n-1] -= beta * v * (v^T * H)
    for (let j = k; j < n; j++) {
      let dot = 0.0;
      for (let i = k + 1; i < n; i++) {
        dot += v[i - (k + 1)]! * H[i * n + j]!;
      }
      dot *= beta;
      for (let i = k + 1; i < n; i++) {
        H[i * n + j] = H[i * n + j]! - dot * v[i - (k + 1)]!;
      }
    }

    // Right multiplication: H[0..n-1, k+1..n-1] -= beta * (H * v) * v^T
    for (let i = 0; i < n; i++) {
      let dot = 0.0;
      for (let j = k + 1; j < n; j++) {
        dot += H[i * n + j]! * v[j - (k + 1)]!;
      }
      dot *= beta;
      for (let j = k + 1; j < n; j++) {
        H[i * n + j] = H[i * n + j]! - dot * v[j - (k + 1)]!;
      }
    }
  }

  // Shifted QR iteration on Upper Hessenberg H
  const eigs: ComplexEigenvalue[] = [];
  let m = n;
  let iter = 0;
  const maxIter = 100 * n;

  while (m > 0 && iter < maxIter) {
    iter++;
    if (m === 1) {
      eigs.push({ re: H[0]!, im: 0.0 });
      break;
    }

    const sub = Math.abs(H[(m - 1) * n + (m - 2)]!);
    const diagSum = Math.abs(H[(m - 2) * n + (m - 2)]!) + Math.abs(H[(m - 1) * n + (m - 1)]!);
    if (sub <= 1e-13 * Math.max(1.0, diagSum)) {
      eigs.push({ re: H[(m - 1) * n + (m - 1)]!, im: 0.0 });
      m--;
      continue;
    }

    // Check 2x2 trailing block deflation
    if (
      m === 2 ||
      Math.abs(H[(m - 2) * n + (m - 3)]!) <=
        1e-13 * Math.max(1.0, Math.abs(H[(m - 3) * n + (m - 3)]!) + Math.abs(H[(m - 2) * n + (m - 2)]!))
    ) {
      const a = H[(m - 2) * n + (m - 2)]!;
      const b = H[(m - 2) * n + (m - 1)]!;
      const c = H[(m - 1) * n + (m - 2)]!;
      const d = H[(m - 1) * n + (m - 1)]!;
      const pair = computeRealMatrixEigenvalues(new Float64Array([a, b, c, d]), 2);
      eigs.push(...pair);
      m -= 2;
      continue;
    }

    // Wilkinson shift from trailing 2x2 block
    const d = H[(m - 1) * n + (m - 1)]!;
    const shift = iter % 15 === 0 ? d + 0.75 * sub : d;

    for (let i = 0; i < m; i++) H[i * n + i] = H[i * n + i]! - shift;

    // QR step via Givens rotations on active m x m submatrix
    const cs = new Float64Array(m - 1);
    const sn = new Float64Array(m - 1);
    for (let i = 0; i < m - 1; i++) {
      const x = H[i * n + i]!;
      const y = H[(i + 1) * n + i]!;
      const r = Math.hypot(x, y);
      const c = r > 1e-16 ? x / r : 1.0;
      const s = r > 1e-16 ? y / r : 0.0;
      cs[i] = c;
      sn[i] = s;
      for (let j = i; j < m; j++) {
        const h1 = H[i * n + j]!;
        const h2 = H[(i + 1) * n + j]!;
        H[i * n + j] = c * h1 + s * h2;
        H[(i + 1) * n + j] = -s * h1 + c * h2;
      }
    }
    for (let j = 0; j < m - 1; j++) {
      const c = cs[j]!;
      const s = sn[j]!;
      for (let i = 0; i <= j + 1; i++) {
        const h1 = H[i * n + j]!;
        const h2 = H[i * n + (j + 1)]!;
        H[i * n + j] = c * h1 + s * h2;
        H[i * n + (j + 1)] = -s * h1 + c * h2;
      }
    }

    for (let i = 0; i < m; i++) H[i * n + i] = H[i * n + i]! + shift;
  }

  eigs.sort((a, b) => b.re - a.re);
  return eigs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivative & Bordered Linear Solver Helpers
// ─────────────────────────────────────────────────────────────────────────────

function evaluateJacobians(
  problem: BifurcationProblem,
  x: Float64Array,
  p: number,
  outJx: Float64Array,
  outJp: Float64Array,
): void {
  const n = x.length;
  const xArr = Array.from(x);

  if (problem.jacX) {
    const Jmat = problem.jacX(xArr, p);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        outJx[i * n + j] = Jmat[i]?.[j] ?? 0.0;
      }
    }
  } else {
    const epsBase = 1e-7;
    const xPert = [...xArr];
    for (let j = 0; j < n; j++) {
      const xj = xArr[j]!;
      const h = epsBase * Math.max(1.0, Math.abs(xj));
      xPert[j] = xj + h;
      const fp = problem.f(xPert, p);
      xPert[j] = xj - h;
      const fm = problem.f(xPert, p);
      xPert[j] = xj;
      const inv2h = 0.5 / h;
      for (let i = 0; i < n; i++) {
        outJx[i * n + j] = ((fp[i] ?? 0.0) - (fm[i] ?? 0.0)) * inv2h;
      }
    }
  }

  if (problem.jacP) {
    const jp = problem.jacP(xArr, p);
    for (let i = 0; i < n; i++) outJp[i] = jp[i] ?? 0.0;
  } else {
    const hp = 1e-7 * Math.max(1.0, Math.abs(p));
    const fp = problem.f(xArr, p + hp);
    const fm = problem.f(xArr, p - hp);
    const inv2h = 0.5 / hp;
    for (let i = 0; i < n; i++) {
      outJp[i] = ((fp[i] ?? 0.0) - (fm[i] ?? 0.0)) * inv2h;
    }
  }
}

/**
 * Computes unit tangent vector $(\dot{x}, \dot{p})$ satisfying:
 *   $J_x \dot{x} + J_p \dot{p} = 0$, $\|\dot{x}\|^2 + \dot{p}^2 = 1$,
 * and aligned positively with $(\tau_x, \tau_p)$.
 */
function computeUnitTangent(
  Jx: Float64Array,
  Jp: Float64Array,
  prevTx: Float64Array,
  prevTp: number,
  outTx: Float64Array,
): number {
  const n = Jp.length;
  const m = n + 1;
  const B = new Float64Array(m * m);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      B[i * m + j] = Jx[i * n + j]!;
    }
    B[i * m + n] = Jp[i]!;
  }
  for (let j = 0; j < n; j++) {
    B[n * m + j] = prevTx[j]!;
  }
  B[n * m + n] = prevTp;

  const rhs = new Float64Array(m);
  rhs[n] = 1.0;

  const fact = luFactor(B, m);
  luSolve(fact, rhs);

  let normSq = rhs[n]! * rhs[n]!;
  for (let i = 0; i < n; i++) normSq += rhs[i]! * rhs[i]!;
  const invNorm = 1.0 / Math.max(Math.sqrt(normSq), 1e-16);

  let dotPrev = rhs[n]! * invNorm * prevTp;
  for (let i = 0; i < n; i++) dotPrev += rhs[i]! * invNorm * prevTx[i]!;
  const sign = dotPrev >= 0.0 ? 1.0 : -1.0;

  for (let i = 0; i < n; i++) {
    outTx[i] = sign * rhs[i]! * invNorm;
  }
  return sign * rhs[n]! * invNorm;
}

/**
 * Performs bordered Pseudo-Arclength Newton correction from predictor $(x_{\text{pred}}, p_{\text{pred}})$
 * orthogonal to tangent $(\dot{x}_0, \dot{p}_0)$.
 */
function palcCorrectorStep(
  problem: BifurcationProblem,
  xPred: Float64Array,
  pPred: number,
  tx: Float64Array,
  tp: number,
  tol: number,
  maxIter: number,
): { converged: boolean; x: Float64Array; p: number; iter: number } {
  const n = xPred.length;
  const m = n + 1;
  const x = new Float64Array(xPred);
  let p = pPred;

  const Jx = new Float64Array(n * n);
  const Jp = new Float64Array(n);
  const B = new Float64Array(m * m);
  const rhs = new Float64Array(m);

  for (let iter = 0; iter < maxIter; iter++) {
    const fVal = problem.f(Array.from(x), p);
    let arcRes = (p - pPred) * tp;
    let maxRes = 0.0;
    for (let i = 0; i < n; i++) {
      const fi = fVal[i] ?? 0.0;
      rhs[i] = -fi;
      if (Math.abs(fi) > maxRes) maxRes = Math.abs(fi);
      arcRes += (x[i]! - xPred[i]!) * tx[i]!;
    }
    rhs[n] = -arcRes;
    if (Math.abs(arcRes) > maxRes) maxRes = Math.abs(arcRes);

    if (maxRes <= tol) {
      return { converged: true, x, p, iter };
    }

    evaluateJacobians(problem, x, p, Jx, Jp);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) B[i * m + j] = Jx[i * n + j]!;
      B[i * m + n] = Jp[i]!;
    }
    for (let j = 0; j < n; j++) B[n * m + j] = tx[j]!;
    B[n * m + n] = tp;

    try {
      const fact = luFactor(B, m);
      luSolve(fact, rhs);
    } catch {
      return { converged: false, x, p, iter };
    }

    let maxDelta = Math.abs(rhs[n]!);
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + rhs[i]!;
      if (Math.abs(rhs[i]!) > maxDelta) maxDelta = Math.abs(rhs[i]!);
    }
    p += rhs[n]!;

    if (maxDelta <= tol && maxRes <= tol * 10.0) {
      return { converged: true, x, p, iter: iter + 1 };
    }
  }

  return { converged: false, x, p, iter: maxIter };
}

/**
 * Extracts the real part and imaginary frequency of the leading complex conjugate pair
 * (closest to the imaginary axis with $|\text{Im}(\lambda)| > 10^{-4}$).
 */
function findHopfPairIndicator(eigs: ComplexEigenvalue[]): { re: number; freq: number } | null {
  let bestPair: { re: number; freq: number } | null = null;
  for (const eig of eigs) {
    if (eig.im > 1e-4) {
      if (!bestPair || Math.abs(eig.re) < Math.abs(bestPair.re)) {
        bestPair = { re: eig.re, freq: eig.im };
      }
    }
  }
  return bestPair;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pseudo-Arclength Continuation (PALC) Driver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traces an equilibrium branch $F(x, p) = 0$ over $p \in [p_{\min}, p_{\max}]$ using
 * Keller's Pseudo-Arclength Continuation (PALC), automatically traversing Saddle-Node
 * folds and localizing Fold and Hopf bifurcation points.
 */
export function continueEquilibriumPALC(problem: BifurcationProblem, options: PALCOptions = {}): BifurcationDiagram {
  const n = problem.x0.length;
  const [pMin, pMax] = problem.pSpan;
  const tol = options.tol ?? 1e-9;
  const maxNewtonIter = options.maxNewtonIter ?? 12;
  const maxSteps = options.maxSteps ?? 400;
  let ds = options.ds ?? 0.05;
  const minDs = options.minDs ?? 1e-5;
  const maxDs = options.maxDs ?? 0.25;
  const detectBifurcations = options.detectBifurcations ?? true;

  // Step 1: Polish initial equilibrium x0 at fixed p0 via standard Newton-Raphson
  const x = new Float64Array(problem.x0);
  let p = problem.p0;
  const Jx = new Float64Array(n * n);
  const Jp = new Float64Array(n);

  for (let iter = 0; iter < maxNewtonIter * 2; iter++) {
    const fVal = problem.f(Array.from(x), p);
    let maxR = 0.0;
    const rhs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const fi = fVal[i] ?? 0.0;
      rhs[i] = -fi;
      if (Math.abs(fi) > maxR) maxR = Math.abs(fi);
    }
    if (maxR <= tol) break;
    evaluateJacobians(problem, x, p, Jx, Jp);
    try {
      const fact = luFactor(new Float64Array(Jx), n);
      luSolve(fact, rhs);
      for (let i = 0; i < n; i++) x[i] = x[i]! + rhs[i]!;
    } catch {
      break;
    }
  }

  // Step 2: Compute initial unit tangent vector
  evaluateJacobians(problem, x, p, Jx, Jp);
  const initDir: number = options.initialDirection ?? (Math.abs(pMax - p) >= Math.abs(p - pMin) ? 1.0 : -1.0);
  const prevTx = new Float64Array(n);
  let prevTp = initDir;
  const tx = new Float64Array(n);
  let tp = computeUnitTangent(Jx, Jp, prevTx, prevTp, tx);
  prevTx.set(tx);
  prevTp = tp;

  const buildPoint = (
    stepIdx: number,
    sVal: number,
    xVec: Float64Array,
    pVal: number,
    tX: Float64Array,
    tP: number,
  ): ContinuationPoint => {
    evaluateJacobians(problem, xVec, pVal, Jx, Jp);
    const eigs = computeRealMatrixEigenvalues(Jx, n);
    let nUnstable = 0;
    for (const e of eigs) {
      if (e.re > 1e-9) nUnstable++;
    }
    return {
      step: stepIdx,
      s: sVal,
      x: Array.from(xVec),
      p: pVal,
      tangentX: Array.from(tX),
      tangentP: tP,
      eigenvalues: eigs,
      stable: nUnstable === 0 && (eigs[0]?.re ?? -1.0) < -1e-9,
      nUnstable,
    };
  };

  const branch: ContinuationPoint[] = [];
  const bifurcations: BifurcationPoint[] = [];

  let s = 0.0;
  let currPt = buildPoint(0, s, x, p, tx, tp);
  branch.push(currPt);

  // Step 3: Pseudo-arclength continuation loop
  for (let step = 1; step <= maxSteps; step++) {
    let accepted = false;
    let xNext: Float64Array<any> = new Float64Array(n);
    let pNext = p;
    let usedIter = 0;

    while (ds >= minDs) {
      const xPred = new Float64Array(n);
      for (let i = 0; i < n; i++) xPred[i] = x[i]! + ds * tx[i]!;
      const pPred = p + ds * tp;

      const corr = palcCorrectorStep(problem, xPred, pPred, tx, tp, tol, maxNewtonIter);
      if (corr.converged) {
        accepted = true;
        xNext = corr.x;
        pNext = corr.p;
        usedIter = corr.iter;
        break;
      }
      ds *= 0.5;
    }

    if (!accepted) {
      return { branch, bifurcations, converged: false };
    }

    const sNext = s + ds;
    evaluateJacobians(problem, xNext, pNext, Jx, Jp);
    const txNext = new Float64Array(n);
    const tpNext = computeUnitTangent(Jx, Jp, tx, tp, txNext);

    const nextPt = buildPoint(step, sNext, xNext, pNext, txNext, tpNext);

    // Step 4: Bifurcation Detection & Secant Localization between currPt and nextPt
    if (detectBifurcations) {
      // 4A. Fold (Saddle-Node) Test Function: psi_fold(s) = dot{p}(s) changes sign
      if ((currPt.tangentP > 1e-6 && nextPt.tangentP < -1e-6) || (currPt.tangentP < -1e-6 && nextPt.tangentP > 1e-6)) {
        // Refine Fold point via secant/bisection on sub-step arclength alpha in [0, ds]
        let aLo = 0.0;
        let aHi = ds;
        let tpLo = currPt.tangentP;
        let xFold: Float64Array<any> = new Float64Array(xNext);
        let pFold = pNext;

        for (let b = 0; b < 12; b++) {
          const frac = Math.max(0.1, Math.min(0.9, Math.abs(tpLo) / (Math.abs(tpLo) + Math.abs(nextPt.tangentP))));
          const aMid = b < 3 ? aLo + frac * (aHi - aLo) : 0.5 * (aLo + aHi);
          const xPredMid = new Float64Array(n);
          for (let i = 0; i < n; i++) xPredMid[i] = x[i]! + aMid * tx[i]!;
          const pPredMid = p + aMid * tp;

          const corrMid = palcCorrectorStep(problem, xPredMid, pPredMid, tx, tp, tol, maxNewtonIter);
          if (!corrMid.converged) break;

          xFold = corrMid.x;
          pFold = corrMid.p;
          evaluateJacobians(problem, xFold, pFold, Jx, Jp);
          const txMid = new Float64Array(n);
          const tpMid = computeUnitTangent(Jx, Jp, tx, tp, txMid);

          if (Math.abs(tpMid) < 1e-8) break;
          if ((tpLo > 0 && tpMid > 0) || (tpLo < 0 && tpMid < 0)) {
            aLo = aMid;
            tpLo = tpMid;
          } else {
            aHi = aMid;
          }
        }

        evaluateJacobians(problem, xFold, pFold, Jx, Jp);
        const foldEigs = computeRealMatrixEigenvalues(Jx, n);
        bifurcations.push({
          type: "fold",
          s: s + 0.5 * (aLo + aHi),
          x: Array.from(xFold),
          p: pFold,
          eigenvalues: foldEigs,
        });
      }

      // 4B. Hopf Bifurcation Test Function: complex pair real part crosses 0
      const hopfPrev = findHopfPairIndicator(currPt.eigenvalues);
      const hopfNext = findHopfPairIndicator(nextPt.eigenvalues);
      if (
        hopfPrev &&
        hopfNext &&
        ((hopfPrev.re < -1e-7 && hopfNext.re >= -1e-7) || (hopfPrev.re > 1e-7 && hopfNext.re <= 1e-7))
      ) {
        let aLo = 0.0;
        let aHi = ds;
        let reLo = hopfPrev.re;
        let xHopf: Float64Array<any> = new Float64Array(xNext);
        let pHopf = pNext;
        let freqHopf = 0.5 * (hopfPrev.freq + hopfNext.freq);
        let hopfEigs = nextPt.eigenvalues;

        for (let b = 0; b < 14; b++) {
          const aMid = 0.5 * (aLo + aHi);
          const xPredMid = new Float64Array(n);
          for (let i = 0; i < n; i++) xPredMid[i] = x[i]! + aMid * tx[i]!;
          const pPredMid = p + aMid * tp;

          const corrMid = palcCorrectorStep(problem, xPredMid, pPredMid, tx, tp, tol, maxNewtonIter);
          if (!corrMid.converged) break;

          xHopf = corrMid.x;
          pHopf = corrMid.p;
          evaluateJacobians(problem, xHopf, pHopf, Jx, Jp);
          hopfEigs = computeRealMatrixEigenvalues(Jx, n);
          const hMid = findHopfPairIndicator(hopfEigs);
          if (!hMid) break;
          freqHopf = hMid.freq;

          if (Math.abs(hMid.re) < 1e-9) break;
          if ((reLo < 0 && hMid.re < 0) || (reLo > 0 && hMid.re > 0)) {
            aLo = aMid;
            reLo = hMid.re;
          } else {
            aHi = aMid;
          }
        }

        bifurcations.push({
          type: "hopf",
          s: s + 0.5 * (aLo + aHi),
          x: Array.from(xHopf),
          p: pHopf,
          eigenvalues: hopfEigs,
          hopfFrequency: freqHopf,
        });
      }
    }

    branch.push(nextPt);

    // Advance state
    x.set(xNext);
    p = pNext;
    s = sNext;
    tx.set(txNext);
    tp = tpNext;
    currPt = nextPt;

    // Terminate if parameter exits [pMin, pMax] after at least 2 steps
    if (step >= 2 && (p < pMin - 1e-9 || p > pMax + 1e-9)) {
      break;
    }

    // Adaptive arclength step size control based on Newton iteration count
    if (usedIter <= 3) {
      ds = Math.min(maxDs, ds * 1.2);
    } else if (usedIter >= 7) {
      ds = Math.max(minDs, ds * 0.7);
    }
  }

  return {
    branch,
    bifurcations,
    converged: true,
  };
}

export type BifurcationContinuationResult = BifurcationDiagram;

/**
 * Convenience wrapper for `continueEquilibriumPALC` accepting flat `{ f, x0, p0, pMin, pMax, ds, maxSteps }` options.
 */
export function continueEquilibriumBranch(
  params: {
    f: (x: number[], p: number) => number[];
    x0: number[];
    p0: number;
    pMin?: number | undefined;
    pMax?: number | undefined;
    pSpan?: [number, number] | undefined;
  } & PALCOptions,
): BifurcationDiagram {
  const pSpan: [number, number] = params.pSpan ?? [params.pMin ?? -2.0, params.pMax ?? 2.0];
  return continueEquilibriumPALC(
    {
      f: params.f,
      x0: params.x0,
      p0: params.p0,
      pSpan,
    },
    params,
  );
}
