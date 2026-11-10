// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sliding Full-Cycle Discrete Fourier Transform (DFT) Phasor Extractor.
 *
 * Computes fundamental frequency (50 Hz / 60 Hz) RMS magnitude and phase angle
 * trajectories from raw COMTRADE sampled point waveforms.
 */

import type { ComtradePhasorPoint, ComtradePhasorResult, ComtradeRecord } from "../types.js";

export interface PhasorExtractionOptions {
  nominalFreqHz?: number; // 50 or 60 Hz (defaults to config.lineFrequencyHz or 60.0)
}

function resolveChannelSignal(
  record: ComtradeRecord,
  channel: string | number,
): { name: string; signal: Float64Array | number[] } {
  const cfg = record.config ?? record.cfg;
  const analogs = cfg?.analogChannels ?? cfg?.analogs ?? [];

  let chName = "";
  if (typeof channel === "number") {
    const ch = analogs[channel];
    chName = ch?.name ?? ch?.chId ?? `A_${channel + 1}`;
  } else {
    chName = channel;
  }

  let signal: Float64Array | number[] | undefined;
  if (record.analogData instanceof Map) {
    signal = record.analogData.get(chName);
  } else if (Array.isArray(record.analogData)) {
    if (typeof channel === "number") {
      signal = record.analogData[channel];
    } else {
      const idx = analogs.findIndex((c) => (c.name ?? c.chId) === chName);
      if (idx >= 0) signal = record.analogData[idx];
    }
  }

  if (!signal) {
    // If not found yet, check if index 0 has data
    if (typeof channel === "number" && (record.analogData as any)?.[channel]) {
      signal = (record.analogData as any)[channel];
    } else {
      throw new Error(`Channel '${channel}' not found in COMTRADE record.`);
    }
  }

  return { name: chName, signal: signal! };
}

function getTimestampsArray(record: ComtradeRecord): Float64Array | number[] {
  return record.timeSec ?? record.timestamps ?? [];
}

/**
 * Extracts fundamental phasor trajectory for a specific analog channel in a ComtradeRecord.
 */
export function extractPhasor(
  record: ComtradeRecord,
  channel: string | number,
  options?: PhasorExtractionOptions,
): ComtradePhasorResult {
  const { name: channelName, signal } = resolveChannelSignal(record, channel);
  const cfg = record.config ?? record.cfg;
  const f0 = options?.nominalFreqHz ?? cfg?.lineFrequencyHz ?? cfg?.nominalFrequency ?? 60.0;
  const time = getTimestampsArray(record);
  const nSamples = signal.length;

  if (nSamples < 2) {
    return {
      channelName,
      nominalFreqHz: f0,
      phasors: [],
    };
  }

  const dt = (time[nSamples - 1]! - time[0]!) / (nSamples - 1);
  const nCycle = Math.max(4, Math.round(1.0 / (f0 * dt)));

  const phasors: ComtradePhasorPoint[] = [];
  const sqrt2_over_N = Math.SQRT2 / nCycle;

  const cosBasis = new Float64Array(nCycle);
  const sinBasis = new Float64Array(nCycle);
  for (let k = 0; k < nCycle; k++) {
    const angle = (2.0 * Math.PI * k) / nCycle;
    cosBasis[k] = Math.cos(angle);
    sinBasis[k] = Math.sin(angle);
  }

  for (let i = nCycle - 1; i < nSamples; i++) {
    let re = 0.0;
    let im = 0.0;

    for (let k = 0; k < nCycle; k++) {
      const val = signal[i - nCycle + 1 + k]!;
      re += val * cosBasis[k]!;
      im += val * sinBasis[k]!;
    }

    const reRms = re * sqrt2_over_N;
    const imRms = -im * sqrt2_over_N;
    const magRms = Math.hypot(reRms, imRms);
    let phaseRad = Math.atan2(imRms, reRms);
    let phaseDeg = (phaseRad * 180.0) / Math.PI;
    if (phaseDeg < 0) phaseDeg += 360.0;

    const t = time[i]!;
    phasors.push({
      timeSec: t,
      time: t,
      magnitudeRms: magRms,
      phaseDeg,
    });
  }

  return {
    channelName,
    nominalFreqHz: f0,
    phasors,
  };
}

/**
 * Extracts a dynamic phasor series trajectory across time for a given channel.
 */
export function extractPhasorSeries(
  record: ComtradeRecord,
  channel: string | number,
  nominalFreqHz?: number,
): ComtradePhasorPoint[] {
  const result = extractPhasor(record, channel, nominalFreqHz !== undefined ? { nominalFreqHz } : undefined);
  return result.phasors;
}

/**
 * Extracts the single phasor evaluated closest to a given timestamp.
 */
export function extractPhasorAtTimestamp(
  record: ComtradeRecord,
  channel: string | number,
  timestamp: number,
  nominalFreqHz?: number,
): ComtradePhasorPoint {
  const phasors = extractPhasorSeries(record, channel, nominalFreqHz);
  if (phasors.length === 0) {
    return { timeSec: timestamp, time: timestamp, magnitudeRms: 0, phaseDeg: 0 };
  }

  let bestPoint = phasors[0]!;
  let minDiff = Math.abs(bestPoint.timeSec - timestamp);

  for (let i = 1; i < phasors.length; i++) {
    const diff = Math.abs(phasors[i]!.timeSec - timestamp);
    if (diff < minDiff) {
      minDiff = diff;
      bestPoint = phasors[i]!;
    }
  }

  return bestPoint;
}
