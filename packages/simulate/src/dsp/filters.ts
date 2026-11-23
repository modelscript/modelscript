// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Digital Filter Design & Zero-Phase Filtering.
 *
 * Supports:
 *   - Butterworth Lowpass & Highpass IIR filters via bilinear transform (biquad SOS cascade)
 *   - Zero-phase forward-backward filtering (`filtfilt`)
 *   - Savitzky-Golay polynomial smoothing filter (for noisy digital twin telemetry)
 */

import { solveDenseLinear } from "@modelscript/runtime";

export interface BiquadSection {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/**
 * Designs a cascaded second-order-section (SOS) Butterworth lowpass or highpass filter
 * using the bilinear transform with frequency pre-warping.
 */
export function designButterworth(
  order: number,
  cutoffHz: number,
  sampleRateHz: number,
  type: "lowpass" | "highpass" = "lowpass",
): BiquadSection[] {
  const n = Math.max(1, Math.floor(order));
  const clampedFc = Math.min(Math.max(cutoffHz, 1e-6), sampleRateHz * 0.499);
  const K = Math.tan((Math.PI * clampedFc) / sampleRateHz);
  const K2 = K * K;
  const sections: BiquadSection[] = [];

  const numPairs = Math.floor(n / 2);
  for (let k = 0; k < numPairs; k++) {
    const theta = (Math.PI * (2 * k + 1)) / (2 * n);
    const qInv = 2.0 * Math.cos(theta);
    const norm = 1.0 / (1.0 + qInv * K + K2);
    if (type === "lowpass") {
      sections.push({
        b0: K2 * norm,
        b1: 2.0 * K2 * norm,
        b2: K2 * norm,
        a1: 2.0 * (K2 - 1.0) * norm,
        a2: (1.0 - qInv * K + K2) * norm,
      });
    } else {
      sections.push({
        b0: norm,
        b1: -2.0 * norm,
        b2: norm,
        a1: 2.0 * (K2 - 1.0) * norm,
        a2: (1.0 - qInv * K + K2) * norm,
      });
    }
  }

  if (n % 2 === 1) {
    const norm = 1.0 / (1.0 + K);
    if (type === "lowpass") {
      sections.push({ b0: K * norm, b1: K * norm, b2: 0, a1: (K - 1.0) * norm, a2: 0 });
    } else {
      sections.push({ b0: norm, b1: -norm, b2: 0, a1: (K - 1.0) * norm, a2: 0 });
    }
  }

  return sections;
}

/** Applies a cascade of biquad sections (Direct Form II Transposed). */
export function applySosFilter(
  signal: Readonly<Float64Array | number[]>,
  sections: readonly BiquadSection[],
): Float64Array {
  let x = Float64Array.from(signal);
  const n = x.length;
  for (const s of sections) {
    const y = new Float64Array(n);
    let z1 = 0.0;
    let z2 = 0.0;
    for (let i = 0; i < n; i++) {
      const xi = x[i]!;
      const yi = s.b0 * xi + z1;
      z1 = s.b1 * xi - s.a1 * yi + z2;
      z2 = s.b2 * xi - s.a2 * yi;
      y[i] = yi;
    }
    x = y;
  }
  return x;
}

/** Zero-phase forward-backward IIR filtering (`filtfilt`). */
export function filtfilt(signal: Readonly<Float64Array | number[]>, sections: readonly BiquadSection[]): Float64Array {
  const fwd = applySosFilter(signal, sections);
  const revIn = new Float64Array(fwd.length);
  for (let i = 0; i < fwd.length; i++) revIn[i] = fwd[fwd.length - 1 - i]!;
  const bwd = applySosFilter(revIn, sections);
  const out = new Float64Array(bwd.length);
  for (let i = 0; i < bwd.length; i++) out[i] = bwd[bwd.length - 1 - i]!;
  return out;
}

/**
 * Computes Savitzky-Golay FIR smoothing coefficients and applies them to `signal`.
 */
export function savitzkyGolayFilter(
  signal: Readonly<Float64Array | number[]>,
  windowSize = 7,
  polyOrder = 2,
): Float64Array {
  const m = Math.max(1, Math.floor(windowSize / 2));
  const win = 2 * m + 1;
  const p = Math.min(polyOrder, win - 1) + 1;

  // Build normal equations (J^T J) c = J^T e_0 where J_{i,k} = (i - m)^k
  const JTJ = new Float64Array(p * p);
  const J = new Float64Array(win * p);
  for (let i = 0; i < win; i++) {
    let val = 1.0;
    const x = i - m;
    for (let k = 0; k < p; k++) {
      J[i * p + k] = val;
      val *= x;
    }
  }
  for (let i = 0; i < win; i++) {
    for (let r = 0; r < p; r++) {
      for (let c = 0; c < p; c++) {
        JTJ[r * p + c] = JTJ[r * p + c]! + J[i * p + r]! * J[i * p + c]!;
      }
    }
  }

  // Solve for row 0 of (J^T J)^{-1} -> filter weights h_i = (e_0^T (J^T J)^{-1} J^T)_i
  const e0 = new Float64Array(p);
  e0[0] = 1.0;
  const u = solveDenseLinear(JTJ, e0, p);
  const coeffs = new Float64Array(win);
  for (let i = 0; i < win; i++) {
    let sum = 0.0;
    for (let k = 0; k < p; k++) sum += u[k]! * J[i * p + k]!;
    coeffs[i] = sum;
  }

  const n = signal.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0.0;
    for (let j = -m; j <= m; j++) {
      const idx = Math.max(0, Math.min(n - 1, i + j));
      acc += coeffs[j + m]! * signal[idx]!;
    }
    out[i] = acc;
  }
  return out;
}
