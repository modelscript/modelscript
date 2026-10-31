// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IbisDeck, IbisModel } from "../types.js";
import { calculateOutputResistance } from "./buffer-solver.js";

export interface IbisChannelSimulationOptions {
  /** Target model name if passing an IbisDeck */
  modelName?: string | undefined;
  /** Data rate in Gbps (default: 10 Gbps -> UI = 100 ps) */
  dataRateGbps?: number | undefined;
  /** Unit interval in picoseconds (overrides dataRateGbps if provided) */
  uiPs?: number | undefined;
  /** Channel insertion loss at Nyquist frequency in dB (default: 10 dB) */
  channelLossDb?: number | undefined;
  /** Characteristic impedance Z0 in Ohms (default: 50 Ohms) */
  z0Ohms?: number | undefined;
  /** TX FFE tap weights, e.g. [-0.1, 0.8, -0.1] */
  txTapWeights?: number[] | undefined;
  /** RX CTLE peaking gain in dB (default: 0 dB, or from [Algorithmic Model]) */
  ctleGainDb?: number | undefined;
  /** RX DFE feedback tap weights in Volts or normalized cursor fraction */
  dfeTaps?: number[] | undefined;
  /** Random jitter RMS in picoseconds for BER 1e-12 contour (default: 1.5 ps) */
  randomJitterRmsPs?: number | undefined;
  /** Random voltage noise RMS in Volts for BER 1e-12 contour (default: 0.002 V) */
  randomNoiseRmsV?: number | undefined;
  /** Oversampling factor per UI (default: 32) */
  samplesPerUi?: number | undefined;
}

export interface IbisChannelSimulationResult {
  modelName: string;
  uiPs: number;
  timePs: number[];
  pulseResponseV: number[];
  cursorAmplitudeV: number;
  worstCaseIsiV: number;
  /** Peak Distortion Analysis (PDA) deterministic eye height (V) */
  eyeHeightV: number;
  /** Deterministic horizontal eye opening width (ps) */
  eyeWidthPs: number;
  /** Statistical eye height at BER = 10^-12 (V) */
  eyeHeightBer1e12V: number;
  /** Statistical eye width at BER = 10^-12 (ps) */
  eyeWidthBer1e12Ps: number;
  /** Sampled cursor and ISI taps at UI intervals [-2, -1, 0, +1, +2, ...] */
  sampledCursorsV: { uiOffset: number; valueV: number }[];
}

// Q-factor for BER = 10^-12 under dual-Dirac / Gaussian tail model (2 * Q(7.0345) ~ 1e-12)
const Q_BER_1E12 = 7.0345;

/**
 * Simulates an IBIS / IBIS-AMI high-speed serial channel using Single-Bit Pulse Response
 * convolution with TX FFE pre-emphasis, RX CTLE high-frequency peaking, RX DFE post-cursor
 * ISI cancellation, and Peak Distortion Analysis (PDA) / Statistical Eye BER = 10^-12 extraction.
 */
