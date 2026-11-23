// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Seismic Signal Processing Solver for `@modelscript/segy`:
 * - Ricker, Ormsby, and Klauder wavelet synthesis
 * - Normal Moveout (NMO) hyperbolic traveltime t(x) = sqrt(t0^2 + x^2 / v^2) & trace flattening
 * - Iterative Cooley-Tukey radix-2 FFT / IFFT and amplitude/phase spectrum analysis
 * - Zero-phase frequency-domain bandpass filtering
 * - RMS and Automatic Gain Control (AGC) trace gain
 */

export interface FftResult {
  real: Float64Array;
  imag: Float64Array;
  n: number;
}

export interface SpectrumResult {
  frequenciesHz: Float64Array;
  amplitude: Float64Array;
  phaseRad: Float64Array;
  peakFrequencyHz: number;
  peakAmplitude: number;
}

/**
 * Synthesizes a zero-phase Ricker (Mexican hat) wavelet:
 *   w(τ) = (1 - 2 π² f0² τ²) * exp(-π² f0² τ²), where τ = t - delaySec.
 */
export function rickerWavelet(
  dominantFreqHz: number,
  dtSec: number,
  nSamples: number,
  delaySec?: number,
): Float32Array {
  const out = new Float32Array(nSamples);
  const t0 = delaySec ?? ((nSamples - 1) * dtSec) / 2;
  const pf2 = Math.PI * Math.PI * dominantFreqHz * dominantFreqHz;
  for (let i = 0; i < nSamples; i++) {
    const tau = i * dtSec - t0;
    const a = pf2 * tau * tau;
    out[i] = (1 - 2 * a) * Math.exp(-a);
  }
  return out;
}

function sincSquaredTerm(f: number, tau: number): number {
  const x = Math.PI * f * tau;
  if (Math.abs(x) < 1e-12) return f * f;
  const s = Math.sin(x) / x;
  return f * f * s * s;
}

/**
 * Synthesizes a zero-phase Ormsby trapezoidal bandpass wavelet with corner frequencies f1 < f2 < f3 < f4 (Hz).
 */
export function ormsbyWavelet(
  f1Hz: number,
  f2Hz: number,
  f3Hz: number,
  f4Hz: number,
  dtSec: number,
  nSamples: number,
  delaySec?: number,
): Float32Array {
  const out = new Float32Array(nSamples);
  const t0 = delaySec ?? ((nSamples - 1) * dtSec) / 2;
  const dHigh = Math.max(1e-9, f4Hz - f3Hz);
  const dLow = Math.max(1e-9, f2Hz - f1Hz);
  let maxAbs = 0;

  for (let i = 0; i < nSamples; i++) {
    const tau = i * dtSec - t0;
    const highTerm = (sincSquaredTerm(f4Hz, tau) - sincSquaredTerm(f3Hz, tau)) / dHigh;
    const lowTerm = (sincSquaredTerm(f2Hz, tau) - sincSquaredTerm(f1Hz, tau)) / dLow;
    const val = Math.PI * (highTerm - lowTerm);
    out[i] = val;
    const absVal = Math.abs(val);
    if (absVal > maxAbs) maxAbs = absVal;
  }

  if (maxAbs > 0) {
    for (let i = 0; i < nSamples; i++) {
      out[i] = out[i]! / maxAbs;
    }
  }
  return out;
}

/**
 * Synthesizes a zero-phase Klauder autocorrelation wavelet (Vibroseis sweep fLow..fHigh Hz over sweepLenSec).
 */
export function klauderWavelet(
  fLowHz: number,
  fHighHz: number,
  sweepLenSec: number,
  dtSec: number,
  nSamples: number,
  delaySec?: number,
): Float32Array {
  const out = new Float32Array(nSamples);
  const t0 = delaySec ?? ((nSamples - 1) * dtSec) / 2;
  const fMid = 0.5 * (fLowHz + fHighHz);
  const k = (fHighHz - fLowHz) / Math.max(1e-9, sweepLenSec);
  let maxAbs = 0;

  for (let i = 0; i < nSamples; i++) {
    const tau = i * dtSec - t0;
    const absTau = Math.abs(tau);
    if (absTau >= sweepLenSec) {
      out[i] = 0;
      continue;
    }
    const arg = Math.PI * k * tau * (sweepLenSec - absTau);
    const env = Math.abs(arg) < 1e-12 ? 1.0 : Math.sin(arg) / arg;
    const val = env * Math.cos(2 * Math.PI * fMid * tau);
    out[i] = val;
    if (Math.abs(val) > maxAbs) maxAbs = Math.abs(val);
  }

  if (maxAbs > 0) {
    for (let i = 0; i < nSamples; i++) {
      out[i] = out[i]! / maxAbs;
    }
  }
  return out;
}

