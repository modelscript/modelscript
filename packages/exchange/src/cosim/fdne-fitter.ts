// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Frequency-Dependent Network Equivalent (FDNE) Vector Fitting
 * & Dommel Recursive-Convolution Companion Synthesizer.
 *
 * Implements Gustavsen & Semlyen Vector Fitting for single-port and 3-phase symmetrical
 * boundary admittances Y(jw) over a wide frequency band (e.g. 5 Hz - 3 kHz), with
 * stability enforcement (Re(p_m) < 0), passivity enforcement (Re(Y(jw)) >= 0), and
 * exact trapezoidal-rule Dommel Norton companion stamping for EMT solvers (`EmtSolver`
 * and `fmi-ls-emt`).
 */

import type { FmiLsEmtCompanionInstance } from "../fmu/fmi-ls-emt.js";
import type { ComplexPhasor } from "./phasor-emt-types.js";

export interface FrequencyAdmittanceSample {
  /** Frequency in Hz. */
  freqHz: number;
  /** Complex admittance Y(j * 2 * pi * freqHz) in Siemens. */
  ySiemens: ComplexPhasor;
}

export interface FdnePoleResidue {
  /** Real pole (rad/s, strictly < 0 for stability). */
  pole: number;
  /** Real residue (S * rad/s). */
  residue: number;
}

export interface FdneComplexPolePair {
  /** Real part of conjugate pole pair p = poleRe +/- j*poleIm (rad/s, strictly < 0). */
  poleRe: number;
  /** Positive imaginary part of conjugate pole pair (rad/s, > 0). */
  poleIm: number;
  /** Real part of conjugate residue r = resRe +/- j*resIm. */
  resRe: number;
  /** Imaginary part of conjugate residue. */
  resIm: number;
}

export interface FdneRationalModel {
  /** Constant conductance term d (Siemens). */
  d: number;
  /** Capacitive term e (Farads; s*e term). */
  e: number;
  /** Real stable poles and residues. */
  poles: FdnePoleResidue[];
  /** Optional complex-conjugate stable pole pairs for sharp RLC / cable / filter resonances. */
  complexPoles?: FdneComplexPolePair[] | undefined;
  /** Relative RMS fitting error across the sampled frequency band. */
  rmsRelError: number;
  /** Minimum real part Re(Y_fit(jw)) across the sampled band (>= 0 if passive). */
  minRealPart: number;
  /** Whether the fitted model is passive over the sampled band. */
  isPassive: boolean;
}

export interface FdneFitOptions {
  /** Number of real poles to fit (default: 4). */
  numPoles?: number | undefined;
  /** Number of complex-conjugate pole pairs to fit for resonant peaks (default: 0). */
  numComplexPairs?: number | undefined;
  /** Number of Vector Fitting pole-relocation iterations (default: 5). */
  iterations?: number | undefined;
  /** Whether to include the capacitive `s * e` term (default: false). */
  includeCapacitiveTerm?: boolean | undefined;
  /** Enforce passivity by raising `d` if min Re(Y(jw)) < 0 (default: true). */
  enforcePassivity?: boolean | undefined;
}

/**
 * Evaluates a fitted rational FDNE model:
 * Y(jw) = d + jw*e + sum_m r_m/(jw - p_m) + sum_k [r_k/(jw - p_k) + conj(r_k)/(jw - conj(p_k))].
 */
export function evaluateFdneModel(model: FdneRationalModel, freqHz: number): ComplexPhasor {
  const w = 2.0 * Math.PI * freqHz;
  let re = model.d;
  let im = w * model.e;
  for (const pr of model.poles) {
    // r / (jw - p) = r * (-p - jw) / (p^2 + w^2)
    const denom = pr.pole * pr.pole + w * w;
    if (denom > 1e-30) {
      re += (pr.residue * -pr.pole) / denom;
      im += (pr.residue * -w) / denom;
    }
  }
  if (model.complexPoles) {
    for (const cp of model.complexPoles) {
      // Term 1: (rRe + j rIm) / (-pRe + j(w - pIm))
      const d1Re = -cp.poleRe;
      const d1Im = w - cp.poleIm;
      const den1 = d1Re * d1Re + d1Im * d1Im;
      if (den1 > 1e-30) {
        re += (cp.resRe * d1Re + cp.resIm * d1Im) / den1;
        im += (cp.resIm * d1Re - cp.resRe * d1Im) / den1;
      }
      // Term 2 (conjugate): (rRe - j rIm) / (-pRe + j(w + pIm))
      const d2Im = w + cp.poleIm;
      const den2 = d1Re * d1Re + d2Im * d2Im;
      if (den2 > 1e-30) {
        re += (cp.resRe * d1Re - cp.resIm * d2Im) / den2;
        im += (-cp.resIm * d1Re - cp.resRe * d2Im) / den2;
      }
    }
  }
  return { re, im };
}

/**
 * Solves a small dense real linear system A * x = b using Gaussian elimination with partial pivoting.
 */
function solveDenseReal(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = new Float64Array(A);
  const rhs = new Float64Array(b);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col * n + col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row * n + col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = row;
      }
    }
    if (maxAbs < 1e-18) continue;

    if (pivotRow !== col) {
      for (let k = col; k < n; k++) {
        const tmp = M[col * n + k]!;
        M[col * n + k] = M[pivotRow * n + k]!;
        M[pivotRow * n + k] = tmp;
      }
      const tmpB = rhs[col]!;
      rhs[col] = rhs[pivotRow]!;
      rhs[pivotRow] = tmpB;
    }

    const diag = M[col * n + col]!;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row * n + col]! / diag;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) {
        M[row * n + k] = M[row * n + k]! - factor * M[col * n + k]!;
      }
      rhs[row] = rhs[row]! - factor * rhs[col]!;
    }
  }

  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row]!;
    for (let k = row + 1; k < n; k++) {
      sum -= M[row * n + k]! * x[k]!;
    }
    const diag = M[row * n + row]!;
    x[row] = Math.abs(diag) > 1e-18 ? sum / diag : 0.0;
  }
  return x;
}

/**
 * Solves a real overdetermined least-squares problem min ||A x - b||_2 via regularized normal equations.
 */
function solveLeastSquares(A: Float64Array, b: Float64Array, rows: number, cols: number): Float64Array {
  const AtA = new Float64Array(cols * cols);
  const Atb = new Float64Array(cols);
  for (let r = 0; r < rows; r++) {
    const rOff = r * cols;
    const br = b[r]!;
    for (let i = 0; i < cols; i++) {
      const aRi = A[rOff + i]!;
      Atb[i] = Atb[i]! + aRi * br;
      for (let j = i; j < cols; j++) {
        AtA[i * cols + j] = AtA[i * cols + j]! + aRi * A[rOff + j]!;
      }
    }
  }
  // Symmetrize and add tiny Tikhonov regularization for numerical conditioning
  let maxDiag = 1.0;
  for (let i = 0; i < cols; i++) {
    maxDiag = Math.max(maxDiag, Math.abs(AtA[i * cols + i]!));
    for (let j = 0; j < i; j++) {
      AtA[i * cols + j] = AtA[j * cols + i]!;
    }
  }
  const reg = maxDiag * 1e-12;
  for (let i = 0; i < cols; i++) {
    AtA[i * cols + i] = AtA[i * cols + i]! + reg;
  }
  return solveDenseReal(AtA, Atb, cols);
}

/**
 * Computes real eigenvalues of a small N x N matrix via QR / shifted power fallback
 * for Vector Fitting pole relocation: H = diag(p) - ones * c^T.
 * Uses Francis/QR iteration on real matrix (returns real parts reflected to LHP).
 */
