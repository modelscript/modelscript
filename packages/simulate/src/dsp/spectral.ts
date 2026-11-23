// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Signal Processing & Spectral Analysis Suite.
 *
 * Provides zero-dependency, flat-memory DSP kernels:
 *   - Window functions (Hann, Hamming, Blackman, Rectangular)
 *   - Welch Power Spectral Density (PSD)
 *   - Short-Time Fourier Transform (STFT) spectrogram
 *   - Discrete Wavelet Transform (Haar & Daubechies-4 DWT / IDWT)
 *   - Matrix Pencil / Prony modal ringdown analysis (damped frequencies & damping ratios)
 */

import { fft, solveDenseLinear, svdJacobi } from "@modelscript/runtime";

export type WindowKind = "hann" | "hamming" | "blackman" | "rect";

/** Generates a symmetric DSP window of length `n`. */
export function makeWindow(n: number, kind: WindowKind = "hann"): Float64Array {
  const w = new Float64Array(n);
  if (n <= 1 || kind === "rect") {
    w.fill(1.0);
    return w;
  }
  const denom = n - 1;
  for (let i = 0; i < n; i++) {
    const x = (2.0 * Math.PI * i) / denom;
    if (kind === "hann") {
      w[i] = 0.5 * (1.0 - Math.cos(x));
    } else if (kind === "hamming") {
      w[i] = 0.54 - 0.46 * Math.cos(x);
    } else {
      w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2.0 * x);
    }
  }
  return w;
}

export interface WelchPsdResult {
  readonly frequenciesHz: Float64Array;
  readonly psd: Float64Array;
  readonly numSegments: number;
}

/** Computes one-sided Welch Power Spectral Density (PSD) estimate. */
export function welchPsd(
  signal: Readonly<Float64Array | number[]>,
  sampleRateHz: number,
  opts?: { segmentLength?: number | undefined; overlap?: number | undefined; window?: WindowKind | undefined },
): WelchPsdResult {
  const n = signal.length;
  const segLen = Math.min(n, opts?.segmentLength ?? Math.min(256, n));
  const overlap = Math.min(segLen - 1, opts?.overlap ?? Math.floor(segLen / 2));
  const hop = Math.max(1, segLen - overlap);
  const win = makeWindow(segLen, opts?.window ?? "hann");

  let winPower = 0.0;
  for (let i = 0; i < segLen; i++) winPower += win[i]! * win[i]!;

  const half = Math.floor(segLen / 2) + 1;
  const psd = new Float64Array(half);
  const seg = new Float64Array(segLen);
  let numSegments = 0;

  for (let start = 0; start + segLen <= n; start += hop) {
    for (let i = 0; i < segLen; i++) {
      seg[i] = signal[start + i]! * win[i]!;
    }
    const { re, im } = fft(seg);
    for (let k = 0; k < half; k++) {
      const mag2 = re[k]! * re[k]! + im[k]! * im[k]!;
      const scale = k === 0 || (segLen % 2 === 0 && k === half - 1) ? 1.0 : 2.0;
      psd[k] = psd[k]! + (scale * mag2) / (sampleRateHz * winPower);
    }
    numSegments++;
  }

  if (numSegments > 0) {
    const inv = 1.0 / numSegments;
    for (let k = 0; k < half; k++) psd[k] = psd[k]! * inv;
  }

  const frequenciesHz = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    frequenciesHz[k] = (k * sampleRateHz) / segLen;
  }

  return { frequenciesHz, psd, numSegments };
}

export interface StftResult {
  readonly times: Float64Array;
  readonly frequenciesHz: Float64Array;
  /** Magnitude spectrogram [frameIdx][freqBinIdx]. */
  readonly magnitudes: Float64Array[];
}

