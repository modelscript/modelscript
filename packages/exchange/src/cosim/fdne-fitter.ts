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

export interface FdneRationalModel {
  /** Constant conductance term d (Siemens). */
  d: number;
  /** Capacitive term e (Farads; s*e term). */
  e: number;
  /** Real stable poles and residues. */
  poles: FdnePoleResidue[];
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
  /** Number of Vector Fitting pole-relocation iterations (default: 5). */
  iterations?: number | undefined;
  /** Whether to include the capacitive `s * e` term (default: false). */
  includeCapacitiveTerm?: boolean | undefined;
  /** Enforce passivity by raising `d` if min Re(Y(jw)) < 0 (default: true). */
  enforcePassivity?: boolean | undefined;
}

/**
 * Evaluates a fitted rational FDNE model Y(jw) = d + jw*e + sum_m r_m / (jw - p_m).
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
 * Discrete-time Dommel recursive-convolution Norton companion for a 3-phase FDNE.
 * Implements `FmiLsEmtCompanionInstance` for direct stamping into `EmtSolver`.
 */
export class FdneDommelCompanion implements FmiLsEmtCompanionInstance {
  private readonly model: FdneRationalModel;
  private readonly phases: number;
  private readonly alpha: Float64Array;
  private readonly beta: Float64Array;
  private readonly poleState: Float64Array; // [phase * nPoles + m]
  private readonly prevV: Float64Array;
  private readonly prevIc: Float64Array;
  private readonly gScalar: number;
  private readonly dtSec: number;

  constructor(model: FdneRationalModel, dtSec: number, phases = 3) {
    this.model = model;
    this.dtSec = dtSec;
    this.phases = Math.max(1, phases);
    const nP = model.poles.length;
    this.alpha = new Float64Array(nP);
    this.beta = new Float64Array(nP);
    this.poleState = new Float64Array(this.phases * nP);
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
    const gCap = this.dtSec > 0 ? (2.0 * this.model.e) / this.dtSec : 0.0;

    for (let ph = 0; ph < pCount; ph++) {
      gEq[ph * pCount + ph] = this.gScalar;
      // History current leaving node (so Norton injection into node is -iHist_leaving)
      let iLeavingHist = 0.0;
      const base = ph * nP;
      for (let m = 0; m < nP; m++) {
        iLeavingHist += this.alpha[m]! * this.poleState[base + m]! + this.beta[m]! * this.prevV[ph]!;
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
    const gCap = this.dtSec > 0 ? (2.0 * this.model.e) / this.dtSec : 0.0;

    for (let ph = 0; ph < pCount; ph++) {
      const vNow = vNode[ph] ?? 0.0;
      const vOld = this.prevV[ph]!;
      const base = ph * nP;
      for (let m = 0; m < nP; m++) {
        this.poleState[base + m] = this.alpha[m]! * this.poleState[base + m]! + this.beta[m]! * (vNow + vOld);
      }
      if (gCap > 0) {
        this.prevIc[ph] = gCap * (vNow - vOld) - this.prevIc[ph]!;
      }
      this.prevV[ph] = vNow;
    }
  }

  public captureState(): { poleState: Float64Array; prevV: Float64Array; prevIc: Float64Array } {
    return {
      poleState: new Float64Array(this.poleState),
      prevV: new Float64Array(this.prevV),
      prevIc: new Float64Array(this.prevIc),
    };
  }

  public restoreState(snap: { poleState: Float64Array; prevV: Float64Array; prevIc: Float64Array }): void {
    this.poleState.set(snap.poleState);
    this.prevV.set(snap.prevV);
    this.prevIc.set(snap.prevIc);
  }
}
