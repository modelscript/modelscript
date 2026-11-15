// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WaveformInput } from "./types.js";

/** Generate a unit/scaled first- or second-order-like step response waveform for tests. */
export function stepSignal(
  options: {
    duration?: number;
    dt?: number;
    stepTime?: number;
    initialValue?: number;
    finalValue?: number;
    tau?: number;
    overshoot?: number;
  } = {},
): WaveformInput {
  const duration = options.duration ?? 2.0;
  const dt = options.dt ?? 0.01;
  const stepTime = options.stepTime ?? 0.0;
  const y0 = options.initialValue ?? 0.0;
  const yInf = options.finalValue ?? 1.0;
  const tau = Math.max(1e-6, options.tau ?? 0.2);
  const overshoot = options.overshoot ?? 0.0;

  const n = Math.max(2, Math.floor(duration / dt) + 1);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const span = yInf - y0;

  for (let i = 0; i < n; i++) {
    const t = i * dt;
    x[i] = t;
    if (t < stepTime) {
      y[i] = y0;
    } else {
      const ts = t - stepTime;
      const base = 1 - Math.exp(-ts / tau);
      const ring = overshoot > 0 ? overshoot * Math.exp(-ts / (tau * 1.5)) * Math.sin((Math.PI * ts) / tau) : 0;
      y[i] = y0 + span * (base + ring);
    }
  }
  return { x, y };
}

/** Generate a sinusoidal waveform for spectral/FFT/THD tests. */
export function sineSignal(
  options: {
    freqHz?: number;
    amplitude?: number;
    dcOffset?: number;
    phaseRad?: number;
    duration?: number;
    sampleRateHz?: number;
  } = {},
): WaveformInput {
  const freqHz = options.freqHz ?? 50;
  const amp = options.amplitude ?? 1.0;
  const dc = options.dcOffset ?? 0.0;
  const phase = options.phaseRad ?? 0.0;
  const duration = options.duration ?? 0.1;
  const sr = options.sampleRateHz ?? 2000;

  const n = Math.max(2, Math.floor(duration * sr));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = t;
    y[i] = dc + amp * Math.sin(2 * Math.PI * freqHz * t + phase);
  }
  return { x, y };
}

/** Generate a linear frequency sweep (chirp) waveform from `f0Hz` to `f1Hz`. */
export function chirpSignal(
  options: {
    f0Hz?: number;
    f1Hz?: number;
    amplitude?: number;
    duration?: number;
    sampleRateHz?: number;
  } = {},
): WaveformInput {
  const f0 = options.f0Hz ?? 1;
  const f1 = options.f1Hz ?? 50;
  const amp = options.amplitude ?? 1.0;
  const duration = options.duration ?? 1.0;
  const sr = options.sampleRateHz ?? 1000;

  const n = Math.max(2, Math.floor(duration * sr));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const k = (f1 - f0) / Math.max(1e-9, duration);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = t;
    y[i] = amp * Math.sin(2 * Math.PI * (f0 * t + 0.5 * k * t * t));
  }
  return { x, y };
}

/** Add deterministic zero-mean Gaussian noise (Box-Muller with LCG seed) to a waveform. */
export function addGaussianNoise(waveform: WaveformInput, sigma: number, seed = 1337): WaveformInput {
  const n = Math.min(waveform.x.length, waveform.y.length);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let state = seed >>> 0;
  const nextUniform = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return Math.max(1e-12, state / 0x100000000);
  };

  for (let i = 0; i < n; i += 2) {
    const u1 = nextUniform();
    const u2 = nextUniform();
    const mag = sigma * Math.sqrt(-2.0 * Math.log(u1));
    const z0 = mag * Math.cos(2.0 * Math.PI * u2);
    const z1 = mag * Math.sin(2.0 * Math.PI * u2);
    x[i] = waveform.x[i] ?? 0;
    y[i] = (waveform.y[i] ?? 0) + z0;
    if (i + 1 < n) {
      x[i + 1] = waveform.x[i + 1] ?? 0;
      y[i + 1] = (waveform.y[i + 1] ?? 0) + z1;
    }
  }
  return { x, y };
}