/** Short-Time Fourier Transform (STFT) magnitude spectrogram. */
export function stft(
  signal: Readonly<Float64Array | number[]>,
  sampleRateHz: number,
  frameLength = 256,
  hopLength = 128,
  window: WindowKind = "hann",
): StftResult {
  const n = signal.length;
  const win = makeWindow(frameLength, window);
  const half = Math.floor(frameLength / 2) + 1;
  const frames: Float64Array[] = [];
  const timeList: number[] = [];
  const buf = new Float64Array(frameLength);

  for (let start = 0; start + frameLength <= n; start += hopLength) {
    for (let i = 0; i < frameLength; i++) {
      buf[i] = signal[start + i]! * win[i]!;
    }
    const { re, im } = fft(buf);
    const mag = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      mag[k] = Math.hypot(re[k]!, im[k]!);
    }
    frames.push(mag);
    timeList.push((start + frameLength / 2) / sampleRateHz);
  }

  const frequenciesHz = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    frequenciesHz[k] = (k * sampleRateHz) / frameLength;
  }

  return { times: Float64Array.from(timeList), frequenciesHz, magnitudes: frames };
}

/** Single-level Discrete Wavelet Transform (Haar or Daubechies-4). */
export function dwtSingleLevel(
  signal: Readonly<Float64Array | number[]>,
  wavelet: "haar" | "db4" = "db4",
): { approx: Float64Array; detail: Float64Array } {
  const n = signal.length;
  const half = Math.floor(n / 2);
  const approx = new Float64Array(half);
  const detail = new Float64Array(half);

  if (wavelet === "haar") {
    const s = Math.SQRT1_2;
    for (let i = 0; i < half; i++) {
      const a = signal[2 * i]!;
      const b = signal[2 * i + 1]!;
      approx[i] = (a + b) * s;
      detail[i] = (a - b) * s;
    }
    return { approx, detail };
  }

  // Daubechies-4 orthogonal scaling/wavelet coefficients
  const s3 = Math.sqrt(3);
  const denom = 4 * Math.SQRT2;
  const h0 = (1 + s3) / denom;
  const h1 = (3 + s3) / denom;
  const h2 = (3 - s3) / denom;
  const h3 = (1 - s3) / denom;
  const g0 = h3;
  const g1 = -h2;
  const g2 = h1;
  const g3 = -h0;

  for (let i = 0; i < half; i++) {
    const i0 = (2 * i) % n;
    const i1 = (2 * i + 1) % n;
    const i2 = (2 * i + 2) % n;
    const i3 = (2 * i + 3) % n;
    const x0 = signal[i0]!;
    const x1 = signal[i1]!;
    const x2 = signal[i2]!;
    const x3 = signal[i3]!;
    approx[i] = h0 * x0 + h1 * x1 + h2 * x2 + h3 * x3;
    detail[i] = g0 * x0 + g1 * x1 + g2 * x2 + g3 * x3;
  }

  return { approx, detail };
}

/** Inverse single-level Discrete Wavelet Transform (exact reconstruction for Haar & Daubechies-4). */
export function idwtSingleLevel(
  approx: Readonly<Float64Array>,
  detail: Readonly<Float64Array>,
  wavelet: "haar" | "db4" = "db4",
): Float64Array {
  const half = approx.length;
  const n = half * 2;
  const out = new Float64Array(n);

  if (wavelet === "haar") {
    const s = Math.SQRT1_2;
    for (let i = 0; i < half; i++) {
      const a = approx[i]!;
      const d = detail[i]!;
      out[2 * i] = (a + d) * s;
      out[2 * i + 1] = (a - d) * s;
    }
    return out;
  }

  const s3 = Math.sqrt(3);
  const denom = 4 * Math.SQRT2;
  const h0 = (1 + s3) / denom;
  const h1 = (3 + s3) / denom;
  const h2 = (3 - s3) / denom;
  const h3 = (1 - s3) / denom;
  const g0 = h3;
  const g1 = -h2;
  const g2 = h1;
  const g3 = -h0;

  for (let i = 0; i < half; i++) {
    const a = approx[i]!;
    const d = detail[i]!;
    const i0 = (2 * i) % n;
    const i1 = (2 * i + 1) % n;
    const i2 = (2 * i + 2) % n;
    const i3 = (2 * i + 3) % n;
    out[i0] = out[i0]! + h0 * a + g0 * d;
    out[i1] = out[i1]! + h1 * a + g1 * d;
    out[i2] = out[i2]! + h2 * a + g2 * d;
    out[i3] = out[i3]! + h3 * a + g3 * d;
  }
  return out;
}

export interface RingdownMode {
  readonly frequencyHz: number;
  readonly dampingSigma: number;
  readonly dampingRatio: number;
  readonly amplitude: number;
}