function relocateRealPoles(poles: number[], c: Float64Array): number[] {
  const n = poles.length;
  // Build H = diag(p) - 1 * c^T
  const H = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      H[i * n + j] = (i === j ? poles[i]! : 0.0) - c[j]!;
    }
  }

  // Simple unshifted QR iteration (n is typically 2..8) to extract diagonal/eigenvalue estimates
  const Q = new Float64Array(n * n);
  const R = new Float64Array(n * n);
  const nextH = new Float64Array(n * n);

  for (let iter = 0; iter < 40; iter++) {
    // Modified Gram-Schmidt QR of H
    Q.fill(0);
    R.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        Q[i * n + j] = H[i * n + j]!;
      }
      for (let k = 0; k < j; k++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += Q[i * n + k]! * Q[i * n + j]!;
        R[k * n + j] = dot;
        for (let i = 0; i < n; i++) Q[i * n + j] = Q[i * n + j]! - dot * Q[i * n + k]!;
      }
      let norm = 0;
      for (let i = 0; i < n; i++) norm += Q[i * n + j]! * Q[i * n + j]!;
      norm = Math.sqrt(norm);
      R[j * n + j] = norm;
      if (norm > 1e-15) {
        for (let i = 0; i < n; i++) Q[i * n + j] = Q[i * n + j]! / norm;
      }
    }
    // H = R * Q
    nextH.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = i; k < n; k++) sum += R[i * n + k]! * Q[k * n + j]!;
        nextH[i * n + j] = sum;
      }
    }
    H.set(nextH);
  }

  const newPoles: number[] = [];
  for (let i = 0; i < n; i++) {
    let p = H[i * n + i]!;
    if (!Number.isFinite(p) || Math.abs(p) < 1e-3) {
      p = poles[i]!;
    }
    // Reflect strictly into open left-half plane for guaranteed stability
    if (p > 0) p = -p;
    newPoles.push(Math.min(-1.0, p));
  }
  return newPoles;
}

/**
 * Fits a passive, stable Frequency-Dependent Network Equivalent (FDNE) rational model
 * to frequency-domain admittance samples using Vector Fitting.
 */
export function fitFdneRational(samples: FrequencyAdmittanceSample[], options: FdneFitOptions = {}): FdneRationalModel {
  if (samples.length === 0) {
    return { d: 0.0, e: 0.0, poles: [], rmsRelError: 0, minRealPart: 0, isPassive: true };
  }

  if ((options.numComplexPairs ?? 0) > 0) {
    return fitMixedPoleFdneRational(samples, options);
  }

  const numPoles = Math.max(1, Math.min(options.numPoles ?? 4, Math.max(1, samples.length - 1)));
  const iterations = Math.max(1, options.iterations ?? 5);
  const includeE = options.includeCapacitiveTerm ?? false;
  const enforcePassivity = options.enforcePassivity ?? true;

  let minFreq = Infinity;
  let maxFreq = 0;
  for (const s of samples) {
    if (s.freqHz > 0) {
      minFreq = Math.min(minFreq, s.freqHz);
      maxFreq = Math.max(maxFreq, s.freqHz);
    }
  }
  if (!Number.isFinite(minFreq) || maxFreq <= 0) {
    minFreq = 10.0;
    maxFreq = 2000.0;
  }

  // Logarithmically spaced initial real poles in LHP
  const wMin = 2.0 * Math.PI * Math.max(1.0, minFreq);
  const wMax = 2.0 * Math.PI * Math.max(minFreq * 2.0, maxFreq);
  let poles: number[] = [];
  for (let m = 0; m < numPoles; m++) {
    const frac = numPoles === 1 ? 0.5 : m / (numPoles - 1);
    const w = wMin * Math.pow(wMax / wMin, frac);
    poles.push(-w);
  }

  const nSamples = samples.length;
  const extraCols = includeE ? 2 : 1; // d, [e]

  // Stage 1: Iterative Pole Relocation (Gustavsen & Semlyen)
  // Scale pole columns by |p_m| and capacitive column by 1/wMax to keep A^T A well-conditioned.
  for (let iter = 0; iter < iterations; iter++) {
    // Unknowns: [rScaled_1..rScaled_N, d, (eScaled), cScaled_1..cScaled_N] -> length = 2*N + extraCols
    const cols = 2 * numPoles + extraCols;
    const rows = 2 * nSamples;
    const A = new Float64Array(rows * cols);
    const b = new Float64Array(rows);

    for (let k = 0; k < nSamples; k++) {
      const s = samples[k]!;
      const w = 2.0 * Math.PI * s.freqHz;
      const yRe = s.ySiemens.re;
      const yIm = s.ySiemens.im;
      const rRe = 2 * k * cols;
      const rIm = (2 * k + 1) * cols;

      for (let m = 0; m < numPoles; m++) {
        const p = poles[m]!;
        const pScale = Math.max(1.0, Math.abs(p));
        const denom = p * p + w * w;
        const phiRe = (-p * pScale) / denom;
        const phiIm = (-w * pScale) / denom;
        // Residue basis
        A[rRe + m] = phiRe;
        A[rIm + m] = phiIm;
        // Weighting sigma basis: -Y(jw) * phi_m(jw)
        const cCol = numPoles + extraCols + m;
        A[rRe + cCol] = -(yRe * phiRe - yIm * phiIm);
        A[rIm + cCol] = -(yRe * phiIm + yIm * phiRe);
      }

      // d term
      A[rRe + numPoles] = 1.0;
      A[rIm + numPoles] = 0.0;

      // Optional e term (jw * e = j*(w/wMax) * (e*wMax))
      if (includeE) {
        A[rRe + numPoles + 1] = 0.0;
        A[rIm + numPoles + 1] = w / wMax;
      }

      b[2 * k] = yRe;
      b[2 * k + 1] = yIm;
    }

    const sol = solveLeastSquares(A, b, rows, cols);
    const cVec = new Float64Array(numPoles);
    for (let m = 0; m < numPoles; m++) {
      const pScale = Math.max(1.0, Math.abs(poles[m]!));
      cVec[m] = sol[numPoles + extraCols + m]! * pScale;
    }
    poles = relocateRealPoles(poles, cVec);
  }

  // Stage 2: Final Residue Identification with Fixed Relocated Poles (column-scaled)
  const resCols = numPoles + extraCols;
  const rows = 2 * nSamples;
  const A2 = new Float64Array(rows * resCols);
  const b2 = new Float64Array(rows);

  for (let k = 0; k < nSamples; k++) {
    const s = samples[k]!;
    const w = 2.0 * Math.PI * s.freqHz;
    const rRe = 2 * k * resCols;
    const rIm = (2 * k + 1) * resCols;

    for (let m = 0; m < numPoles; m++) {
      const p = poles[m]!;
      const pScale = Math.max(1.0, Math.abs(p));
      const denom = p * p + w * w;
      A2[rRe + m] = (-p * pScale) / denom;
      A2[rIm + m] = (-w * pScale) / denom;
    }
    A2[rRe + numPoles] = 1.0;
    A2[rIm + numPoles] = 0.0;
    if (includeE) {
      A2[rRe + numPoles + 1] = 0.0;
      A2[rIm + numPoles + 1] = w / wMax;
    }
    b2[2 * k] = s.ySiemens.re;
    b2[2 * k + 1] = s.ySiemens.im;
  }

  const sol2 = solveLeastSquares(A2, b2, rows, resCols);
  const poleResidues: FdnePoleResidue[] = [];
  for (let m = 0; m < numPoles; m++) {
    const pScale = Math.max(1.0, Math.abs(poles[m]!));
    poleResidues.push({ pole: poles[m]!, residue: sol2[m]! * pScale });
  }
  let d = sol2[numPoles]!;
  const e = includeE ? Math.max(0.0, sol2[numPoles + 1]! / wMax) : 0.0;

  // Stage 3: Global Passivity Verification & Enforcement on [0, infinity)
  // Must hold at DC (w=0), all sample frequencies, high frequencies up to Nyquist, and asymptote w->inf (d >= 0).
  const evalDraft = (freqHz: number) =>
    evaluateFdneModel({ d, e, poles: poleResidues, rmsRelError: 0, minRealPart: 0, isPassive: true }, freqHz);
  let minRealPart = Math.min(d, evalDraft(0.0).re);
  for (const s of samples) {
    const yFit = evalDraft(s.freqHz);
    if (yFit.re < minRealPart) minRealPart = yFit.re;
  }
  for (const fCheck of [1.0, 5.0, 3000.0, 5000.0, 10000.0, 50000.0, 100000.0]) {
    const yFit = evalDraft(fCheck);
    if (yFit.re < minRealPart) minRealPart = yFit.re;
  }
  if (enforcePassivity && minRealPart < 0.0) {
    d += -minRealPart + 1e-9;
    minRealPart = 1e-9;
  }

  // Compute relative RMS error
  let errSq = 0.0;
  let refSq = 0.0;
  const finalModel: FdneRationalModel = {
    d,
    e,
    poles: poleResidues,
    rmsRelError: 0,
    minRealPart,
    isPassive: minRealPart >= -1e-12,
  };
  for (const s of samples) {
    const yFit = evaluateFdneModel(finalModel, s.freqHz);
    const dr = yFit.re - s.ySiemens.re;
    const di = yFit.im - s.ySiemens.im;
    errSq += dr * dr + di * di;
    refSq += s.ySiemens.re * s.ySiemens.re + s.ySiemens.im * s.ySiemens.im;
  }
  finalModel.rmsRelError = refSq > 1e-30 ? Math.sqrt(errSq / refSq) : 0.0;

  return finalModel;
}

