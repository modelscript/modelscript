// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/control — Frequency-Domain Analysis & Eigenstructure Decomposition.
 *
 * Computes:
 *   - Bode magnitude (dB) and unwrapped phase (deg) responses: G(jw) = C (jw I - A)^{-1} B + D
 *   - Nyquist contour, return difference min|1 + L(jw)|, and peak sensitivity M_s
 *   - Classical stability margins (Gain Margin, Phase Margin, Crossover Frequencies, -3 dB Bandwidth)
 *   - State-matrix eigenstructure (poles, damping ratios, natural frequencies) via Francis QR iteration
 */

import type { LtiStateSpaceModel } from "./linearize.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplexNumber {
  re: number;
  im: number;
}

export interface BodeResult {
  /** Angular frequencies omega in rad/s. */
  frequencies: Float64Array;
  /** Linear magnitude |G(j*omega)|. */
  magnitude: Float64Array;
  /** Magnitude in decibels: 20 * log10(|G(j*omega)|). */
  magnitudeDb: Float64Array;
  /** Continuous unwrapped phase in degrees. */
  phaseDeg: Float64Array;
  /** Complex frequency response values G(j*omega). */
  complexResponse: ComplexNumber[];
  /** DC gain |G(0)|. */
  dcGain: number;
}

export interface NyquistResult {
  /** Angular frequencies omega in rad/s. */
  frequencies: Float64Array;
  /** Real part Re(G(j*omega)). */
  real: Float64Array;
  /** Imaginary part Im(G(j*omega)). */
  imag: Float64Array;
  /** Minimum distance to the critical point (-1 + j0): min_omega |1 + G(j*omega)|. */
  minReturnDifference: number;
  /** Maximum sensitivity peak M_s = max_omega |1 / (1 + G(j*omega))|. */
  peakSensitivityMs: number;
  /** Frequency (rad/s) where peak sensitivity M_s occurs. */
  peakSensitivityFreq: number;
}

export interface StabilityMargins {
  /** Gain margin in dB (Infinity if phase never crosses -180 deg). */
  gainMarginDb: number;
  /** Phase crossover frequency omega_pc (rad/s) where phase crosses -180 deg (NaN if none). */
  phaseCrossoverFreq: number;
  /** Phase margin in degrees (Infinity if magnitude never crosses 0 dB). */
  phaseMarginDeg: number;
  /** Gain crossover frequency omega_gc (rad/s) where |G(j*omega)| = 1 (0 dB) (NaN if none). */
  gainCrossoverFreq: number;
  /** -3 dB bandwidth frequency in rad/s. */
  bandwidthFreq: number;
}