/**
 * Hyperbolic Normal Moveout (NMO) traveltime equation:
 *   t(x) = sqrt(t0^2 + x^2 / v^2)
 */
export function nmoTraveltime(t0Sec: number, offsetM: number, velocityMps: number): number {
  const ratio = offsetM / Math.max(1e-9, velocityMps);
  return Math.sqrt(t0Sec * t0Sec + ratio * ratio);
}

/**
 * Applies Normal Moveout (NMO) correction to a seismic trace using linear interpolation,
 * mapping samples from hyperbolic arrival time t(x) back to zero-offset time t0.
 *
 * @param stretchMutePct Maximum fractional NMO stretch allowed before muting (e.g. 0.5 = 50%, default Infinity = no mute).
 */
export function applyNmoCorrection(
  trace: ArrayLike<number>,
  dtSec: number,
  offsetM: number,
  velocityMps: number | ArrayLike<number>,
  stretchMutePct: number = Number.POSITIVE_INFINITY,
): Float32Array {
  const n = trace.length;
  const out = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t0 = i * dtSec;
    const v = typeof velocityMps === "number" ? velocityMps : (velocityMps[i] ?? 2000);
    const tx = nmoTraveltime(t0, offsetM, v);

    if (Number.isFinite(stretchMutePct) && t0 > 0) {
      const stretch = (tx - t0) / t0;
      if (stretch > stretchMutePct) {
        out[i] = 0;
        continue;
      }
    }

    const fIdx = tx / dtSec;
    const i0 = Math.floor(fIdx);
    if (i0 < 0 || i0 >= n - 1) {
      out[i] = i0 === n - 1 ? trace[n - 1]! : 0;
      continue;
    }
    const frac = fIdx - i0;
    out[i] = trace[i0]! * (1 - frac) + trace[i0 + 1]! * frac;
  }

  return out;
}

/**
 * Returns the smallest power of two >= n.
 */
export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Iterative Cooley-Tukey radix-2 FFT (automatically zero-pads to next power of 2 if needed).
 */
export function radix2Fft(realIn: ArrayLike<number>, imagIn?: ArrayLike<number>): FftResult {
  const n = nextPowerOfTwo(Math.max(1, realIn.length));
  const real = new Float64Array(n);
  const imag = new Float64Array(n);

  for (let i = 0; i < realIn.length; i++) {
    real[i] = realIn[i]!;
  }
  if (imagIn) {
    for (let i = 0; i < Math.min(n, imagIn.length); i++) {
      imag[i] = imagIn[i]!;
    }
  }

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i]!;
      real[i] = real[j]!;
      real[j] = tr;
      const ti = imag[i]!;
      imag[i] = imag[j]!;
      imag[j] = ti;
    }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wLenRe = Math.cos(ang);
    const wLenIm = Math.sin(ang);

    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let j = 0; j < half; j++) {
        const uRe = real[i + j]!;
        const uIm = imag[i + j]!;
        const vRe = real[i + j + half]! * wRe - imag[i + j + half]! * wIm;
        const vIm = real[i + j + half]! * wIm + imag[i + j + half]! * wRe;

        real[i + j] = uRe + vRe;
        imag[i + j] = uIm + vIm;
        real[i + j + half] = uRe - vRe;
        imag[i + j + half] = uIm - vIm;

        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }

  return { real, imag, n };
}

/**
 * Inverse radix-2 FFT via conjugate forward FFT.
 */
export function radix2Ifft(realIn: ArrayLike<number>, imagIn: ArrayLike<number>): FftResult {
  const n = nextPowerOfTwo(Math.max(1, realIn.length));
  const conjImag = new Float64Array(n);
  for (let i = 0; i < Math.min(n, imagIn.length); i++) {
    conjImag[i] = -imagIn[i]!;
  }
  const fwd = radix2Fft(realIn, conjImag);
  const invN = 1.0 / fwd.n;
  for (let i = 0; i < fwd.n; i++) {
    fwd.real[i] = fwd.real[i]! * invN;
    fwd.imag[i] = -fwd.imag[i]! * invN;
  }
  return fwd;
}