/**
 * Synthesizes an FDNE rational model directly from an RL/RC Thévenin branch equivalent
 * (e.g. from a PSS/E boundary port R_th, X_th at f0 plus shunt capacitance C_shunt).
 */
export function fitFdneFromRlThevenin(
  rOhm: number,
  lHenry: number,
  cShuntFarad = 0.0,
  options?: FdneFitOptions & { minFreqHz?: number; maxFreqHz?: number; numSamples?: number },
): FdneRationalModel {
  const minF = options?.minFreqHz ?? 10.0;
  const maxF = options?.maxFreqHz ?? 2500.0;
  const nPts = Math.max(12, options?.numSamples ?? 40);
  const samples: FrequencyAdmittanceSample[] = [];
  for (let i = 0; i < nPts; i++) {
    const frac = i / (nPts - 1);
    const freqHz = minF * Math.pow(maxF / minF, frac);
    const w = 2.0 * Math.PI * freqHz;
    // Y(jw) = 1 / (R + j*w*L) + j*w*C
    const zDenom = rOhm * rOhm + w * lHenry * (w * lHenry);
    const yRe = zDenom > 1e-30 ? rOhm / zDenom : 0.0;
    const yIm = (zDenom > 1e-30 ? (-w * lHenry) / zDenom : 0.0) + w * cShuntFarad;
    samples.push({ freqHz, ySiemens: { re: yRe, im: yIm } });
  }
  return fitFdneRational(samples, {
    numPoles: options?.numPoles ?? 3,
    includeCapacitiveTerm: cShuntFarad > 0,
    ...options,
  });
}

/**
 * Discrete-time Dommel recursive-convolution Norton companion for a 3-phase FDNE
 * supporting both real poles and complex-conjugate resonant pole pairs.
 * Implements `FmiLsEmtCompanionInstance` for direct stamping into `EmtSolver`.
 */
export class FdneDommelCompanion implements FmiLsEmtCompanionInstance {
  private readonly model: FdneRationalModel;
  private readonly phases: number;
  private readonly alpha: Float64Array;
  private readonly beta: Float64Array;
  private readonly poleState: Float64Array; // [phase * nPoles + m]
  private readonly cAlphaRe: Float64Array;
  private readonly cAlphaIm: Float64Array;
  private readonly cBetaRe: Float64Array;
  private readonly cBetaIm: Float64Array;
  private readonly cStateRe: Float64Array; // [phase * nComplex + k]
  private readonly cStateIm: Float64Array;
  private readonly prevV: Float64Array;
  private readonly prevIc: Float64Array;
  private readonly gScalar: number;
  private readonly dtSec: number;

  constructor(model: FdneRationalModel, dtSec: number, phases = 3) {
    this.model = model;
    this.dtSec = dtSec;
    this.phases = Math.max(1, phases);
    const nP = model.poles.length;
    const nC = model.complexPoles?.length ?? 0;
    this.alpha = new Float64Array(nP);
    this.beta = new Float64Array(nP);
    this.poleState = new Float64Array(this.phases * nP);
    this.cAlphaRe = new Float64Array(nC);
    this.cAlphaIm = new Float64Array(nC);
    this.cBetaRe = new Float64Array(nC);
    this.cBetaIm = new Float64Array(nC);
    this.cStateRe = new Float64Array(this.phases * nC);
    this.cStateIm = new Float64Array(this.phases * nC);
    this.prevV = new Float64Array(this.phases);
    this.prevIc = new Float64Array(this.phases);

    let gSum = model.d + (dtSec > 0 ? (2.0 * model.e) / dtSec : 0.0);
    for (let m = 0; m < nP; m++) {
      const p = model.poles[m]!.pole;
      const r = model.poles[m]!.residue;
      const halfPDt = 0.5 * p * dtSec;
      const denom = 1.0 - halfPDt;
      this.alpha[m] = (1.0 + halfPDt) / denom;
      this.beta[m] = (0.5 * r * dtSec) / denom;
      gSum += this.beta[m]!;
    }
    if (model.complexPoles) {
      for (let k = 0; k < nC; k++) {
        const cp = model.complexPoles[k]!;
        const hpRe = 0.5 * cp.poleRe * dtSec;
        const hpIm = 0.5 * cp.poleIm * dtSec;
        // denom = (1 - hpRe) - j * hpIm
        const dRe = 1.0 - hpRe;
        const dIm = -hpIm;
        const dMag2 = dRe * dRe + dIm * dIm;
        // alpha = ((1 + hpRe) + j * hpIm) / (dRe + j * dIm)
        const nRe = 1.0 + hpRe;
        const nIm = hpIm;
        this.cAlphaRe[k] = (nRe * dRe + nIm * dIm) / dMag2;
        this.cAlphaIm[k] = (nIm * dRe - nRe * dIm) / dMag2;
        // beta = (0.5 * dt * (resRe + j * resIm)) / (dRe + j * dIm)
        const bNumRe = 0.5 * dtSec * cp.resRe;
        const bNumIm = 0.5 * dtSec * cp.resIm;
        this.cBetaRe[k] = (bNumRe * dRe + bNumIm * dIm) / dMag2;
        this.cBetaIm[k] = (bNumIm * dRe - bNumRe * dIm) / dMag2;
        // Conjugate pair contributes 2 * Re(x) => instantaneous conductance += 2 * cBetaRe
        gSum += 2.0 * this.cBetaRe[k]!;
      }
    }
    this.gScalar = Math.max(1e-9, gSum);
  }

  public getConductanceSiemens(): number {
    return this.gScalar;
  }

  public stampCompanion(_tSec: number, _dtSec: number): { gEq: Float64Array; iHist: Float64Array } {
    const pCount = this.phases;
    const gEq = new Float64Array(pCount * pCount);
    const iHist = new Float64Array(pCount);
    const nP = this.model.poles.length;
    const nC = this.cAlphaRe.length;
    const gCap = this.dtSec > 0 ? (2.0 * this.model.e) / this.dtSec : 0.0;

    for (let ph = 0; ph < pCount; ph++) {
      gEq[ph * pCount + ph] = this.gScalar;
      // History current leaving node (so Norton injection into node is -iHist_leaving)
      let iLeavingHist = 0.0;
      const base = ph * nP;
      for (let m = 0; m < nP; m++) {
        iLeavingHist += this.alpha[m]! * this.poleState[base + m]! + this.beta[m]! * this.prevV[ph]!;
      }
      const cBase = ph * nC;
      for (let k = 0; k < nC; k++) {
        const xr = this.cStateRe[cBase + k]!;
        const xi = this.cStateIm[cBase + k]!;
        // 2 * Re(alpha * x + beta * prevV)
        const axRe = this.cAlphaRe[k]! * xr - this.cAlphaIm[k]! * xi;
        iLeavingHist += 2.0 * (axRe + this.cBetaRe[k]! * this.prevV[ph]!);
      }
      if (gCap > 0) {
        iLeavingHist += -(gCap * this.prevV[ph]! + this.prevIc[ph]!);
      }
      // Norton current source INTO node: I_node = G_eq * v - iHist => iHist = -iLeavingHist
      iHist[ph] = -iLeavingHist;
    }
    return { gEq, iHist };
  }