export interface PoleAnalysis {
  /** Real part sigma of eigenvalue lambda = sigma + j*omega_d. */
  real: number;
  /** Imaginary part omega_d (damped natural frequency in rad/s). */
  imag: number;
  /** Undamped natural frequency omega_n = sqrt(sigma^2 + omega_d^2) in rad/s. */
  naturalFrequency: number;
  /** Damping ratio zeta = -sigma / omega_n (1.0 for negative real poles). */
  dampingRatio: number;
  /** Effective time constant tau = -1 / sigma in seconds (Infinity if sigma == 0). */
  timeConstant: number;
  /** True if strictly in the open left-half plane (sigma < -1e-12). */
  stable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Complex Linear System Solver for (j*omega*I - A) * x = b
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Solve the complex n x n linear system (j*omega*I - A) * x = b using Gaussian elimination
 * with partial pivoting on interleaved (re, im) buffers.
 */
function solveComplexResolvant(
  A: Float64Array,
  bCol: Float64Array,
  n: number,
  omega: number,
): { re: Float64Array; im: Float64Array } {
  if (n === 0) {
    return { re: new Float64Array(0), im: new Float64Array(0) };
  }

  const matRe = new Float64Array(n * n);
  const matIm = new Float64Array(n * n);
  const rhsRe = new Float64Array(bCol);
  const rhsIm = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      matRe[i * n + j] = -A[i * n + j]!;
    }
    matIm[i * n + i] = omega;
  }

  for (let k = 0; k < n; k++) {
    let maxRow = k;
    let maxMagSq = matRe[k * n + k]! ** 2 + matIm[k * n + k]! ** 2;
    for (let i = k + 1; i < n; i++) {
      const magSq = matRe[i * n + k]! ** 2 + matIm[i * n + k]! ** 2;
      if (magSq > maxMagSq) {
        maxMagSq = magSq;
        maxRow = i;
      }
    }

    if (maxRow !== k) {
      for (let j = k; j < n; j++) {
        const tr = matRe[k * n + j]!;
        matRe[k * n + j] = matRe[maxRow * n + j]!;
        matRe[maxRow * n + j] = tr;

        const ti = matIm[k * n + j]!;
        matIm[k * n + j] = matIm[maxRow * n + j]!;
        matIm[maxRow * n + j] = ti;
      }
      const br = rhsRe[k]!;
      rhsRe[k] = rhsRe[maxRow]!;
      rhsRe[maxRow] = br;

      const bi = rhsIm[k]!;
      rhsIm[k] = rhsIm[maxRow]!;
      rhsIm[maxRow] = bi;
    }

    let pivRe = matRe[k * n + k]!;
    const pivIm = matIm[k * n + k]!;
    let denom = pivRe * pivRe + pivIm * pivIm;
    if (denom < 1e-28) {
      pivRe = 1e-14;
      matRe[k * n + k] = pivRe;
      denom = pivRe * pivRe + pivIm * pivIm;
    }

    for (let i = k + 1; i < n; i++) {
      const aRe = matRe[i * n + k]!;
      const aIm = matIm[i * n + k]!;
      // factor = (aRe + j*aIm) / (pivRe + j*pivIm)
      const fRe = (aRe * pivRe + aIm * pivIm) / denom;
      const fIm = (aIm * pivRe - aRe * pivIm) / denom;

      for (let j = k + 1; j < n; j++) {
        const mRe = matRe[k * n + j]!;
        const mIm = matIm[k * n + j]!;
        matRe[i * n + j] = matRe[i * n + j]! - (fRe * mRe - fIm * mIm);
        matIm[i * n + j] = matIm[i * n + j]! - (fRe * mIm + fIm * mRe);
      }

      const rRe = rhsRe[k]!;
      const rIm = rhsIm[k]!;
      rhsRe[i] = rhsRe[i]! - (fRe * rRe - fIm * rIm);
      rhsIm[i] = rhsIm[i]! - (fRe * rIm + fIm * rRe);
    }
  }

  const xRe = new Float64Array(n);
  const xIm = new Float64Array(n);

  for (let i = n - 1; i >= 0; i--) {
    let sumRe = rhsRe[i]!;
    let sumIm = rhsIm[i]!;
    for (let j = i + 1; j < n; j++) {
      const mRe = matRe[i * n + j]!;
      const mIm = matIm[i * n + j]!;
      sumRe -= mRe * xRe[j]! - mIm * xIm[j]!;
      sumIm -= mRe * xIm[j]! + mIm * xRe[j]!;
    }
    const dRe = matRe[i * n + i]!;
    const dIm = matIm[i * n + i]!;
    const denom = Math.max(1e-28, dRe * dRe + dIm * dIm);
    xRe[i] = (sumRe * dRe + sumIm * dIm) / denom;
    xIm[i] = (sumIm * dRe - sumRe * dIm) / denom;
  }

  return { re: xRe, im: xIm };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: Frequency Grid, Bode, Nyquist & Stability Margins
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a logarithmically spaced frequency vector from `10^log10Min` to `10^log10Max` rad/s.
 */
export function generateLogSpaceFrequencies(
  wMin: number = 1e-2,
  wMax: number = 1e3,
  numPoints: number = 200,
): Float64Array {
  const n = Math.max(2, numPoints);
  const out = new Float64Array(n);
  const logMin = Math.log10(Math.max(1e-12, wMin));
  const logMax = Math.log10(Math.max(wMin * 10, wMax));
  for (let i = 0; i < n; i++) {
    const exp = logMin + ((logMax - logMin) * i) / (n - 1);
    out[i] = 10 ** exp;
  }
  return out;
}

/**
 * Evaluate G_{outputIdx, inputIdx}(j*omega) = c_i (j*omega*I - A)^{-1} b_j + d_{ij} at a single frequency.
 */