export function simulateIbisChannel(
  deckOrModel: IbisDeck | IbisModel,
  options: IbisChannelSimulationOptions = {},
): IbisChannelSimulationResult {
  const model: IbisModel | undefined =
    "models" in deckOrModel
      ? options.modelName
        ? deckOrModel.models.get(options.modelName)
        : deckOrModel.models.values().next().value
      : deckOrModel;

  const modelName = model?.name ?? options.modelName ?? "DEFAULT_SERDES";
  const ami = model?.algorithmicModel;

  const uiPs =
    options.uiPs ?? (options.dataRateGbps && options.dataRateGbps > 0 ? 1000.0 / options.dataRateGbps : 100.0);
  const samplesPerUi = Math.max(8, options.samplesPerUi ?? 32);
  const dtPs = uiPs / samplesPerUi;
  const numUi = 14;
  const totalSamples = numUi * samplesPerUi;

  // Driver voltage swing into terminated Z0 channel
  const z0 = options.z0Ohms ?? 50.0;
  let driverSwingV = 1.0;
  if (model) {
    const vcc = model.voltageRange.typ > 0 ? model.voltageRange.typ : 1.0;
    const { rOnLow, rOnHigh } = calculateOutputResistance(model);
    const rDrv = 0.5 * (rOnLow + rOnHigh);
    driverSwingV = vcc * (z0 / (rDrv + z0));
  }

  // Channel dispersion time constant from insertion loss at Nyquist (f_N = 1 / (2 * UI))
  const channelLossDb = Math.max(0.5, options.channelLossDb ?? 10.0);
  // Two-pole + dielectric tail dispersive channel model calibrated to channelLossDb
  const lossRatio = Math.pow(10, channelLossDb / 20.0);
  const tauMainPs = 0.32 * uiPs * Math.sqrt(Math.max(0.1, lossRatio - 1.0));
  const tauTailPs = 1.35 * uiPs * Math.log10(1.0 + lossRatio);

  // Synthesize unequalized continuous-time single-bit response p_raw(t) for a pulse in [tStart, tStart + UI]
  const pulseStartPs = 2.0 * uiPs;
  const pulseEndPs = pulseStartPs + uiPs;

  const stepResponse = (tPs: number): number => {
    if (tPs <= 0) return 0.0;
    // Two-time-constant dispersive step response (skin effect + dielectric relaxation)
    const fast = 1.0 - (1.0 + tPs / tauMainPs) * Math.exp(-tPs / tauMainPs);
    const slow = 1.0 - Math.exp(-tPs / tauTailPs);
    return driverSwingV * (0.68 * fast + 0.32 * slow);
  };

  const timePs: number[] = new Array(totalSamples);
  let pulse: number[] = new Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const t = i * dtPs;
    timePs[i] = t;
    pulse[i] = stepResponse(t - pulseStartPs) - stepResponse(t - pulseEndPs);
  }

  // 1. Apply TX FFE (Feed-Forward Equalizer) UI-spaced FIR filter
  const txTaps = options.txTapWeights ?? ami?.txTapWeights;
  if (txTaps && txTaps.length > 0) {
    // Identify main tap index (largest magnitude tap) so cursor alignment stays centered
    let mainTapIdx = 0;
    let maxAbs = -1;
    for (let k = 0; k < txTaps.length; k++) {
      const a = Math.abs(txTaps[k]!);
      if (a > maxAbs) {
        maxAbs = a;
        mainTapIdx = k;
      }
    }

    const ffeOut = new Array<number>(totalSamples).fill(0.0);
    for (let tapIdx = 0; tapIdx < txTaps.length; tapIdx++) {
      const weight = txTaps[tapIdx]!;
      const shiftSamples = (tapIdx - mainTapIdx) * samplesPerUi;
      for (let i = 0; i < totalSamples; i++) {
        const srcIdx = i - shiftSamples;
        if (srcIdx >= 0 && srcIdx < totalSamples) {
          ffeOut[i]! += weight * pulse[srcIdx]!;
        }
      }
    }
    pulse = ffeOut;
  }

  // 2. Apply RX CTLE (Continuous-Time Linear Equalizer) high-frequency peaking boost
  const ctleGainDb = options.ctleGainDb ?? ami?.ctleGainDb ?? 0.0;
  if (ctleGainDb > 0) {
    // High-pass derivative peaking + midband restoration filter:
    // y(t) = pulse(t) + alpha * tau_z * d(pulse)/dt smoothed by pole tau_p
    const boostLinear = Math.pow(10, ctleGainDb / 20.0) - 1.0;
    const tauZeroPs = 0.45 * uiPs;
    const tauPolePs = 0.18 * uiPs;
    const alpha = Math.min(2.5, 0.55 * boostLinear);
    const ctleOut = new Array<number>(totalSamples).fill(0.0);
    let hpState = 0.0;
    const poleDecay = Math.exp(-dtPs / tauPolePs);
    for (let i = 0; i < totalSamples; i++) {
      const dv = i > 0 ? (pulse[i]! - pulse[i - 1]!) / dtPs : 0.0;
      const derivTerm = tauZeroPs * dv;
      hpState = poleDecay * hpState + (1.0 - poleDecay) * derivTerm;
      ctleOut[i] = pulse[i]! + alpha * hpState;
    }
    pulse = ctleOut;
  }

  // Locate main cursor peak index (t_0)
  let peakIdx = 0;
  let cursorAmplitudeV = -Infinity;
  for (let i = 0; i < totalSamples; i++) {
    if (pulse[i]! > cursorAmplitudeV) {
      cursorAmplitudeV = pulse[i]!;
      peakIdx = i;
    }
  }
  if (!Number.isFinite(cursorAmplitudeV) || cursorAmplitudeV < 0) {
    cursorAmplitudeV = 0;
  }

  // 3. Extract UI-spaced pre-cursor and post-cursor ISI samples around peakIdx
  const dfeTaps = options.dfeTaps ?? ami?.dfeTaps ?? [];
  const sampledCursorsV: { uiOffset: number; valueV: number }[] = [];
  let worstCaseIsiV = 0.0;

  // Apply DFE cancellation on post-cursors both at the sampling instants and on the continuous waveform
  const pulseWithDfe = pulse.slice();
  for (let dfeIdx = 0; dfeIdx < dfeTaps.length; dfeIdx++) {
    const tapMag = dfeTaps[dfeIdx]!;
    const postCursorCenter = peakIdx + (dfeIdx + 1) * samplesPerUi;
    const halfUi = samplesPerUi >> 1;
    for (let s = Math.max(0, postCursorCenter - halfUi); s < Math.min(totalSamples, postCursorCenter + halfUi); s++) {
      // Slicer feedback subtracts tap weight across the post-cursor UI window
      const sign = pulseWithDfe[s]! >= 0 ? 1 : -1;
      const reduced = Math.max(0, Math.abs(pulseWithDfe[s]!) - Math.abs(tapMag));
      pulseWithDfe[s] = sign * reduced;
    }
  }

  for (let k = -3; k <= 8; k++) {
    const idx = peakIdx + k * samplesPerUi;
    if (idx < 0 || idx >= totalSamples) continue;
    let val = pulseWithDfe[idx]!;
    if (k >= 1 && k - 1 < dfeTaps.length) {
      const dfeVal = Math.abs(dfeTaps[k - 1]!);
      // If DFE tap is specified as a normalized fraction of cursor (<= 0.5) or absolute voltage,
      // subtract up to the post-cursor ISI magnitude without over-driving
      const cancelV = Math.max(dfeVal, dfeVal * cursorAmplitudeV);
      const sign = val >= 0 ? 1 : -1;
      val = sign * Math.max(0, Math.abs(val) - cancelV);
      pulseWithDfe[idx] = val;
    }
    sampledCursorsV.push({ uiOffset: k, valueV: val });
    if (k !== 0) {
      worstCaseIsiV += Math.abs(val);
    }
  }

  // Deterministic Peak Distortion Analysis (PDA) vertical eye opening:
  // Eye height = h(0) - sum_{k != 0} |h(k)|
  const eyeHeightV = Math.max(0.0, cursorAmplitudeV - worstCaseIsiV);

  // Compute horizontal eye opening width around peakIdx where vertical eye opening > 0
  let openSamples = 0;
  const halfUi = samplesPerUi >> 1;
  for (let offset = -halfUi; offset <= halfUi; offset++) {
    const center = peakIdx + offset;
    if (center < 0 || center >= totalSamples) continue;
    const mainVal = pulseWithDfe[center]!;
    let isiAtPhase = 0.0;
    for (let k = -3; k <= 8; k++) {
      if (k === 0) continue;
      const sampleIdx = center + k * samplesPerUi;
      if (sampleIdx >= 0 && sampleIdx < totalSamples) {
        let v = Math.abs(pulseWithDfe[sampleIdx]!);
        if (k >= 1 && k - 1 < dfeTaps.length) {
          const dfeVal = Math.abs(dfeTaps[k - 1]!);
          const cancelV = Math.max(dfeVal, dfeVal * cursorAmplitudeV);
          v = Math.max(0, v - cancelV);
        }
        isiAtPhase += v;
      }
    }
    if (mainVal - isiAtPhase > 0) {
      openSamples++;
    }
  }
  const eyeWidthPs = (openSamples / samplesPerUi) * uiPs;

  // Statistical Eye at BER = 10^-12 (subtracting Q_BER_1E12 * sigma_noise and 2 * Q_BER_1E12 * sigma_jitter)
  const rjRmsPs = options.randomJitterRmsPs ?? 1.5;
  const rnRmsV = options.randomNoiseRmsV ?? 0.002;
  // Estimate residual ISI variance (sigma_isi) from non-zero cursors
  let isiVarianceV2 = 0.0;
  for (const c of sampledCursorsV) {
    if (c.uiOffset !== 0) {
      isiVarianceV2 += c.valueV * c.valueV;
    }
  }
  const sigmaVerticalV = Math.sqrt(rnRmsV * rnRmsV + 0.15 * isiVarianceV2);
  const eyeHeightBer1e12V = Math.max(0.0, eyeHeightV - 2.0 * Q_BER_1E12 * rnRmsV - 0.5 * sigmaVerticalV);
  const eyeWidthBer1e12Ps = Math.max(0.0, eyeWidthPs - 2.0 * Q_BER_1E12 * rjRmsPs);

  return {
    modelName,
    uiPs,
    timePs,
    pulseResponseV: pulseWithDfe,
    cursorAmplitudeV,
    worstCaseIsiV,
    eyeHeightV,
    eyeWidthPs,
    eyeHeightBer1e12V,
    eyeWidthBer1e12Ps,
    sampledCursorsV,
  };
}