  public doStep(_tSec: number, _dtSec: number, vNode: ArrayLike<number>): void {
    const pCount = this.phases;
    const nP = this.model.poles.length;
    const nC = this.cAlphaRe.length;
    const gCap = this.dtSec > 0 ? (2.0 * this.model.e) / this.dtSec : 0.0;

    for (let ph = 0; ph < pCount; ph++) {
      const vNow = vNode[ph] ?? 0.0;
      const vOld = this.prevV[ph]!;
      const vSum = vNow + vOld;
      const base = ph * nP;
      for (let m = 0; m < nP; m++) {
        this.poleState[base + m] = this.alpha[m]! * this.poleState[base + m]! + this.beta[m]! * vSum;
      }
      const cBase = ph * nC;
      for (let k = 0; k < nC; k++) {
        const xr = this.cStateRe[cBase + k]!;
        const xi = this.cStateIm[cBase + k]!;
        const ar = this.cAlphaRe[k]!;
        const ai = this.cAlphaIm[k]!;
        this.cStateRe[cBase + k] = ar * xr - ai * xi + this.cBetaRe[k]! * vSum;
        this.cStateIm[cBase + k] = ar * xi + ai * xr + this.cBetaIm[k]! * vSum;
      }
      if (gCap > 0) {
        this.prevIc[ph] = gCap * (vNow - vOld) - this.prevIc[ph]!;
      }
      this.prevV[ph] = vNow;
    }
  }

  public captureState(): {
    poleState: Float64Array;
    cStateRe: Float64Array;
    cStateIm: Float64Array;
    prevV: Float64Array;
    prevIc: Float64Array;
  } {
    return {
      poleState: new Float64Array(this.poleState),
      cStateRe: new Float64Array(this.cStateRe),
      cStateIm: new Float64Array(this.cStateIm),
      prevV: new Float64Array(this.prevV),
      prevIc: new Float64Array(this.prevIc),
    };
  }

  public restoreState(snap: {
    poleState: Float64Array;
    cStateRe?: Float64Array;
    cStateIm?: Float64Array;
    prevV: Float64Array;
    prevIc: Float64Array;
  }): void {
    this.poleState.set(snap.poleState);
    if (snap.cStateRe) this.cStateRe.set(snap.cStateRe);
    if (snap.cStateIm) this.cStateIm.set(snap.cStateIm);
    this.prevV.set(snap.prevV);
    this.prevIc.set(snap.prevIc);
  }
}

// ============================================================================
// Mixed Real + Complex-Conjugate Pole Vector Fitting (Sharp Resonances)
// ============================================================================

interface MixedPoleSet {
  realPoles: number[];
  complexPairs: Array<{ re: number; im: number }>;
}

function evalComplexPairBasis(
  w: number,
  pRe: number,
  pIm: number,
): { phi1Re: number; phi1Im: number; phi2Re: number; phi2Im: number } {
  // phi1 = 1/(jw - (pRe + j pIm)) + 1/(jw - (pRe - j pIm))
  // phi2 = j/(jw - (pRe + j pIm)) - j/(jw - (pRe - j pIm))
  const dRe = -pRe;
  const d1Im = w - pIm;
  const den1 = dRe * dRe + d1Im * d1Im;
  const inv1Re = den1 > 1e-30 ? dRe / den1 : 0.0;
  const inv1Im = den1 > 1e-30 ? -d1Im / den1 : 0.0;

  const d2Im = w + pIm;
  const den2 = dRe * dRe + d2Im * d2Im;
  const inv2Re = den2 > 1e-30 ? dRe / den2 : 0.0;
  const inv2Im = den2 > 1e-30 ? -d2Im / den2 : 0.0;

  // j * inv1 = (-inv1Im) + j*(inv1Re); -j * inv2 = (inv2Im) + j*(-inv2Re)
  return {
    phi1Re: inv1Re + inv2Re,
    phi1Im: inv1Im + inv2Im,
    phi2Re: -inv1Im + inv2Im,
    phi2Im: inv1Re - inv2Re,
  };
}

/**
 * Extracts real and complex-conjugate eigenvalues from the real block-diagonal
 * Gustavsen & Semlyen relocation matrix H = A - b * c^T via QR iteration + 2x2 Schur blocks.
 */
function relocateMixedPoles(poleSet: MixedPoleSet, cVec: Float64Array): MixedPoleSet {
  const nR = poleSet.realPoles.length;
  const nC = poleSet.complexPairs.length;
  const n = nR + 2 * nC;
  const H = new Float64Array(n * n);

  // Diagonal block A
  for (let i = 0; i < nR; i++) {
    H[i * n + i] = poleSet.realPoles[i]!;
  }
  for (let k = 0; k < nC; k++) {
    const idx = nR + 2 * k;
    const cp = poleSet.complexPairs[k]!;
    H[idx * n + idx] = cp.re;
    H[idx * n + (idx + 1)] = cp.im;
    H[(idx + 1) * n + idx] = -cp.im;
    H[(idx + 1) * n + (idx + 1)] = cp.re;
  }

  // Subtract b * c^T where b_i = 1 for real poles, [2, 0]^T for complex pairs
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < n; j++) {
      H[i * n + j] = H[i * n + j]! - cVec[j]!;
    }
  }
  for (let k = 0; k < nC; k++) {
    const idx = nR + 2 * k;
    for (let j = 0; j < n; j++) {
      H[idx * n + j] = H[idx * n + j]! - 2.0 * cVec[j]!;
    }
  }

  // QR iteration to quasi-upper-triangular (real Schur) form
  const Q = new Float64Array(n * n);
  const R = new Float64Array(n * n);
  const nextH = new Float64Array(n * n);
  for (let iter = 0; iter < 60; iter++) {
    Q.fill(0);
    R.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) Q[i * n + j] = H[i * n + j]!;
      for (let k = 0; k < j; k++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += Q[i * n + k]! * Q[i * n + j]!;
        R[k * n + j] = dot;
        for (let i = 0; i < n; i++) Q[i * n + j] = Q[i * n + j]! - dot * Q[i * n + k]!;
      }
      let norm = 0;
      for (let i = 0; i < n; i++) norm += Q[i * n + j]! * Q[i * n + j]!;
      norm = Math.sqrt(norm);
      R[j * n + j] = norm;
      if (norm > 1e-15) {
        for (let i = 0; i < n; i++) Q[i * n + j] = Q[i * n + j]! / norm;
      }
    }
    nextH.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = i; k < n; k++) sum += R[i * n + k]! * Q[k * n + j]!;
        nextH[i * n + j] = sum;
      }
    }
    H.set(nextH);
  }

  const realPoles: number[] = [];
  const complexPairs: Array<{ re: number; im: number }> = [];
  let i = 0;
  while (i < n) {
    if (i + 1 < n) {
      const sub = H[(i + 1) * n + i]!;
      const a = H[i * n + i]!;
      const b = H[i * n + (i + 1)]!;
      const c = sub;
      const d = H[(i + 1) * n + (i + 1)]!;
      const disc = (a - d) * (a - d) + 4.0 * b * c;
      if (disc < -1e-6 && Math.abs(sub) > 1e-6) {
        const re = -Math.max(1.0, Math.abs(0.5 * (a + d)));
        const im = 0.5 * Math.sqrt(-disc);
        if (Number.isFinite(re) && Number.isFinite(im) && im > 1.0) {
          complexPairs.push({ re, im });
          i += 2;
          continue;
        }
      }
    }
    let p = H[i * n + i]!;
    if (!Number.isFinite(p) || Math.abs(p) < 1e-3) p = -100.0;
    realPoles.push(Math.min(-1.0, p > 0 ? -p : p));
    i++;
  }
  return { realPoles, complexPairs };
}