export function evaluateTransferFunctionAt(
  sys: LtiStateSpaceModel,
  omega: number,
  inputIdx: number = 0,
  outputIdx: number = 0,
): ComplexNumber {
  const { nStates: n, nInputs: m, A, B, C, D } = sys;
  const dVal = m > 0 && sys.nOutputs > 0 ? (D[outputIdx * m + inputIdx] ?? 0) : 0;
  if (n === 0 || m === 0 || sys.nOutputs === 0) {
    return { re: dVal, im: 0 };
  }

  const bCol = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    bCol[i] = B[i * m + inputIdx] ?? 0;
  }

  const { re: xRe, im: xIm } = solveComplexResolvant(A, bCol, n, omega);

  let yRe = dVal;
  let yIm = 0;
  for (let i = 0; i < n; i++) {
    const cVal = C[outputIdx * n + i] ?? 0;
    yRe += cVal * xRe[i]!;
    yIm += cVal * xIm[i]!;
  }

  return { re: yRe, im: yIm };
}

/**
 * Compute the Bode frequency response (magnitude, dB, unwrapped phase in degrees) for channel (inputIdx -> outputIdx).
 */
export function computeBodeResponse(
  sys: LtiStateSpaceModel,
  frequencies: Float64Array = generateLogSpaceFrequencies(),
  inputIdx: number = 0,
  outputIdx: number = 0,
): BodeResult {
  const N = frequencies.length;
  const magnitude = new Float64Array(N);
  const magnitudeDb = new Float64Array(N);
  const phaseDeg = new Float64Array(N);
  const complexResponse: ComplexNumber[] = new Array(N);

  let prevPhaseRad = 0;
  let phaseOffsetRad = 0;

  for (let k = 0; k < N; k++) {
    const w = frequencies[k]!;
    const g = evaluateTransferFunctionAt(sys, w, inputIdx, outputIdx);
    complexResponse[k] = g;

    const mag = Math.hypot(g.re, g.im);
    magnitude[k] = mag;
    magnitudeDb[k] = 20 * Math.log10(Math.max(1e-16, mag));

    const rawPhaseRad = Math.atan2(g.im, g.re);
    if (k > 0) {
      const diff = rawPhaseRad - prevPhaseRad;
      if (diff > Math.PI) {
        phaseOffsetRad -= 2 * Math.PI;
      } else if (diff < -Math.PI) {
        phaseOffsetRad += 2 * Math.PI;
      }
    }
    prevPhaseRad = rawPhaseRad;
    phaseDeg[k] = ((rawPhaseRad + phaseOffsetRad) * 180) / Math.PI;
  }

  const g0 = evaluateTransferFunctionAt(sys, 0, inputIdx, outputIdx);
  const dcGain = Math.hypot(g0.re, g0.im);

  return {
    frequencies,
    magnitude,
    magnitudeDb,
    phaseDeg,
    complexResponse,
    dcGain,
  };
}

/**
 * Compute Nyquist contour and sensitivity peak M_s = max_w |1 / (1 + L(jw))| for open-loop transfer function L(s).
 */
export function computeNyquistContour(
  sys: LtiStateSpaceModel,
  frequencies: Float64Array = generateLogSpaceFrequencies(),
  inputIdx: number = 0,
  outputIdx: number = 0,
): NyquistResult {
  const N = frequencies.length;
  const real = new Float64Array(N);
  const imag = new Float64Array(N);

  let minReturnDifference = Infinity;
  let peakSensitivityFreq = frequencies[0] ?? 0;

  for (let k = 0; k < N; k++) {
    const w = frequencies[k]!;
    const g = evaluateTransferFunctionAt(sys, w, inputIdx, outputIdx);
    real[k] = g.re;
    imag[k] = g.im;

    const dist = Math.hypot(1 + g.re, g.im);
    if (dist < minReturnDifference) {
      minReturnDifference = dist;
      peakSensitivityFreq = w;
    }
  }

  const peakSensitivityMs = minReturnDifference > 1e-12 ? 1.0 / minReturnDifference : Infinity;

  return {
    frequencies,
    real,
    imag,
    minReturnDifference,
    peakSensitivityMs,
    peakSensitivityFreq,
  };
}

/**
 * Compute classical Gain Margin (dB), Phase Margin (deg), crossover frequencies, and -3 dB bandwidth from a Bode response.
 */
