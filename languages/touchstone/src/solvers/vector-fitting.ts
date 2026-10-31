// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Complex, PassivityReport, PassivityViolation, StateSpaceModel, TouchstoneDeck } from "../types.js";

/**
 * Complex multiplication: a * b
 */
export function cMul(a: Complex, b: Complex): Complex {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  };
}

/**
 * Complex conjugate
 */
export function cConj(a: Complex): Complex {
  return { re: a.re, im: -a.im };
}

/**
 * Complex magnitude: |a|
 */
export function cMag(a: Complex): number {
  return Math.sqrt(a.re * a.re + a.im * a.im);
}

/**
 * Solves a small complex linear system A * x = b via Gaussian elimination with partial pivoting.
 */
function solveComplexLinearSystem(
  A_re: number[][],
  A_im: number[][],
  b_re: number[],
  b_im: number[],
  n: number,
): Complex[] {
  const aRe = A_re.map((row) => [...row]);
  const aIm = A_im.map((row) => [...row]);
  const xRe = [...b_re];
  const xIm = [...b_im];

  for (let k = 0; k < n; k++) {
    let maxMag = aRe[k]![k]! * aRe[k]![k]! + aIm[k]![k]! * aIm[k]![k]!;
    let pivotRow = k;
    for (let i = k + 1; i < n; i++) {
      const mag = aRe[i]![k]! * aRe[i]![k]! + aIm[i]![k]! * aIm[i]![k]!;
      if (mag > maxMag) {
        maxMag = mag;
        pivotRow = i;
      }
    }

    if (pivotRow !== k) {
      const tmpRe = aRe[k]!;
      aRe[k] = aRe[pivotRow]!;
      aRe[pivotRow] = tmpRe;

      const tmpIm = aIm[k]!;
      aIm[k] = aIm[pivotRow]!;
      aIm[pivotRow] = tmpIm;

      const tRe = xRe[k]!;
      xRe[k] = xRe[pivotRow]!;
      xRe[pivotRow] = tRe;

      const tIm = xIm[k]!;
      xIm[k] = xIm[pivotRow]!;
      xIm[pivotRow] = tIm;
    }

    const akk_re = aRe[k]![k]!;
    const akk_im = aIm[k]![k]!;
    const akkMagSq = akk_re * akk_re + akk_im * akk_im || 1e-12;

    for (let i = k + 1; i < n; i++) {
      const aik_re = aRe[i]![k]!;
      const aik_im = aIm[i]![k]!;
      const f_re = (aik_re * akk_re + aik_im * akk_im) / akkMagSq;
      const f_im = (aik_im * akk_re - aik_re * akk_im) / akkMagSq;

      for (let j = k; j < n; j++) {
        const akj_re = aRe[k]![j]!;
        const akj_im = aIm[k]![j]!;
        aRe[i]![j] = aRe[i]![j]! - (f_re * akj_re - f_im * akj_im);
        aIm[i]![j] = aIm[i]![j]! - (f_re * akj_im + f_im * akj_re);
      }

      xRe[i] = xRe[i]! - (f_re * xRe[k]! - f_im * xIm[k]!);
      xIm[i] = xIm[i]! - (f_re * xIm[k]! + f_im * xRe[k]!);
    }
  }

  const result: Complex[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sumRe = xRe[i]!;
    let sumIm = xIm[i]!;
    for (let j = i + 1; j < n; j++) {
      const aij_re = aRe[i]![j]!;
      const aij_im = aIm[i]![j]!;
      const rj = result[j]!;
      sumRe -= aij_re * rj.re - aij_im * rj.im;
      sumIm -= aij_re * rj.im + aij_im * rj.re;
    }
    const aii_re = aRe[i]![i]!;
    const aii_im = aIm[i]![i]!;
    const aiiMagSq = aii_re * aii_re + aii_im * aii_im || 1e-12;
    result[i] = {
      re: (sumRe * aii_re + sumIm * aii_im) / aiiMagSq,
      im: (sumIm * aii_re - sumRe * aii_im) / aiiMagSq,
    };
  }
  return result;
}

/**
 * Compute the maximum singular value (spectral norm) of an N x N complex matrix S.
 * Uses power iteration on M = S^H * S.
 */