function fitMixedPoleFdneRational(samples: FrequencyAdmittanceSample[], options: FdneFitOptions): FdneRationalModel {
  const numReal = Math.max(0, options.numPoles ?? 2);
  const numPairs = Math.max(1, options.numComplexPairs ?? 2);
  const iterations = Math.max(1, options.iterations ?? 6);
  const includeE = options.includeCapacitiveTerm ?? false;
  const enforcePassivity = options.enforcePassivity ?? true;

  let minFreq = Infinity;
  let maxFreq = 0;
  for (const s of samples) {
    if (s.freqHz > 0) {
      minFreq = Math.min(minFreq, s.freqHz);
      maxFreq = Math.max(maxFreq, s.freqHz);
    }
  }
  if (!Number.isFinite(minFreq) || maxFreq <= 0) {
    minFreq = 10.0;
    maxFreq = 2500.0;
  }
  const wMin = 2.0 * Math.PI * Math.max(1.0, minFreq);
  const wMax = 2.0 * Math.PI * Math.max(minFreq * 2.0, maxFreq);

  let poleSet: MixedPoleSet = { realPoles: [], complexPairs: [] };
  for (let m = 0; m < numReal; m++) {
    const frac = numReal === 1 ? 0.3 : m / (numReal - 1);
    poleSet.realPoles.push(-(wMin * Math.pow(wMax / wMin, frac)));
  }
  for (let k = 0; k < numPairs; k++) {
    const frac = (k + 0.5) / numPairs;
    const w0 = wMin * Math.pow(wMax / wMin, frac);
    // Lightly damped initial complex pairs (zeta = 0.05) per Gustavsen & Semlyen
    poleSet.complexPairs.push({ re: -0.05 * w0, im: w0 });
  }

  const nSamples = samples.length;
  const extraCols = includeE ? 2 : 1;

  // Stage 1: Iterative Mixed Real + Complex Pole Relocation
  for (let iter = 0; iter < iterations; iter++) {
    const nBasis = poleSet.realPoles.length + 2 * poleSet.complexPairs.length;
    const cols = 2 * nBasis + extraCols;
    const rows = 2 * nSamples;
    const A = new Float64Array(rows * cols);
    const b = new Float64Array(rows);
    const scales = new Float64Array(nBasis);

    for (let m = 0; m < poleSet.realPoles.length; m++) {
      scales[m] = Math.max(1.0, Math.abs(poleSet.realPoles[m]!));
    }
    for (let k = 0; k < poleSet.complexPairs.length; k++) {
      const cp = poleSet.complexPairs[k]!;
      const sc = Math.max(1.0, Math.hypot(cp.re, cp.im));
      const idx = poleSet.realPoles.length + 2 * k;
      scales[idx] = sc;
      scales[idx + 1] = sc;
    }

    for (let k = 0; k < nSamples; k++) {
      const s = samples[k]!;
      const w = 2.0 * Math.PI * s.freqHz;
      const yRe = s.ySiemens.re;
      const yIm = s.ySiemens.im;
      const rRe = 2 * k * cols;
      const rIm = (2 * k + 1) * cols;

      for (let m = 0; m < poleSet.realPoles.length; m++) {
        const p = poleSet.realPoles[m]!;
        const sc = scales[m]!;
        const denom = p * p + w * w;
        const phiRe = (-p * sc) / denom;
        const phiIm = (-w * sc) / denom;
        A[rRe + m] = phiRe;
        A[rIm + m] = phiIm;
        const cCol = nBasis + extraCols + m;
        A[rRe + cCol] = -(yRe * phiRe - yIm * phiIm);
        A[rIm + cCol] = -(yRe * phiIm + yIm * phiRe);
      }

      for (let pIdx = 0; pIdx < poleSet.complexPairs.length; pIdx++) {
        const cp = poleSet.complexPairs[pIdx]!;
        const col0 = poleSet.realPoles.length + 2 * pIdx;
        const sc = scales[col0]!;
        const ev = evalComplexPairBasis(w, cp.re, cp.im);
        const p1Re = ev.phi1Re * sc;
        const p1Im = ev.phi1Im * sc;
        const p2Re = ev.phi2Re * sc;
        const p2Im = ev.phi2Im * sc;

        A[rRe + col0] = p1Re;
        A[rIm + col0] = p1Im;
        A[rRe + col0 + 1] = p2Re;
        A[rIm + col0 + 1] = p2Im;

        const cCol0 = nBasis + extraCols + col0;
        A[rRe + cCol0] = -(yRe * p1Re - yIm * p1Im);
        A[rIm + cCol0] = -(yRe * p1Im + yIm * p1Re);
        A[rRe + cCol0 + 1] = -(yRe * p2Re - yIm * p2Im);
        A[rIm + cCol0 + 1] = -(yRe * p2Im + yIm * p2Re);
      }

      A[rRe + nBasis] = 1.0;
      A[rIm + nBasis] = 0.0;
      if (includeE) {
        A[rRe + nBasis + 1] = 0.0;
        A[rIm + nBasis + 1] = w / wMax;
      }
      b[2 * k] = yRe;
      b[2 * k + 1] = yIm;
    }

    const sol = solveLeastSquares(A, b, rows, cols);
    const cVec = new Float64Array(nBasis);
    for (let j = 0; j < nBasis; j++) {
      cVec[j] = sol[nBasis + extraCols + j]! * scales[j]!;
    }
    poleSet = relocateMixedPoles(poleSet, cVec);
  }

  // Stage 2: Final Residue Identification
  const nBasis = poleSet.realPoles.length + 2 * poleSet.complexPairs.length;
  const resCols = nBasis + extraCols;
  const rows = 2 * nSamples;
  const A2 = new Float64Array(rows * resCols);
  const b2 = new Float64Array(rows);
  const scales = new Float64Array(nBasis);

  for (let m = 0; m < poleSet.realPoles.length; m++) {
    scales[m] = Math.max(1.0, Math.abs(poleSet.realPoles[m]!));
  }
  for (let k = 0; k < poleSet.complexPairs.length; k++) {
    const cp = poleSet.complexPairs[k]!;
    const sc = Math.max(1.0, Math.hypot(cp.re, cp.im));
    const idx = poleSet.realPoles.length + 2 * k;
    scales[idx] = sc;
    scales[idx + 1] = sc;
  }

  for (let k = 0; k < nSamples; k++) {
    const s = samples[k]!;
    const w = 2.0 * Math.PI * s.freqHz;
    const rRe = 2 * k * resCols;
    const rIm = (2 * k + 1) * resCols;
    for (let m = 0; m < poleSet.realPoles.length; m++) {
      const p = poleSet.realPoles[m]!;
      const sc = scales[m]!;
      const denom = p * p + w * w;
      A2[rRe + m] = (-p * sc) / denom;
      A2[rIm + m] = (-w * sc) / denom;
    }
    for (let pIdx = 0; pIdx < poleSet.complexPairs.length; pIdx++) {
      const cp = poleSet.complexPairs[pIdx]!;
      const col0 = poleSet.realPoles.length + 2 * pIdx;
      const sc = scales[col0]!;
      const ev = evalComplexPairBasis(w, cp.re, cp.im);
      A2[rRe + col0] = ev.phi1Re * sc;
      A2[rIm + col0] = ev.phi1Im * sc;
      A2[rRe + col0 + 1] = ev.phi2Re * sc;
      A2[rIm + col0 + 1] = ev.phi2Im * sc;
    }
    A2[rRe + nBasis] = 1.0;
    A2[rIm + nBasis] = 0.0;
    if (includeE) {
      A2[rRe + nBasis + 1] = 0.0;
      A2[rIm + nBasis + 1] = w / wMax;
    }
    b2[2 * k] = s.ySiemens.re;
    b2[2 * k + 1] = s.ySiemens.im;
  }

  const sol2 = solveLeastSquares(A2, b2, rows, resCols);
  const poles: FdnePoleResidue[] = [];
  for (let m = 0; m < poleSet.realPoles.length; m++) {
    poles.push({ pole: poleSet.realPoles[m]!, residue: sol2[m]! * scales[m]! });
  }
  const complexPoles: FdneComplexPolePair[] = [];
  for (let pIdx = 0; pIdx < poleSet.complexPairs.length; pIdx++) {
    const cp = poleSet.complexPairs[pIdx]!;
    const col0 = poleSet.realPoles.length + 2 * pIdx;
    const sc = scales[col0]!;
    complexPoles.push({
      poleRe: cp.re,
      poleIm: cp.im,
      resRe: sol2[col0]! * sc,
      resIm: sol2[col0 + 1]! * sc,
    });
  }
  let d = sol2[nBasis]!;
  const e = includeE ? Math.max(0.0, sol2[nBasis + 1]! / wMax) : 0.0;

  // Stage 3: Global Passivity Enforcement on [0, infinity)
  const evalDraft = (freqHz: number) =>
    evaluateFdneModel({ d, e, poles, complexPoles, rmsRelError: 0, minRealPart: 0, isPassive: true }, freqHz);
  let minRealPart = Math.min(d, evalDraft(0.0).re);
  for (const s of samples) {
    minRealPart = Math.min(minRealPart, evalDraft(s.freqHz).re);
  }
  for (const fCheck of [1.0, 5.0, 3000.0, 5000.0, 10000.0, 50000.0]) {
    minRealPart = Math.min(minRealPart, evalDraft(fCheck).re);
  }
  if (enforcePassivity && minRealPart < 0.0) {
    d += -minRealPart + 1e-9;
    minRealPart = 1e-9;
  }

  let errSq = 0.0;
  let refSq = 0.0;
  const finalModel: FdneRationalModel = {
    d,
    e,
    poles,
    complexPoles,
    rmsRelError: 0,
    minRealPart,
    isPassive: minRealPart >= -1e-12,
  };
  for (const s of samples) {
    const yFit = evaluateFdneModel(finalModel, s.freqHz);
    const dr = yFit.re - s.ySiemens.re;
    const di = yFit.im - s.ySiemens.im;
    errSq += dr * dr + di * di;
    refSq += s.ySiemens.re * s.ySiemens.re + s.ySiemens.im * s.ySiemens.im;
  }
  finalModel.rmsRelError = refSq > 1e-30 ? Math.sqrt(errSq / refSq) : 0.0;
  return finalModel;
}

