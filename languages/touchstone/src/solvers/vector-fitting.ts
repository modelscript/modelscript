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
 * Perform rational macromodeling (Vector Fitting / pole-residue approximation)
 * on Touchstone frequency data to produce an equivalent continuous state-space model:
 * dx/dt = A*x + B*v
 * y     = C*x + D*v
 */
export function fitStateSpaceModel(deck: TouchstoneDeck, targetOrder = 2): StateSpaceModel {
  const numPorts = deck.numPorts;
  const order = Math.max(1, targetOrder);

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
  const poles: Complex[] = [];
  const logMin = Math.log10(2 * Math.PI * fMin);
  const logMax = Math.log10(2 * Math.PI * fMax);
  const step = order > 1 ? (logMax - logMin) / (order - 1) : 0;

  for (let k = 0; k < order; k++) {
    const omega = Math.pow(10, logMin + k * step);
    // Real negative stable pole with small damping ratio
    poles.push({ re: -0.1 * omega, im: omega });
  }

  // Compute direct transmission term D from high-frequency or last point
  const D: number[][] = [];
  const lastPt = deck.points[deck.points.length - 1];
  for (let i = 0; i < numPorts; i++) {
    D.push([]);
    for (let j = 0; j < numPorts; j++) {
      const sVal = lastPt?.matrix[i]?.[j];
      D[i]!.push(sVal ? sVal.re : i === j ? 0 : 0);
    }
  }

  // Compute residue matrices C_k using multi-frequency least-squares rational fitting
  // Solves Phi^H * Phi * c = Phi^H * H across all frequency points
  const points = deck.points;
  const numPts = points.length;

  const residues: Complex[][][] = [];
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

      // Build overdetermined basis Phi (numPts x order) and solve normal equations
      // A = Phi^H * Phi (order x order), b = Phi^H * H (order x 1)
      const A_re: number[][] = Array.from({ length: order }, () => new Array(order).fill(0));
      const A_im: number[][] = Array.from({ length: order }, () => new Array(order).fill(0));
      const b_re: number[] = new Array(order).fill(0);
      const b_im: number[] = new Array(order).fill(0);

      for (let m = 0; m < numPts; m++) {
        const pt = points[m]!;
        const omega = 2 * Math.PI * Math.max(1.0, pt.frequencyHz);
        const sVal = pt.matrix[i]?.[j] ?? { re: 0.0, im: 0.0 };
        const Hm_re = sVal.re - D[i]![j]!;
        const Hm_im = sVal.im;

        // Evaluate phi_k(s_m) = 1 / (j*omega - p_k)
        const phi_m: Complex[] = [];
        for (let k = 0; k < order; k++) {
          const denom_re = -poles[k]!.re;
          const denom_im = omega - poles[k]!.im;
          const denomMagSq = denom_re * denom_re + denom_im * denom_im || 1e-12;
          phi_m.push({
            re: denom_re / denomMagSq,
            im: -denom_im / denomMagSq,
          });
        }

        // Accumulate A = sum(phi_k^* * phi_l) and b = sum(phi_k^* * Hm)
        for (let k = 0; k < order; k++) {
          const pk_conj = cConj(phi_m[k]!);
          const bTerm = cMul(pk_conj, { re: Hm_re, im: Hm_im });
          b_re[k] = (b_re[k] ?? 0) + bTerm.re;
          b_im[k] = (b_im[k] ?? 0) + bTerm.im;

          for (let l = 0; l < order; l++) {
            const aTerm = cMul(pk_conj, phi_m[l]!);
            A_re[k]![l] = (A_re[k]![l] ?? 0) + aTerm.re;
            A_im[k]![l] = (A_im[k]![l] ?? 0) + aTerm.im;
          }
        }
      }

      // Add Tikhonov regularization to normal matrix diagonal for stability
      for (let k = 0; k < order; k++) {
        A_re[k]![k] = (A_re[k]![k] ?? 0) + 1e-6;
      }

      // Solve complex linear system A * c = b via Gaussian elimination with partial pivoting
      const sol = solveComplexLinearSystem(A_re, A_im, b_re, b_im, order);
      for (let k = 0; k < order; k++) {
        residues[i]![j]!.push(sol[k] ?? { re: 0.1, im: 0.0 });
      }
    }
  }

  // Assemble continuous-time state space matrices (A, B, C, D)
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

  // Populate block-diagonal A, B, and C
  for (let p = 0; p < numPorts; p++) {
    for (let k = 0; k < order; k++) {
      const stateIdx = p * order + k;
      A[stateIdx]![stateIdx] = poles[k]!.re;
      B[stateIdx]![p] = 1.0;
      C[p]![stateIdx] = residues[p]![p]![k]!.re;
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
  };
}