export function computeMaxSingularValue(S: Complex[][], numPorts: number): number {
  if (numPorts === 1) {
    return cMag(S[0]![0]!);
  }

  // Construct flat M = S^H * S
  const mRe = new Float64Array(numPorts * numPorts);
  const mIm = new Float64Array(numPorts * numPorts);

  for (let i = 0; i < numPorts; i++) {
    const rowOffset = i * numPorts;
    for (let j = 0; j < numPorts; j++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let k = 0; k < numPorts; k++) {
        // S^H[i][k] * S[k][j] = conj(S[k][i]) * S[k][j]
        const ski = S[k]![i]!;
        const skj = S[k]![j]!;
        sumRe += ski.re * skj.re + ski.im * skj.im;
        sumIm += ski.re * skj.im - ski.im * skj.re;
      }
      mRe[rowOffset + j] = sumRe;
      mIm[rowOffset + j] = sumIm;
    }
  }

  // 2-Port analytical solution
  if (numPorts === 2) {
    const m00 = mRe[0]!;
    const m11 = mRe[3]!;
    const tr = m00 + m11;
    const m01_re = mRe[1]!;
    const m01_im = mIm[1]!;
    const m01_mag2 = m01_re * m01_re + m01_im * m01_im;
    const det = m00 * m11 - m01_mag2;
    const disc = Math.max(0, tr * tr - 4 * det);
    const lambdaMax = (tr + Math.sqrt(disc)) / 2;
    return Math.sqrt(Math.max(0, lambdaMax));
  }

  // Power iteration for N >= 3 using flat Float64Array buffers (zero heap allocations)
  const vRe = new Float64Array(numPorts);
  const vIm = new Float64Array(numPorts);
  const invSqrtN = 1.0 / Math.sqrt(numPorts);
  for (let i = 0; i < numPorts; i++) {
    vRe[i] = invSqrtN;
  }

  const wRe = new Float64Array(numPorts);
  const wIm = new Float64Array(numPorts);

  let eigenvalue = 1.0;
  const maxIters = 25;
  for (let iter = 0; iter < maxIters; iter++) {
    let normW = 0.0;
    for (let i = 0; i < numPorts; i++) {
      let sumRe = 0.0;
      let sumIm = 0.0;
      const rowOffset = i * numPorts;
      for (let j = 0; j < numPorts; j++) {
        const mijRe = mRe[rowOffset + j]!;
        const mijIm = mIm[rowOffset + j]!;
        const vjRe = vRe[j]!;
        const vjIm = vIm[j]!;
        sumRe += mijRe * vjRe - mijIm * vjIm;
        sumIm += mijRe * vjIm + mijIm * vjRe;
      }
      wRe[i] = sumRe;
      wIm[i] = sumIm;
      normW += sumRe * sumRe + sumIm * sumIm;
    }

    const magW = Math.sqrt(normW);
    if (magW < 1e-15) break;

    eigenvalue = magW;
    const invMag = 1.0 / magW;
    for (let i = 0; i < numPorts; i++) {
      vRe[i] = wRe[i]! * invMag;
      vIm[i] = wIm[i]! * invMag;
    }
  }

  return Math.sqrt(Math.max(0, eigenvalue));
}

/**
 * Verify passivity of a Touchstone deck across all frequency points.
 * A passive network satisfies ||S(f)||_2 <= 1.0 at every frequency point.
 */
export function verifyPassivity(deck: TouchstoneDeck, tolerance = 1e-4): PassivityReport {
  let maxNorm = 0;
  let worstFreqHz = 0;
  const violations: PassivityViolation[] = [];

  for (const pt of deck.points) {
    const norm = computeMaxSingularValue(pt.matrix, deck.numPorts);
    if (norm > maxNorm) {
      maxNorm = norm;
      worstFreqHz = pt.frequencyHz;
    }

    if (norm > 1.0 + tolerance) {
      violations.push({
        frequencyHz: pt.frequencyHz,
        norm,
        line: pt.line,
      });
    }
  }

  return {
    isPassive: violations.length === 0,
    maxNorm,
    worstFrequencyHz: worstFreqHz,
    violations,
  };
}

/**
 * Converts an N x N parameter matrix at a single frequency point into an admittance matrix Y (1/Ohm):
 * - For S-parameters: Y = G0 * (I - S) * (I + S)^(-1), where G0 = 1 / Z0
 * - For Z-parameters: Y = Z^(-1)
 * - For Y-parameters: Y = M
 */