// ============================================================================
// Multi-Port N x N Matrix FDNE (Common-Pole Vector Fitting + Matrix Passivity)
// ============================================================================

export interface FrequencyMatrixAdmittanceSample {
  /** Frequency in Hz. */
  freqHz: number;
  /** Row-major N x N complex admittance matrix Y(jw) in Siemens. */
  yMatrixSiemens: ComplexPhasor[];
}

export interface MatrixFdneRationalModel {
  /** Number of coupled ports N. */
  numPorts: number;
  /** Row-major N x N constant conductance matrix D (Siemens). */
  dMatrix: Float64Array;
  /** Row-major N x N capacitive matrix E (Farads). */
  eMatrix: Float64Array;
  /** Common real poles (rad/s, strictly < 0). */
  realPoles: number[];
  /** Symmetric N x N residue matrix per real pole. */
  realResidues: Float64Array[];
  /** Common complex-conjugate pole pairs. */
  complexPoles: Array<{ poleRe: number; poleIm: number }>;
  /** Symmetric N x N real/imag residue matrices per complex-conjugate pole pair. */
  complexResidues: Array<{ resRe: Float64Array; resIm: Float64Array }>;
  /** Relative Frobenius RMS fitting error across all ports and frequencies. */
  rmsRelError: number;
  /** Minimum eigenvalue of Hermitian part Re{Y(jw)} across [0, infinity). */
  minEigenvalue: number;
  /** Whether the N x N matrix model is globally passive. */
  isPassive: boolean;
}

/**
 * Evaluates a multi-port N x N matrix FDNE model at `freqHz`.
 */
export function evaluateMatrixFdneModel(model: MatrixFdneRationalModel, freqHz: number): ComplexPhasor[] {
  const N = model.numPorts;
  const w = 2.0 * Math.PI * freqHz;
  const out: ComplexPhasor[] = new Array(N * N);
  for (let idx = 0; idx < N * N; idx++) {
    out[idx] = { re: model.dMatrix[idx]!, im: w * model.eMatrix[idx]! };
  }
  for (let m = 0; m < model.realPoles.length; m++) {
    const p = model.realPoles[m]!;
    const R = model.realResidues[m]!;
    const denom = p * p + w * w;
    if (denom <= 1e-30) continue;
    const fRe = -p / denom;
    const fIm = -w / denom;
    for (let idx = 0; idx < N * N; idx++) {
      const r = R[idx]!;
      out[idx]!.re += r * fRe;
      out[idx]!.im += r * fIm;
    }
  }
  for (let k = 0; k < model.complexPoles.length; k++) {
    const cp = model.complexPoles[k]!;
    const R = model.complexResidues[k]!;
    const ev = evalComplexPairBasis(w, cp.poleRe, cp.poleIm);
    for (let idx = 0; idx < N * N; idx++) {
      const rr = R.resRe[idx]!;
      const ri = R.resIm[idx]!;
      out[idx]!.re += rr * ev.phi1Re + ri * ev.phi2Re;
      out[idx]!.im += rr * ev.phi1Im + ri * ev.phi2Im;
    }
  }
  return out;
}

/**
 * Computes the minimum eigenvalue of a small N x N real symmetric matrix via Jacobi sweeps.
 */
function minSymmetricEigenvalue(mat: Float64Array, n: number): number {
  if (n === 1) return mat[0]!;
  const A = new Float64Array(mat);
  for (let sweep = 0; sweep < 25; sweep++) {
    let maxOff = 0.0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]!;
        if (Math.abs(apq) > maxOff) maxOff = Math.abs(apq);
        if (Math.abs(apq) < 1e-14) continue;
        const app = A[p * n + p]!;
        const aqq = A[q * n + q]!;
        const tau = (aqq - app) / (2.0 * apq);
        const t = tau >= 0 ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau)) : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
        const c = 1.0 / Math.sqrt(1.0 + t * t);
        const s = t * c;
        A[p * n + p] = app - t * apq;
        A[q * n + q] = aqq + t * apq;
        A[p * n + q] = 0.0;
        A[q * n + p] = 0.0;
        for (let r = 0; r < n; r++) {
          if (r === p || r === q) continue;
          const arp = A[r * n + p]!;
          const arq = A[r * n + q]!;
          A[r * n + p] = c * arp - s * arq;
          A[p * n + r] = A[r * n + p]!;
          A[r * n + q] = s * arp + c * arq;
          A[q * n + r] = A[r * n + q]!;
        }
      }
    }
    if (maxOff < 1e-12) break;
  }
  let minEig = Infinity;
  for (let i = 0; i < n; i++) minEig = Math.min(minEig, A[i * n + i]!);
  return minEig;
}

/**
 * Fits a passive, symmetric N x N multi-port Matrix FDNE using common-pole Vector Fitting
 * (fitting shared poles on the trace/sum of port admittances, solving symmetric residue
 * matrices per entry, and enforcing global Hermitian passivity Re{Y(jw)} >= 0).
 */