/**
 * Computes the single-sided amplitude and phase spectrum of a real seismic trace.
 */
export function computeAmplitudePhaseSpectrum(
  samples: ArrayLike<number>,
  dtSec: number,
  fftSize?: number,
): SpectrumResult {
  const n = nextPowerOfTwo(Math.max(samples.length, fftSize ?? samples.length));
  const padded = new Float64Array(n);
  for (let i = 0; i < samples.length; i++) padded[i] = samples[i]!;

  const { real, imag } = radix2Fft(padded);
  const half = (n >> 1) + 1;
  const df = 1.0 / (n * dtSec);

  const frequenciesHz = new Float64Array(half);
  const amplitude = new Float64Array(half);
  const phaseRad = new Float64Array(half);

  let peakFreq = 0;
  let peakAmp = -1;

  for (let k = 0; k < half; k++) {
    const f = k * df;
    const re = real[k]!;
    const im = imag[k]!;
    const amp = Math.hypot(re, im);
    frequenciesHz[k] = f;
    amplitude[k] = amp;
    phaseRad[k] = Math.atan2(im, re);
    if (amp > peakAmp) {
      peakAmp = amp;
      peakFreq = f;
    }
  }

  return {
    frequenciesHz,
    amplitude,
    phaseRad,
    peakFrequencyHz: peakFreq,
    peakAmplitude: peakAmp,
  };
}

/**
 * Applies a zero-phase frequency-domain bandpass filter with raised-cosine roll-off tapers.
 */
export function zeroPhaseBandpassFilter(
  samples: ArrayLike<number>,
  dtSec: number,
  lowCutHz: number,
  highCutHz: number,
  taperHz: number = 4.0,
): Float32Array {
  const nOrig = samples.length;
  if (nOrig === 0) return new Float32Array(0);

  const n = nextPowerOfTwo(nOrig);
  const { real, imag } = radix2Fft(samples);
  const df = 1.0 / (n * dtSec);
  const half = n >> 1;

  const gainAtFreq = (f: number): number => {
    const fLo0 = Math.max(0, lowCutHz - taperHz);
    const fHi1 = highCutHz + taperHz;
    if (f <= fLo0 || f >= fHi1) return 0;
    if (f >= lowCutHz && f <= highCutHz) return 1;
    if (f < lowCutHz) {
      const x = (f - fLo0) / Math.max(1e-9, lowCutHz - fLo0);
      return 0.5 * (1 - Math.cos(Math.PI * x));
    }
    const x = (fHi1 - f) / Math.max(1e-9, fHi1 - highCutHz);
    return 0.5 * (1 - Math.cos(Math.PI * x));
  };

  for (let k = 0; k <= half; k++) {
    const g = gainAtFreq(k * df);
    real[k] = real[k]! * g;
    imag[k] = imag[k]! * g;
    if (k > 0 && k < half) {
      const mirror = n - k;
      real[mirror] = real[mirror]! * g;
      imag[mirror] = imag[mirror]! * g;
    }
  }

  const inv = radix2Ifft(real, imag);
  const out = new Float32Array(nOrig);
  for (let i = 0; i < nOrig; i++) {
    out[i] = inv.real[i]!;
  }
  return out;
}

/**
 * Normalizes a seismic trace to a target RMS amplitude.
 */
export function applyRmsGain(samples: ArrayLike<number>, targetRms: number = 1.0): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  if (n === 0) return out;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i]!;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms <= 1e-12) return out;

  const scale = targetRms / rms;
  for (let i = 0; i < n; i++) {
    out[i] = samples[i]! * scale;
  }
  return out;
}

/**
 * Applies sliding-window Automatic Gain Control (AGC) to equalize seismic trace amplitude over time.
 */
export function applyAgcGain(samples: ArrayLike<number>, windowSamples: number, epsilon: number = 1e-6): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  if (n === 0) return out;

  const halfWin = Math.max(1, Math.floor(windowSamples / 2));
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(n - 1, i + halfWin);
    let sumSq = 0;
    const count = hi - lo + 1;
    for (let j = lo; j <= hi; j++) {
      const v = samples[j]!;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / count);
    out[i] = samples[i]! / (rms + epsilon);
  }
  return out;
}