export function computeStabilityMargins(bode: BodeResult): StabilityMargins {
  const { frequencies, magnitudeDb, phaseDeg } = bode;
  const N = frequencies.length;

  let gainCrossoverFreq = NaN;
  let phaseMarginDeg = Infinity;

  // Find gain crossover (0 dB crossing) via log-linear interpolation
  for (let k = 0; k < N - 1; k++) {
    const m0 = magnitudeDb[k]!;
    const m1 = magnitudeDb[k + 1]!;
    if ((m0 >= 0 && m1 < 0) || (m0 <= 0 && m1 > 0)) {
      const frac = Math.abs(m0) / Math.max(1e-12, Math.abs(m0 - m1));
      const w0 = frequencies[k]!;
      const w1 = frequencies[k + 1]!;
      gainCrossoverFreq = w0 * (w1 / w0) ** frac;
      const interpPhase = phaseDeg[k]! + frac * (phaseDeg[k + 1]! - phaseDeg[k]!);
      phaseMarginDeg = 180 + interpPhase;
      break;
    }
  }

  let phaseCrossoverFreq = NaN;
  let gainMarginDb = Infinity;

  // Find phase crossover (-180 deg crossing)
  for (let k = 0; k < N - 1; k++) {
    const p0 = phaseDeg[k]! + 180;
    const p1 = phaseDeg[k + 1]! + 180;
    if ((p0 >= 0 && p1 < 0) || (p0 <= 0 && p1 > 0)) {
      const frac = Math.abs(p0) / Math.max(1e-12, Math.abs(p0 - p1));
      const w0 = frequencies[k]!;
      const w1 = frequencies[k + 1]!;
      phaseCrossoverFreq = w0 * (w1 / w0) ** frac;
      const interpMagDb = magnitudeDb[k]! + frac * (magnitudeDb[k + 1]! - magnitudeDb[k]!);
      gainMarginDb = -interpMagDb;
      break;
    }
  }

  // Find -3 dB bandwidth relative to low-frequency gain
  const refDb = magnitudeDb[0] ?? 0;
  const targetDb = refDb - 3.010299956639812;
  let bandwidthFreq = NaN;
  for (let k = 0; k < N - 1; k++) {
    const m0 = magnitudeDb[k]!;
    const m1 = magnitudeDb[k + 1]!;
    if (m0 >= targetDb && m1 < targetDb) {
      const frac = (m0 - targetDb) / Math.max(1e-12, m0 - m1);
      const w0 = frequencies[k]!;
      const w1 = frequencies[k + 1]!;
      bandwidthFreq = w0 * (w1 / w0) ** frac;
      break;
    }
  }

  return {
    gainMarginDb,
    phaseCrossoverFreq,
    phaseMarginDeg,
    gainCrossoverFreq,
    bandwidthFreq,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State Matrix Eigenstructure (Hessenberg Reduction + Francis Double-Shift QR)
// ─────────────────────────────────────────────────────────────────────────────

function reduceToUpperHessenberg(H: Float64Array, n: number): void {
  for (let k = 0; k < n - 2; k++) {
    let scale = 0;
    for (let i = k + 1; i < n; i++) {
      scale += Math.abs(H[i * n + k]!);
    }
    if (scale === 0) continue;

    let normSq = 0;
    const v = new Float64Array(n);
    for (let i = k + 1; i < n; i++) {
      v[i] = H[i * n + k]! / scale;
      normSq += v[i]! * v[i]!;
    }
    let g = Math.sqrt(normSq);
    if (v[k + 1]! >= 0) g = -g;
    const beta = normSq - v[k + 1]! * g;
    if (beta <= 0) continue;
    v[k + 1] = v[k + 1]! - g;

    // Left Householder update: H := (I - v v^T / beta) H
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = k + 1; i < n; i++) dot += v[i]! * H[i * n + j]!;
      dot /= beta;
      for (let i = k + 1; i < n; i++) H[i * n + j] = H[i * n + j]! - dot * v[i]!;
    }

    // Right Householder update: H := H (I - v v^T / beta)
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let j = k + 1; j < n; j++) dot += H[i * n + j]! * v[j]!;
      dot /= beta;
      for (let j = k + 1; j < n; j++) H[i * n + j] = H[i * n + j]! - dot * v[j]!;
    }
  }
}

/**
 * Compute eigenvalues, damping ratios, and natural frequencies of an n x n state matrix A.
 */