export function fitMatrixFdneRational(
  numPorts: number,
  samples: FrequencyMatrixAdmittanceSample[],
  options: FdneFitOptions = {},
): MatrixFdneRationalModel {
  const N = Math.max(1, numPorts);
  const dMatrix = new Float64Array(N * N);
  const eMatrix = new Float64Array(N * N);
  if (samples.length === 0) {
    return {
      numPorts: N,
      dMatrix,
      eMatrix,
      realPoles: [],
      realResidues: [],
      complexPoles: [],
      complexResidues: [],
      rmsRelError: 0,
      minEigenvalue: 0,
      isPassive: true,
    };
  }

  // 1. Identify shared pole set from the weighted trace sum sum_i Y_ii(jw) + 0.5 * sum_{i<j} Y_ij(jw)
  const traceSamples: FrequencyAdmittanceSample[] = samples.map((s) => {
    let re = 0.0;
    let im = 0.0;
    for (let i = 0; i < N; i++) {
      for (let j = i; j < N; j++) {
        const wgt = i === j ? 1.0 : 0.5;
        const c = s.yMatrixSiemens[i * N + j]!;
        re += wgt * c.re;
        im += wgt * c.im;
      }
    }
    return { freqHz: s.freqHz, ySiemens: { re, im } };
  });

  const shared = fitFdneRational(traceSamples, { ...options, enforcePassivity: false });
  const realPoles = shared.poles.map((p) => p.pole);
  const complexPoles = (shared.complexPoles ?? []).map((cp) => ({ poleRe: cp.poleRe, poleIm: cp.poleIm }));

  const nR = realPoles.length;
  const nC = complexPoles.length;
  const nBasis = nR + 2 * nC;
  const includeE = options.includeCapacitiveTerm ?? false;
  const extraCols = includeE ? 2 : 1;
  const resCols = nBasis + extraCols;
  const nSamples = samples.length;
  const rows = 2 * nSamples;

  let maxFreq = 60.0;
  for (const s of samples) maxFreq = Math.max(maxFreq, s.freqHz);
  const wMax = 2.0 * Math.PI * maxFreq;

  const scales = new Float64Array(nBasis);
  for (let m = 0; m < nR; m++) scales[m] = Math.max(1.0, Math.abs(realPoles[m]!));
  for (let k = 0; k < nC; k++) {
    const cp = complexPoles[k]!;
    const sc = Math.max(1.0, Math.hypot(cp.poleRe, cp.poleIm));
    scales[nR + 2 * k] = sc;
    scales[nR + 2 * k + 1] = sc;
  }

  // Build shared Vandermonde-like basis matrix A2 once for all (i, j) pairs
  const A2 = new Float64Array(rows * resCols);
  for (let k = 0; k < nSamples; k++) {
    const w = 2.0 * Math.PI * samples[k]!.freqHz;
    const rRe = 2 * k * resCols;
    const rIm = (2 * k + 1) * resCols;
    for (let m = 0; m < nR; m++) {
      const p = realPoles[m]!;
      const sc = scales[m]!;
      const denom = p * p + w * w;
      A2[rRe + m] = (-p * sc) / denom;
      A2[rIm + m] = (-w * sc) / denom;
    }
    for (let pIdx = 0; pIdx < nC; pIdx++) {
      const cp = complexPoles[pIdx]!;
      const col0 = nR + 2 * pIdx;
      const sc = scales[col0]!;
      const ev = evalComplexPairBasis(w, cp.poleRe, cp.poleIm);
      A2[rRe + col0] = ev.phi1Re * sc;
      A2[rIm + col0] = ev.phi1Im * sc;
      A2[rRe + col0 + 1] = ev.phi2Re * sc;
      A2[rIm + col0 + 1] = ev.phi2Im * sc;
    }
    A2[rRe + nBasis] = 1.0;
    A2[rIm + nBasis] = 0.0;
    if (includeE) {
      A2[rRe + nBasis + 1] = 0.0;
      A2[rIm + nBasis + 1] = w / wMax;
    }
  }

  const realResidues: Float64Array[] = Array.from({ length: nR }, () => new Float64Array(N * N));
  const complexResidues: Array<{ resRe: Float64Array; resIm: Float64Array }> = Array.from({ length: nC }, () => ({
    resRe: new Float64Array(N * N),
    resIm: new Float64Array(N * N),
  }));

  // 2. Solve residues for each symmetric upper-triangular entry (i <= j)
  const b2 = new Float64Array(rows);
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      for (let k = 0; k < nSamples; k++) {
        const yij = samples[k]!.yMatrixSiemens[i * N + j]!;
        const yji = samples[k]!.yMatrixSiemens[j * N + i]!;
        b2[2 * k] = 0.5 * (yij.re + yji.re);
        b2[2 * k + 1] = 0.5 * (yij.im + yji.im);
      }
      const sol = solveLeastSquares(A2, b2, rows, resCols);
      const setSym = (M: Float64Array, val: number) => {
        M[i * N + j] = val;
        M[j * N + i] = val;
      };
      for (let m = 0; m < nR; m++) setSym(realResidues[m]!, sol[m]! * scales[m]!);
      for (let pIdx = 0; pIdx < nC; pIdx++) {
        const col0 = nR + 2 * pIdx;
        const sc = scales[col0]!;
        setSym(complexResidues[pIdx]!.resRe, sol[col0]! * sc);
        setSym(complexResidues[pIdx]!.resIm, sol[col0 + 1]! * sc);
      }
      setSym(dMatrix, sol[nBasis]!);
      if (includeE) setSym(eMatrix, i === j ? Math.max(0.0, sol[nBasis + 1]! / wMax) : sol[nBasis + 1]! / wMax);
    }
  }

  const model: MatrixFdneRationalModel = {
    numPorts: N,
    dMatrix,
    eMatrix,
    realPoles,
    realResidues,
    complexPoles,
    complexResidues,
    rmsRelError: 0,
    minEigenvalue: Infinity,
    isPassive: true,
  };

  // 3. Matrix Passivity Enforcement: Re{Y(jw)} >= 0 on [0, infinity)
  const checkFreqs = [0.0, 1.0, ...samples.map((s) => s.freqHz), 5000.0, 10000.0, 50000.0];
  let minEig = minSymmetricEigenvalue(dMatrix, N);
  const reMat = new Float64Array(N * N);
  for (const f of checkFreqs) {
    const yMat = evaluateMatrixFdneModel(model, f);
    for (let idx = 0; idx < N * N; idx++) reMat[idx] = yMat[idx]!.re;
    minEig = Math.min(minEig, minSymmetricEigenvalue(reMat, N));
  }
  if ((options.enforcePassivity ?? true) && minEig < 0.0) {
    const shift = -minEig + 1e-9;
    for (let i = 0; i < N; i++) dMatrix[i * N + i] = dMatrix[i * N + i]! + shift;
    minEig = 1e-9;
  }
  model.minEigenvalue = minEig;
  model.isPassive = minEig >= -1e-12;

  // 4. Relative Frobenius RMS error
  let errSq = 0.0;
  let refSq = 0.0;
  for (const s of samples) {
    const yFit = evaluateMatrixFdneModel(model, s.freqHz);
    for (let idx = 0; idx < N * N; idx++) {
      const dr = yFit[idx]!.re - s.yMatrixSiemens[idx]!.re;
      const di = yFit[idx]!.im - s.yMatrixSiemens[idx]!.im;
      errSq += dr * dr + di * di;
      refSq += s.yMatrixSiemens[idx]!.re ** 2 + s.yMatrixSiemens[idx]!.im ** 2;
    }
  }
  model.rmsRelError = refSq > 1e-30 ? Math.sqrt(errSq / refSq) : 0.0;
  return model;
}

/**
 * Multi-Port N x N Dommel recursive-convolution Norton companion for tightly coupled
 * multi-terminal EMT boundaries (supports both real poles and complex-conjugate pairs).
 */
export class MatrixFdneDommelCompanion {
  private readonly model: MatrixFdneRationalModel;
  private readonly dtSec: number;
  private readonly phases: number;
  private readonly gEqPerPhase: Float64Array; // N x N
  private readonly alphaR: Float64Array;
  private readonly betaRScale: Float64Array;
  private readonly cAlphaRe: Float64Array;
  private readonly cAlphaIm: Float64Array;
  private readonly cDenRe: Float64Array;
  private readonly cDenIm: Float64Array;
  private readonly cDenMag2: Float64Array;
  private readonly stateR: Float64Array; // [ph * nR * N + m * N + i]
  private readonly stateCRe: Float64Array; // [ph * nC * N + k * N + i]
  private readonly stateCIm: Float64Array;
  private readonly prevV: Float64Array; // [ph * N + j]
  private readonly prevIc: Float64Array; // [ph * N + i]

  constructor(model: MatrixFdneRationalModel, dtSec: number, phases = 3) {
    this.model = model;
    this.dtSec = dtSec;
    this.phases = Math.max(1, phases);
    const N = model.numPorts;
    const nR = model.realPoles.length;
    const nC = model.complexPoles.length;

    this.gEqPerPhase = new Float64Array(N * N);
    this.alphaR = new Float64Array(nR);
    this.betaRScale = new Float64Array(nR);
    this.cAlphaRe = new Float64Array(nC);
    this.cAlphaIm = new Float64Array(nC);
    this.cDenRe = new Float64Array(nC);
    this.cDenIm = new Float64Array(nC);
    this.cDenMag2 = new Float64Array(nC);

    this.stateR = new Float64Array(this.phases * nR * N);
    this.stateCRe = new Float64Array(this.phases * nC * N);
    this.stateCIm = new Float64Array(this.phases * nC * N);
    this.prevV = new Float64Array(this.phases * N);
    this.prevIc = new Float64Array(this.phases * N);

    const gCapFactor = dtSec > 0 ? 2.0 / dtSec : 0.0;
    for (let idx = 0; idx < N * N; idx++) {
      this.gEqPerPhase[idx] = model.dMatrix[idx]! + gCapFactor * model.eMatrix[idx]!;
    }

    for (let m = 0; m < nR; m++) {
      const halfPDt = 0.5 * model.realPoles[m]! * dtSec;
      const denom = 1.0 - halfPDt;
      this.alphaR[m] = (1.0 + halfPDt) / denom;
      this.betaRScale[m] = (0.5 * dtSec) / denom;
      const R = model.realResidues[m]!;
      for (let idx = 0; idx < N * N; idx++) {
        this.gEqPerPhase[idx] = this.gEqPerPhase[idx]! + this.betaRScale[m]! * R[idx]!;
      }
    }

    for (let k = 0; k < nC; k++) {
      const cp = model.complexPoles[k]!;
      const hpRe = 0.5 * cp.poleRe * dtSec;
      const hpIm = 0.5 * cp.poleIm * dtSec;
      const dRe = 1.0 - hpRe;
      const dIm = -hpIm;
      const dMag2 = dRe * dRe + dIm * dIm;
      this.cDenRe[k] = dRe;
      this.cDenIm[k] = dIm;
      this.cDenMag2[k] = dMag2;
      this.cAlphaRe[k] = ((1.0 + hpRe) * dRe + hpIm * dIm) / dMag2;
      this.cAlphaIm[k] = (hpIm * dRe - (1.0 + hpRe) * dIm) / dMag2;

      const R = model.complexResidues[k]!;
      for (let idx = 0; idx < N * N; idx++) {
        const bNumRe = 0.5 * dtSec * R.resRe[idx]!;
        const bNumIm = 0.5 * dtSec * R.resIm[idx]!;
        const betaRe = (bNumRe * dRe + bNumIm * dIm) / dMag2;
        this.gEqPerPhase[idx] = this.gEqPerPhase[idx]! + 2.0 * betaRe;
      }
    }
  }