export function convertMatrixToAdmittance(
  M: Complex[][],
  numPorts: number,
  z0: number,
  paramType: string,
): Complex[][] {
  if (paramType === "Y") {
    return M;
  }

  const g0 = 1.0 / Math.max(1e-6, z0);

  if (paramType === "Z") {
    const zRe: number[][] = Array.from({ length: numPorts }, (_, r) =>
      Array.from({ length: numPorts }, (__, c) => M[r]?.[c]?.re ?? (r === c ? z0 : 0)),
    );
    const zIm: number[][] = Array.from({ length: numPorts }, (_, r) =>
      Array.from({ length: numPorts }, (__, c) => M[r]?.[c]?.im ?? 0),
    );
    const Y: Complex[][] = Array.from({ length: numPorts }, () => new Array<Complex>(numPorts));
    for (let col = 0; col < numPorts; col++) {
      const bRe = new Array(numPorts).fill(0);
      const bIm = new Array(numPorts).fill(0);
      bRe[col] = 1.0;
      const colSol = solveComplexLinearSystem(zRe, zIm, bRe, bIm, numPorts);
      for (let row = 0; row < numPorts; row++) {
        Y[row]![col] = colSol[row] ?? { re: 0, im: 0 };
      }
    }
    return Y;
  }

  // Default S-parameters: solve (I + S^T) * Y^T = G0 * (I - S^T), or column-by-column (I + S) * x_j = G0 * (I - S)_j
  const ipS_re: number[][] = Array.from({ length: numPorts }, (_, r) =>
    Array.from({ length: numPorts }, (__, c) => (r === c ? 1.0 : 0.0) + (M[r]?.[c]?.re ?? 0.0)),
  );
  const ipS_im: number[][] = Array.from({ length: numPorts }, (_, r) =>
    Array.from({ length: numPorts }, (__, c) => M[r]?.[c]?.im ?? 0.0),
  );

  const Y: Complex[][] = Array.from({ length: numPorts }, () => new Array<Complex>(numPorts));
  for (let col = 0; col < numPorts; col++) {
    const bRe = new Array(numPorts).fill(0);
    const bIm = new Array(numPorts).fill(0);
    for (let row = 0; row < numPorts; row++) {
      const src = M[row]?.[col] ?? { re: 0, im: 0 };
      bRe[row] = g0 * ((row === col ? 1.0 : 0.0) - src.re);
      bIm[row] = -g0 * src.im;
    }
    const colSol = solveComplexLinearSystem(ipS_re, ipS_im, bRe, bIm, numPorts);
    for (let row = 0; row < numPorts; row++) {
      Y[row]![col] = colSol[row] ?? { re: 0, im: 0 };
    }
  }
  return Y;
}

export interface VectorFittingOptions {
  order?: number | undefined;
  iterations?: number | undefined;
  enforcePassivity?: boolean | undefined;
}

/**
 *Complex division: a / b
 */
function cDiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im || 1e-30;
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  };
}

/**
 * Evaluate monic numerator polynomial of sigma(s) = 1 + sum_{k=0}^{N-1} cTilde[k] / (s - poles[k]):
 * P(s) = prod_{j=0}^{N-1} (s - poles[j]) + sum_{k=0}^{N-1} cTilde[k] * prod_{j != k} (s - poles[j])
 */
function evalSigmaNumerator(s: Complex, poles: Complex[], cTilde: Complex[]): Complex {
  const N = poles.length;
  let prodAll: Complex = { re: 1.0, im: 0.0 };
  for (let j = 0; j < N; j++) {
    prodAll = cMul(prodAll, { re: s.re - poles[j]!.re, im: s.im - poles[j]!.im });
  }
  let sumTerms: Complex = { re: 0.0, im: 0.0 };
  for (let k = 0; k < N; k++) {
    let prodExcl: Complex = { re: 1.0, im: 0.0 };
    for (let j = 0; j < N; j++) {
      if (j === k) continue;
      prodExcl = cMul(prodExcl, { re: s.re - poles[j]!.re, im: s.im - poles[j]!.im });
    }
    const term = cMul(cTilde[k]!, prodExcl);
    sumTerms = { re: sumTerms.re + term.re, im: sumTerms.im + term.im };
  }
  return { re: prodAll.re + sumTerms.re, im: prodAll.im + sumTerms.im };
}

/**
 * Relocate poles by computing the zeros of sigma(s) = 1 + sum_k cTilde_k / (s - a_k)
 * using Durand-Kerner simultaneous root-finding, then enforcing left-half-plane stability
 * and conjugate symmetry.
 */