export function computeEigenStructure(A: Float64Array, n: number): PoleAnalysis[] {
  if (n === 0) return [];
  if (n === 1) {
    const re = A[0]!;
    const wn = Math.abs(re);
    return [
      {
        real: re,
        imag: 0,
        naturalFrequency: wn,
        dampingRatio: re <= 0 ? 1.0 : -1.0,
        timeConstant: re !== 0 ? -1.0 / re : Infinity,
        stable: re < -1e-12,
      },
    ];
  }

  const H = new Float64Array(A);
  reduceToUpperHessenberg(H, n);

  const eps = 2.220446049250313e-16;
  const poles: { re: number; im: number }[] = [];

  let m = n - 1;
  let iter = 0;
  const maxTotalIter = 60 * n;

  while (m >= 0 && iter < maxTotalIter) {
    // Check for subdiagonal deflation
    let l = m;
    while (l > 0) {
      const s = Math.abs(H[(l - 1) * n + (l - 1)]!) + Math.abs(H[l * n + l]!) || 1.0;
      if (Math.abs(H[l * n + (l - 1)]!) <= eps * s) {
        H[l * n + (l - 1)] = 0;
        break;
      }
      l--;
    }

    if (l === m) {
      // 1x1 block converged
      poles.push({ re: H[m * n + m]!, im: 0 });
      m--;
      continue;
    }

    if (l === m - 1) {
      // 2x2 block: check if complex conjugate or two real eigenvalues
      const a = H[(m - 1) * n + (m - 1)]!;
      const b = H[(m - 1) * n + m]!;
      const c = H[m * n + (m - 1)]!;
      const d = H[m * n + m]!;
      const tr = a + d;
      const det = a * d - b * c;
      const disc = tr * tr - 4 * det;
      if (disc < 0) {
        const re = 0.5 * tr;
        const im = 0.5 * Math.sqrt(-disc);
        poles.push({ re, im });
        poles.push({ re, im: -im });
      } else {
        const sqrtDisc = Math.sqrt(disc);
        poles.push({ re: 0.5 * (tr + sqrtDisc), im: 0 });
        poles.push({ re: 0.5 * (tr - sqrtDisc), im: 0 });
      }
      m -= 2;
      continue;
    }

    // Perform shifted QR step on submatrix l..m using Wilkinson shift
    iter++;
    const a = H[(m - 1) * n + (m - 1)]!;
    const b = H[(m - 1) * n + m]!;
    const c = H[m * n + (m - 1)]!;
    const d = H[m * n + m]!;
    const tr = a + d;
    const det = a * d - b * c;
    const disc = tr * tr - 4 * det;
    let shift = d;
    if (disc >= 0) {
      const r1 = 0.5 * (tr + Math.sqrt(disc));
      const r2 = 0.5 * (tr - Math.sqrt(disc));
      shift = Math.abs(r1 - d) < Math.abs(r2 - d) ? r1 : r2;
    }

    for (let i = l; i <= m; i++) {
      H[i * n + i] = H[i * n + i]! - shift;
    }

    const cs = new Float64Array(m - l);
    const sn = new Float64Array(m - l);
    for (let i = l; i < m; i++) {
      const x = H[i * n + i]!;
      const y = H[(i + 1) * n + i]!;
      const r = Math.hypot(x, y);
      const cos = r > 0 ? x / r : 1.0;
      const sin = r > 0 ? -y / r : 0.0;
      cs[i - l] = cos;
      sn[i - l] = sin;

      for (let j = i; j < n; j++) {
        const t1 = H[i * n + j]!;
        const t2 = H[(i + 1) * n + j]!;
        H[i * n + j] = cos * t1 - sin * t2;
        H[(i + 1) * n + j] = sin * t1 + cos * t2;
      }
    }

    for (let i = l; i < m; i++) {
      const cos = cs[i - l]!;
      const sin = sn[i - l]!;
      for (let r = 0; r <= Math.min(m, i + 2); r++) {
        const t1 = H[r * n + i]!;
        const t2 = H[r * n + (i + 1)]!;
        H[r * n + i] = cos * t1 - sin * t2;
        H[r * n + (i + 1)] = sin * t1 + cos * t2;
      }
    }

    for (let i = l; i <= m; i++) {
      H[i * n + i] = H[i * n + i]! + shift;
    }
  }

  return poles
    .sort((p1, p2) => p2.re - p1.re || Math.abs(p1.im) - Math.abs(p2.im))
    .map(({ re, im }) => {
      const wn = Math.hypot(re, im);
      const zeta = wn > 1e-15 ? -re / wn : 1.0;
      const tau = Math.abs(re) > 1e-15 ? -1.0 / re : Infinity;
      return {
        real: re,
        imag: im,
        naturalFrequency: wn,
        dampingRatio: zeta,
        timeConstant: tau,
        stable: re < -1e-12,
      };
    });
}