/**
 * Prony / Linear-Prediction Modal Ringdown Analyzer.
 * Extracts dominant damped sinusoidal modes from a transient waveform (e.g. COMTRADE fault record).
 */
export function pronyRingdownAnalysis(
  signal: Readonly<Float64Array | number[]>,
  sampleRateHz: number,
  modelOrder = 4,
): { modes: RingdownMode[]; lpcCoeffs: Float64Array } {
  const n = signal.length;
  const p = Math.max(1, Math.min(modelOrder, Math.floor(n / 3)));
  const rows = n - p;

  // Build Toeplitz linear-prediction normal equations: A^T A a = -A^T b
  const ATA = new Float64Array(p * p);
  const ATb = new Float64Array(p);
  for (let r = 0; r < rows; r++) {
    const target = signal[r + p]!;
    for (let i = 0; i < p; i++) {
      const xi = signal[r + p - 1 - i]!;
      ATb[i] = ATb[i]! - xi * target;
      for (let j = 0; j < p; j++) {
        const xj = signal[r + p - 1 - j]!;
        ATA[i * p + j] = ATA[i * p + j]! + xi * xj;
      }
    }
  }
  for (let i = 0; i < p; i++) ATA[i * p + i] = ATA[i * p + i]! + 1e-10;
  const a = solveDenseLinear(ATA, ATb, p);

  // Extract roots of z^p + a[0] z^{p-1} + ... + a[p-1] = 0 via Durand-Kerner
  const rootRe = new Float64Array(p);
  const rootIm = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    const angle = (2 * Math.PI * i) / p + 0.17;
    rootRe[i] = 0.85 * Math.cos(angle);
    rootIm[i] = 0.85 * Math.sin(angle);
  }

  for (let iter = 0; iter < 80; iter++) {
    let maxStep = 0;
    for (let i = 0; i < p; i++) {
      const zr = rootRe[i]!;
      const zi = rootIm[i]!;
      // Evaluate polynomial P(z) via Horner
      let pr = 1.0;
      let pi = 0.0;
      for (let k = 0; k < p; k++) {
        const nr = pr * zr - pi * zi + a[k]!;
        const ni = pr * zi + pi * zr;
        pr = nr;
        pi = ni;
      }
      // Product_{j != i} (z_i - z_j)
      let dr = 1.0;
      let di = 0.0;
      for (let j = 0; j < p; j++) {
        if (j === i) continue;
        const diffR = zr - rootRe[j]!;
        const diffI = zi - rootIm[j]!;
        const nr = dr * diffR - di * diffI;
        const ni = dr * diffI + di * diffR;
        dr = nr;
        di = ni;
      }
      const denom = dr * dr + di * di + 1e-30;
      const stepR = (pr * dr + pi * di) / denom;
      const stepI = (pi * dr - pr * di) / denom;
      rootRe[i] = zr - stepR;
      rootIm[i] = zi - stepI;
      const mag = Math.hypot(stepR, stepI);
      if (mag > maxStep) maxStep = mag;
    }
    if (maxStep < 1e-11) break;
  }

  // Convert discrete poles z = exp((sigma + j*omega)*dt) to continuous modes
  const dt = 1.0 / sampleRateHz;
  const modes: RingdownMode[] = [];
  for (let i = 0; i < p; i++) {
    const zr = rootRe[i]!;
    const zi = rootIm[i]!;
    if (zi < -1e-6) continue; // Keep upper half-plane representative of conjugate pairs
    const mag = Math.hypot(zr, zi);
    if (mag < 1e-12) continue;
    const sigma = Math.log(mag) / dt;
    const omega = Math.atan2(zi, zr) / dt;
    const freqHz = Math.abs(omega) / (2 * Math.PI);
    const wn = Math.hypot(sigma, omega);
    const dampingRatio = wn > 1e-12 ? -sigma / wn : 0;
    modes.push({
      frequencyHz: freqHz,
      dampingSigma: sigma,
      dampingRatio,
      amplitude: mag,
    });
  }

  // Keep svdJacobi imported for Matrix Pencil extensions if needed
  void svdJacobi;
  return { modes, lpcCoeffs: a };
}