function computeRelocatedPoles(poles: Complex[], cTilde: Complex[]): Complex[] {
  const N = poles.length;
  // Check if cTilde is negligible (already converged)
  let maxCTilde = 0;
  for (let k = 0; k < N; k++) {
    const m = cMag(cTilde[k]!);
    if (m > maxCTilde) maxCTilde = m;
  }
  if (maxCTilde < 1e-12) {
    return poles.map((p) => ({ ...p }));
  }

  // Initial root guesses: z_k = a_k - cTilde_k (exact for N=1 and first-order perturbation for N>1)
  const roots: Complex[] = poles.map((p, k) => ({
    re: p.re - cTilde[k]!.re * 0.5,
    im: p.im - cTilde[k]!.im * 0.5 + (k + 1) * 1e-3,
  }));

  for (let iter = 0; iter < 25; iter++) {
    let maxStep = 0;
    for (let i = 0; i < N; i++) {
      const zi = roots[i]!;
      const pVal = evalSigmaNumerator(zi, poles, cTilde);
      let denom: Complex = { re: 1.0, im: 0.0 };
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const diff = { re: zi.re - roots[j]!.re, im: zi.im - roots[j]!.im };
        if (cMag(diff) < 1e-9) {
          diff.re += 1e-6;
          diff.im += 1e-6;
        }
        denom = cMul(denom, diff);
      }
      const delta = cDiv(pVal, denom);
      roots[i] = { re: zi.re - delta.re, im: zi.im - delta.im };
      const stepMag = cMag(delta);
      if (stepMag > maxStep) maxStep = stepMag;
    }
    if (maxStep < 1e-9) break;
  }

  // Enforce strict left-half-plane stability: reflect any Re(z) >= 0 into LHP
  for (let i = 0; i < N; i++) {
    const r = roots[i]!;
    if (!Number.isFinite(r.re) || !Number.isFinite(r.im)) {
      roots[i] = { ...poles[i]! };
      continue;
    }
    const minDamping = Math.max(1.0, 1e-3 * Math.abs(r.im));
    if (r.re >= -minDamping) {
      r.re = -Math.max(Math.abs(r.re), minDamping);
    }
  }

  // Sort by imaginary magnitude and pair complex-conjugate poles cleanly
  const paired: Complex[] = [];
  const used = new Array<boolean>(N).fill(false);

  for (let i = 0; i < N; i++) {
    if (used[i]) continue;
    const ri = roots[i]!;
    // Find closest conjugate candidate
    let bestJ = -1;
    let bestDist = Infinity;
    for (let j = i + 1; j < N; j++) {
      if (used[j]) continue;
      const rj = roots[j]!;
      const dist = Math.hypot(ri.re - rj.re, ri.im + rj.im);
      if (dist < bestDist) {
        bestDist = dist;
        bestJ = j;
      }
    }
    if (bestJ !== -1 && Math.abs(ri.im) > 1e-3 * Math.abs(ri.re)) {
      const rj = roots[bestJ]!;
      const reAvg = -Math.max(1.0, 0.5 * (Math.abs(ri.re) + Math.abs(rj.re)));
      const imAvg = Math.max(1.0, 0.5 * (Math.abs(ri.im) + Math.abs(rj.im)));
      paired.push({ re: reAvg, im: imAvg });
      paired.push({ re: reAvg, im: -imAvg });
      used[i] = true;
      used[bestJ] = true;
    } else {
      used[i] = true;
      paired.push({ re: -Math.max(1.0, Math.abs(ri.re)), im: 0.0 });
    }
  }

  return paired.slice(0, N);
}

/**
 * Evaluate the fitted rational admittance matrix Y_fit(s = j*2*pi*f) = D + sum_k C_k / (s - p_k).
 */
export function evaluateFittedAdmittance(
  poles: Complex[],
  residues: Complex[][][],
  D: number[][],
  numPorts: number,
  freqHz: number,
): Complex[][] {
  const omega = 2 * Math.PI * Math.max(0, freqHz);
  const order = poles.length;
  const Y: Complex[][] = Array.from({ length: numPorts }, (_, i) =>
    Array.from({ length: numPorts }, (__, j) => ({ re: D[i]?.[j] ?? 0, im: 0 })),
  );

  for (let i = 0; i < numPorts; i++) {
    for (let j = 0; j < numPorts; j++) {
      for (let k = 0; k < order; k++) {
        const pk = poles[k]!;
        const res = residues[i]?.[j]?.[k] ?? { re: 0, im: 0 };
        const denom: Complex = { re: -pk.re, im: omega - pk.im };
        const term = cDiv(res, denom);
        Y[i]![j]!.re += term.re;
        Y[i]![j]!.im += term.im;
      }
    }
  }
  return Y;
}