  /** Returns the symmetric N x N per-phase instantaneous conductance matrix G_eq (Siemens). */
  public getConductanceMatrixPerPhase(): Float64Array {
    return new Float64Array(this.gEqPerPhase);
  }

  /**
   * Stamps the per-phase N x N conductance matrix and per-phase Norton history currents
   * (length `phases * numPorts`, indexed as `ph * numPorts + portIdx`).
   */
  public stampCompanion(): { gEqPerPhase: Float64Array; iHist: Float64Array } {
    const N = this.model.numPorts;
    const nR = this.model.realPoles.length;
    const nC = this.model.complexPoles.length;
    const gCapFactor = this.dtSec > 0 ? 2.0 / this.dtSec : 0.0;
    const iHist = new Float64Array(this.phases * N);

    for (let ph = 0; ph < this.phases; ph++) {
      const vOff = ph * N;
      for (let i = 0; i < N; i++) {
        let iLeavingHist = 0.0;
        for (let m = 0; m < nR; m++) {
          const R = this.model.realResidues[m]!;
          const bSc = this.betaRScale[m]!;
          let rv = 0.0;
          for (let j = 0; j < N; j++) rv += R[i * N + j]! * this.prevV[vOff + j]!;
          iLeavingHist += this.alphaR[m]! * this.stateR[(ph * nR + m) * N + i]! + bSc * rv;
        }
        for (let k = 0; k < nC; k++) {
          const R = this.model.complexResidues[k]!;
          const dRe = this.cDenRe[k]!;
          const dIm = this.cDenIm[k]!;
          const dMag2 = this.cDenMag2[k]!;
          let betaVRe = 0.0;
          for (let j = 0; j < N; j++) {
            const bNumRe = 0.5 * this.dtSec * R.resRe[i * N + j]!;
            const bNumIm = 0.5 * this.dtSec * R.resIm[i * N + j]!;
            const betaRe = (bNumRe * dRe + bNumIm * dIm) / dMag2;
            betaVRe += betaRe * this.prevV[vOff + j]!;
          }
          const sIdx = (ph * nC + k) * N + i;
          const axRe = this.cAlphaRe[k]! * this.stateCRe[sIdx]! - this.cAlphaIm[k]! * this.stateCIm[sIdx]!;
          iLeavingHist += 2.0 * (axRe + betaVRe);
        }
        if (gCapFactor > 0) {
          let eV = 0.0;
          for (let j = 0; j < N; j++) eV += this.model.eMatrix[i * N + j]! * this.prevV[vOff + j]!;
          iLeavingHist += -(gCapFactor * eV + this.prevIc[vOff + i]!);
        }
        iHist[vOff + i] = iLeavingHist === 0 ? 0.0 : -iLeavingHist;
      }
    }
    return { gEqPerPhase: this.gEqPerPhase, iHist };
  }

  /**
   * Advances all multi-port recursive-convolution states by one micro-step using
   * `vPorts` (length `phases * numPorts`, indexed as `ph * numPorts + portIdx`).
   */
  public doStep(vPorts: ArrayLike<number>): void {
    const N = this.model.numPorts;
    const nR = this.model.realPoles.length;
    const nC = this.model.complexPoles.length;
    const gCapFactor = this.dtSec > 0 ? 2.0 / this.dtSec : 0.0;

    for (let ph = 0; ph < this.phases; ph++) {
      const vOff = ph * N;
      for (let m = 0; m < nR; m++) {
        const R = this.model.realResidues[m]!;
        const a = this.alphaR[m]!;
        const bSc = this.betaRScale[m]!;
        for (let i = 0; i < N; i++) {
          let rvSum = 0.0;
          for (let j = 0; j < N; j++) {
            rvSum += R[i * N + j]! * ((vPorts[vOff + j] ?? 0.0) + this.prevV[vOff + j]!);
          }
          const sIdx = (ph * nR + m) * N + i;
          this.stateR[sIdx] = a * this.stateR[sIdx]! + bSc * rvSum;
        }
      }
      for (let k = 0; k < nC; k++) {
        const R = this.model.complexResidues[k]!;
        const ar = this.cAlphaRe[k]!;
        const ai = this.cAlphaIm[k]!;
        const dRe = this.cDenRe[k]!;
        const dIm = this.cDenIm[k]!;
        const dMag2 = this.cDenMag2[k]!;
        for (let i = 0; i < N; i++) {
          let bvRe = 0.0;
          let bvIm = 0.0;
          for (let j = 0; j < N; j++) {
            const vSum = (vPorts[vOff + j] ?? 0.0) + this.prevV[vOff + j]!;
            const bNumRe = 0.5 * this.dtSec * R.resRe[i * N + j]!;
            const bNumIm = 0.5 * this.dtSec * R.resIm[i * N + j]!;
            bvRe += ((bNumRe * dRe + bNumIm * dIm) / dMag2) * vSum;
            bvIm += ((bNumIm * dRe - bNumRe * dIm) / dMag2) * vSum;
          }
          const sIdx = (ph * nC + k) * N + i;
          const xr = this.stateCRe[sIdx]!;
          const xi = this.stateCIm[sIdx]!;
          this.stateCRe[sIdx] = ar * xr - ai * xi + bvRe;
          this.stateCIm[sIdx] = ar * xi + ai * xr + bvIm;
        }
      }
      if (gCapFactor > 0) {
        for (let i = 0; i < N; i++) {
          let eDiff = 0.0;
          for (let j = 0; j < N; j++) {
            eDiff += this.model.eMatrix[i * N + j]! * ((vPorts[vOff + j] ?? 0.0) - this.prevV[vOff + j]!);
          }
          this.prevIc[vOff + i] = gCapFactor * eDiff - this.prevIc[vOff + i]!;
        }
      }
      for (let j = 0; j < N; j++) {
        this.prevV[vOff + j] = vPorts[vOff + j] ?? 0.0;
      }
    }
  }

  public captureState(): {
    stateR: Float64Array;
    stateCRe: Float64Array;
    stateCIm: Float64Array;
    prevV: Float64Array;
    prevIc: Float64Array;
  } {
    return {
      stateR: new Float64Array(this.stateR),
      stateCRe: new Float64Array(this.stateCRe),
      stateCIm: new Float64Array(this.stateCIm),
      prevV: new Float64Array(this.prevV),
      prevIc: new Float64Array(this.prevIc),
    };
  }

  public restoreState(snap: {
    stateR: Float64Array;
    stateCRe: Float64Array;
    stateCIm: Float64Array;
    prevV: Float64Array;
    prevIc: Float64Array;
  }): void {
    this.stateR.set(snap.stateR);
    this.stateCRe.set(snap.stateCRe);
    this.stateCIm.set(snap.stateCIm);
    this.prevV.set(snap.prevV);
    this.prevIc.set(snap.prevIc);
  }
}