/**
 * Compute the minimum eigenvalue of the Hermitian real conductance matrix G = 0.5 * (Y + Y^H).
 */
export function computeMinConductanceEigenvalue(Y: Complex[][], numPorts: number): number {
  if (numPorts === 1) {
    return Y[0]?.[0]?.re ?? 0;
  }
  if (numPorts === 2) {
    const g00 = Y[0]![0]!.re;
    const g11 = Y[1]![1]!.re;
    // G_01 = 0.5 * (Y_01 + conj(Y_10))
    const g01_re = 0.5 * (Y[0]![1]!.re + Y[1]![0]!.re);
    const g01_im = 0.5 * (Y[0]![1]!.im - Y[1]![0]!.im);
    const tr = g00 + g11;
    const det = g00 * g11 - (g01_re * g01_re + g01_im * g01_im);
    const disc = Math.max(0, tr * tr - 4 * det);
    return 0.5 * (tr - Math.sqrt(disc));
  }
  // Gershgorin lower bound for N >= 3
  let minBound = Infinity;
  for (let i = 0; i < numPorts; i++) {
    const gii = Y[i]![i]!.re;
    let offDiag = 0;
    for (let j = 0; j < numPorts; j++) {
      if (i === j) continue;
      const gij_re = 0.5 * (Y[i]![j]!.re + Y[j]![i]!.re);
      const gij_im = 0.5 * (Y[i]![j]!.im - Y[j]![i]!.im);
      offDiag += Math.hypot(gij_re, gij_im);
    }
    if (gii - offDiag < minBound) {
      minBound = gii - offDiag;
    }
  }
  return minBound;
}

/**
 * Perform rational macromodeling (Gustavsen Iterative Vector Fitting with pole relocation
 * and passivity enforcement) on Touchstone frequency data to produce an equivalent
 * continuous state-space model:
 * dx/dt = A*x + B*v
 * i     = C*x + D*v
 */
export function fitStateSpaceModel(
  deck: TouchstoneDeck,
  targetOrder = 2,
  options?: VectorFittingOptions,
): StateSpaceModel {
  const numPorts = deck.numPorts;
  const order = Math.max(1, options?.order ?? targetOrder);
  const maxRelocIters = options?.iterations ?? 4;
  const enforcePassivity = options?.enforcePassivity ?? true;
  const z0 = deck.options.referenceResistance > 0 ? deck.options.referenceResistance : 50.0;
  const paramType = deck.options.parameterType ?? "S";

  // Pre-convert all frequency matrices to admittance Y(f) so i = C*x + D*v is physically consistent
  const yMatrices: Complex[][][] = deck.points.map((pt) =>
    convertMatrixToAdmittance(pt.matrix, numPorts, z0, paramType),
  );

  // Determine frequency bounds
  let fMin = 1e6;
  let fMax = 1e9;
  if (deck.points.length > 0) {
    fMin = deck.points[0]!.frequencyHz;
    fMax = deck.points[deck.points.length - 1]!.frequencyHz;
    if (fMin <= 0) fMin = 1e6;
    if (fMax <= fMin) fMax = fMin * 10;
  }

  // Generate logarithmically spaced stable starting poles in the left-half s-plane
  let poles: Complex[] = [];
  const logMin = Math.log10(2 * Math.PI * fMin);
  const logMax = Math.log10(2 * Math.PI * fMax);
  const numPairs = Math.floor(order / 2);
  const step = Math.max(1, numPairs) > 1 ? (logMax - logMin) / (numPairs - 1) : 0;

  for (let pIdx = 0; pIdx < numPairs; pIdx++) {
    const omega = Math.pow(10, logMin + pIdx * step);
    poles.push({ re: -0.1 * omega, im: omega });
    poles.push({ re: -0.1 * omega, im: -omega });
  }
  if (poles.length < order) {
    const omega = Math.pow(10, 0.5 * (logMin + logMax));
    poles.push({ re: -0.25 * omega, im: 0.0 });
  }

  const poleHistory: Complex[][] = [poles.map((p) => ({ ...p }))];
  const points = deck.points;
  const numPts = points.length;

  // Step 1: Iterative Sanathanan-Koerner / Gustavsen Pole Relocation
  // Uses trace admittance f(s_m) = (1/P) sum_p Y_{pp}(s_m) to relocate shared system poles
  let relocationIterations = 0;
  if (numPts >= 2 && maxRelocIters > 0) {
    const sysDim = 2 * order + 1; // [c_0..c_{N-1}, d, cTilde_0..cTilde_{N-1}]
    const omegaScale = 2 * Math.PI * Math.sqrt(fMin * fMax);

    for (let iter = 0; iter < maxRelocIters; iter++) {
      relocationIterations++;
      const A_re: number[][] = Array.from({ length: sysDim }, () => new Array(sysDim).fill(0));
      const A_im: number[][] = Array.from({ length: sysDim }, () => new Array(sysDim).fill(0));
      const b_re: number[] = new Array(sysDim).fill(0);
      const b_im: number[] = new Array(sysDim).fill(0);

      for (let m = 0; m < numPts; m++) {
        const omega = 2 * Math.PI * Math.max(1.0, points[m]!.frequencyHz);
        // Trace admittance f(s_m)
        let fRe = 0;
        let fIm = 0;
        for (let p = 0; p < numPorts; p++) {
          const ypp = yMatrices[m]?.[p]?.[p] ?? { re: 0, im: 0 };
          fRe += ypp.re / numPorts;
          fIm += ypp.im / numPorts;
        }
        const fVal: Complex = { re: fRe, im: fIm };

        // Row basis psi of length 2*order + 1 (scaled by omegaScale for conditioning):
        // [0..order-1]: omegaScale / (j*omega - p_k)
        // [order]: 1
        // [order+1..2*order]: -f(s_m) * omegaScale / (j*omega - p_k)
        const psi: Complex[] = new Array(sysDim);
        for (let k = 0; k < order; k++) {
          const denomRe = -poles[k]!.re;
          const denomIm = omega - poles[k]!.im;
          const denomSq = denomRe * denomRe + denomIm * denomIm || 1e-12;
          const phiScaled: Complex = {
            re: (omegaScale * denomRe) / denomSq,
            im: (-omegaScale * denomIm) / denomSq,
          };
          psi[k] = phiScaled;
          const negFPhi = cMul({ re: -fVal.re, im: -fVal.im }, phiScaled);
          psi[order + 1 + k] = negFPhi;
        }
        psi[order] = { re: 1.0, im: 0.0 };

        for (let r = 0; r < sysDim; r++) {
          const psiRConj = cConj(psi[r]!);
          const rhsTerm = cMul(psiRConj, fVal);
          b_re[r] = (b_re[r] ?? 0) + rhsTerm.re;
          b_im[r] = (b_im[r] ?? 0) + rhsTerm.im;
          for (let c = 0; c < sysDim; c++) {
            const prod = cMul(psiRConj, psi[c]!);
            A_re[r]![c] = (A_re[r]![c] ?? 0) + prod.re;
            A_im[r]![c] = (A_im[r]![c] ?? 0) + prod.im;
          }
        }
      }

      for (let r = 0; r < sysDim; r++) {
        A_re[r]![r] = (A_re[r]![r] ?? 0) + 1e-7;
      }

      const sol = solveComplexLinearSystem(A_re, A_im, b_re, b_im, sysDim);
      const cTilde: Complex[] = [];
      for (let k = 0; k < order; k++) {
        const raw = sol[order + 1 + k] ?? { re: 0, im: 0 };
        cTilde.push({ re: raw.re * omegaScale, im: raw.im * omegaScale });
      }

      poles = computeRelocatedPoles(poles, cTilde);
      poleHistory.push(poles.map((p) => ({ ...p })));
    }
  }

  // Step 2: Solve for direct feedthrough D and residue matrices C_k with the relocated poles
  const D: number[][] = Array.from({ length: numPorts }, (_, i) =>
    Array.from({ length: numPorts }, (__, j) => {
      const lastY = yMatrices[yMatrices.length - 1]?.[i]?.[j];
      return lastY ? lastY.re : i === j ? 1.0 / z0 : 0.0;
    }),
  );

  const residues: Complex[][][] = [];
  const omegaScale = 2 * Math.PI * Math.sqrt(fMin * fMax);

  for (let i = 0; i < numPorts; i++) {
    residues.push([]);
    for (let j = 0; j < numPorts; j++) {
      residues[i]!.push([]);

      if (numPts === 0) {
        for (let k = 0; k < order; k++) {
          residues[i]![j]!.push({ re: 0.1, im: 0.0 });
        }
        continue;
      }

      // Jointly fit [c_0..c_{order-1}, d_{ij}] for port pair (i, j)
      const fitDim = numPts >= order + 1 ? order + 1 : order;
      const A_re: number[][] = Array.from({ length: fitDim }, () => new Array(fitDim).fill(0));
      const A_im: number[][] = Array.from({ length: fitDim }, () => new Array(fitDim).fill(0));
      const b_re: number[] = new Array(fitDim).fill(0);
      const b_im: number[] = new Array(fitDim).fill(0);

      for (let m = 0; m < numPts; m++) {
        const pt = points[m]!;
        const omega = 2 * Math.PI * Math.max(1.0, pt.frequencyHz);
        const yVal = yMatrices[m]?.[i]?.[j] ?? { re: 0.0, im: 0.0 };
        const Hm_re = fitDim === order + 1 ? yVal.re : yVal.re - D[i]![j]!;
        const Hm_im = yVal.im;

        const phi_m: Complex[] = [];
        for (let k = 0; k < order; k++) {
          const denom_re = -poles[k]!.re;
          const denom_im = omega - poles[k]!.im;
          const denomMagSq = denom_re * denom_re + denom_im * denom_im || 1e-12;
          phi_m.push({
            re: (omegaScale * denom_re) / denomMagSq,
            im: (-omegaScale * denom_im) / denomMagSq,
          });
        }
        if (fitDim === order + 1) {
          phi_m.push({ re: 1.0, im: 0.0 });
        }

        for (let k = 0; k < fitDim; k++) {
          const pk_conj = cConj(phi_m[k]!);
          const bTerm = cMul(pk_conj, { re: Hm_re, im: Hm_im });
          b_re[k] = (b_re[k] ?? 0) + bTerm.re;
          b_im[k] = (b_im[k] ?? 0) + bTerm.im;

          for (let l = 0; l < fitDim; l++) {
            const aTerm = cMul(pk_conj, phi_m[l]!);
            A_re[k]![l] = (A_re[k]![l] ?? 0) + aTerm.re;
            A_im[k]![l] = (A_im[k]![l] ?? 0) + aTerm.im;
          }
        }
      }

      for (let k = 0; k < fitDim; k++) {
        A_re[k]![k] = (A_re[k]![k] ?? 0) + 1e-8;
      }

      const sol = solveComplexLinearSystem(A_re, A_im, b_re, b_im, fitDim);
      for (let k = 0; k < order; k++) {
        const s = sol[k] ?? { re: 0.1 / omegaScale, im: 0.0 };
        residues[i]![j]!.push({ re: s.re * omegaScale, im: s.im * omegaScale });
      }
      if (fitDim === order + 1 && sol[order]) {
        D[i]![j] = sol[order]!.re;
      }
    }
  }

  // Enforce conjugate-symmetric residues for complex-conjugate pole pairs so time-domain realization is strictly real
  for (let i = 0; i < numPorts; i++) {
    for (let j = 0; j < numPorts; j++) {
      let k = 0;
      while (k < order) {
        const pk = poles[k]!;
        if (k + 1 < order && Math.abs(pk.im) > 1e-9 && Math.abs(pk.im + poles[k + 1]!.im) < 1e-3) {
          const r1 = residues[i]![j]![k]!;
          const r2 = residues[i]![j]![k + 1]!;
          const reAvg = 0.5 * (r1.re + r2.re);
          const imAvg = 0.5 * (r1.im - r2.im);
          residues[i]![j]![k] = { re: reAvg, im: imAvg };
          residues[i]![j]![k + 1] = { re: reAvg, im: -imAvg };
          k += 2;
        } else {
          residues[i]![j]![k]!.im = 0.0;
          k += 1;
        }
      }
    }
  }

  // Step 3: Passivity Enforcement via Conductance Matrix Eigenvalue Perturbation
  // Check Re(Y_fit(j*omega)) >= 0 across sample frequencies and out-of-band frequencies
  const testFreqs: number[] = [0, fMin * 0.1, fMin * 0.5, ...points.map((p) => p.frequencyHz), fMax * 2, fMax * 10];
  let minEig = Infinity;
  for (const f of testFreqs) {
    const Yf = evaluateFittedAdmittance(poles, residues, D, numPorts, f);
    const eig = computeMinConductanceEigenvalue(Yf, numPorts);
    if (eig < minEig) minEig = eig;
  }

  if (enforcePassivity && minEig < 0) {
    // First ensure asymptotic high-frequency matrix D = 0.5*(D + D^T) is positive semi-definite
    const dEig = computeMinConductanceEigenvalue(
      D.map((row) => row.map((v) => ({ re: v, im: 0 }))),
      numPorts,
    );
    if (dEig < 1e-6) {
      const shiftD = Math.abs(dEig) + 1e-5;
      for (let p = 0; p < numPorts; p++) {
        D[p]![p] = (D[p]![p] ?? 0) + shiftD;
      }
    }

    // Recompute minEig across test frequencies and shift D diagonal by any remaining negative conductance
    minEig = Infinity;
    for (const f of testFreqs) {
      const Yf = evaluateFittedAdmittance(poles, residues, D, numPorts, f);
      const eig = computeMinConductanceEigenvalue(Yf, numPorts);
      if (eig < minEig) minEig = eig;
    }
    if (minEig < 0) {
      const deltaG = Math.abs(minEig) + 1e-6;
      for (let p = 0; p < numPorts; p++) {
        D[p]![p] = (D[p]![p] ?? 0) + deltaG;
      }
      minEig = 1e-6;
    }
  }

  // Compute RMS fitting error across sample points
  let sumSqErr = 0;
  let countTerms = 0;
  for (let m = 0; m < numPts; m++) {
    const Yfit = evaluateFittedAdmittance(poles, residues, D, numPorts, points[m]!.frequencyHz);
    for (let i = 0; i < numPorts; i++) {
      for (let j = 0; j < numPorts; j++) {
        const yExact = yMatrices[m]?.[i]?.[j] ?? { re: 0, im: 0 };
        const diffRe = Yfit[i]![j]!.re - yExact.re;
        const diffIm = Yfit[i]![j]!.im - yExact.im;
        sumSqErr += diffRe * diffRe + diffIm * diffIm;
        countTerms++;
      }
    }
  }
  const rmsError = countTerms > 0 ? Math.sqrt(sumSqErr / countTerms) : 0;

  // Assemble continuous-time real state space matrices (A, B, C, D)
  // State dimension: totalStates = order * numPorts
  const totalStates = order * numPorts;
  const A: number[][] = [];
  const B: number[][] = [];
  const C: number[][] = [];

  for (let i = 0; i < totalStates; i++) {
    A.push(new Array(totalStates).fill(0));
    B.push(new Array(numPorts).fill(0));
  }
  for (let i = 0; i < numPorts; i++) {
    C.push(new Array(totalStates).fill(0));
  }

  // Populate 2x2 real companion blocks for complex-conjugate pole pairs and full cross-port C residues
  for (let q = 0; q < numPorts; q++) {
    let k = 0;
    while (k < order) {
      const stateIdx = q * order + k;
      const pk = poles[k]!;
      if (k + 1 < order && Math.abs(pk.im) > 1e-9 && Math.abs(pk.im + poles[k + 1]!.im) < 1e-3) {
        // 2x2 real block for complex-conjugate pole pair (sigma +/- j*omega)
        A[stateIdx]![stateIdx] = pk.re;
        A[stateIdx]![stateIdx + 1] = pk.im;
        A[stateIdx + 1]![stateIdx] = -pk.im;
        A[stateIdx + 1]![stateIdx + 1] = pk.re;

        B[stateIdx]![q] = 2.0;
        B[stateIdx + 1]![q] = 0.0;

        for (let p = 0; p < numPorts; p++) {
          const res = residues[p]![q]![k]!;
          C[p]![stateIdx] = res.re;
          C[p]![stateIdx + 1] = -res.im;
        }
        k += 2;
      } else {
        // Real pole
        A[stateIdx]![stateIdx] = pk.re;
        B[stateIdx]![q] = 1.0;
        for (let p = 0; p < numPorts; p++) {
          C[p]![stateIdx] = residues[p]![q]![k]!.re;
        }
        k += 1;
      }
    }
  }

  return {
    order,
    numPorts,
    A,
    B,
    C,
    D,
    poles,
    residues,
    relocationIterations,
    poleHistory,
    isPassive: minEig >= -1e-9,
    minConductanceEigenvalue: minEig,
    rmsError,
  };
}

/**
 * Alias for `fitStateSpaceModel` supporting Vector Fitting options.
 */
export const fitVectorModel = fitStateSpaceModel;
