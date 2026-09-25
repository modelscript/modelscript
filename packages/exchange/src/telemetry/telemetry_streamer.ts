// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Unified Cyber-Physical Telemetry Streamer.
 *
 * Ingests automotive (ASAM MDF4) and robotics (Foxglove MCAP) streams, normalizes time-series,
 * aligns asynchronous clock channels, and feeds synchronized physical observations into
 * Bayesian calibrators and digital thread hypergraph slots.
 */

import { MCAP_MAGIC, McapReader } from "./mcap_reader.js";
import { Mdf4Reader } from "./mdf4_reader.js";

export interface SynchronizedChannel {
  name: string;
  unit?: string;
  timestamps: Float64Array;
  values: Float64Array;
}

export interface TelemetryChannelStats {
  name: string;
  sampleCount: number;
  timeStart: number;
  timeEnd: number;
  duration: number;
  min: number;
  max: number;
  mean: number;
  rms: number;
  stdDev: number;
}

export interface ResampledTable {
  timeGrid: Float64Array;
  channels: Record<string, Float64Array>;
  sampleRateHz: number;
}

export class TelemetryStreamer {
  private channels = new Map<string, SynchronizedChannel>();
  public readonly format: "mdf4" | "mcap" | "unknown";

  constructor(data: Uint8Array | ArrayBuffer) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    // Format detection
    if (
      bytes.byteLength >= 8 &&
      bytes[0] === 0x23 &&
      bytes[1] === 0x23 &&
      bytes[2] === 0x4d &&
      bytes[3] === 0x44 &&
      bytes[4] === 0x46
    ) {
      this.format = "mdf4";
      this.loadMdf4(bytes);
    } else if (
      bytes.byteLength >= 8 &&
      bytes[0] === MCAP_MAGIC[0] &&
      bytes[1] === MCAP_MAGIC[1] &&
      bytes[2] === MCAP_MAGIC[2] &&
      bytes[3] === MCAP_MAGIC[3]
    ) {
      this.format = "mcap";
      this.loadMcap(bytes);
    } else {
      this.format = "unknown";
      throw new Error("Unsupported telemetry format: file header does not match ASAM MDF4 or Foxglove MCAP");
    }
  }

  private loadMdf4(bytes: Uint8Array): void {
    const reader = new Mdf4Reader(bytes);
    const series = reader.extractAllChannels();
    for (const s of series) {
      this.channels.set(s.name, {
        name: s.name,
        unit: s.unit,
        timestamps: s.timestamps,
        values: s.values,
      });
    }
  }

  private loadMcap(bytes: Uint8Array): void {
    const reader = new McapReader(bytes);
    const series = reader.extractAllSeries();
    for (const s of series) {
      this.channels.set(s.topic, {
        name: s.topic,
        timestamps: s.timestamps,
        values: s.values,
      });
    }
  }

  public getChannelNames(): string[] {
    return Array.from(this.channels.keys());
  }

  public getChannel(name: string): SynchronizedChannel | undefined {
    return this.channels.get(name);
  }

  /**
   * Computes descriptive statistics for a signal channel.
   */
  public computeStats(channelName: string): TelemetryChannelStats {
    const ch = this.channels.get(channelName);
    if (!ch || ch.values.length === 0) {
      throw new Error(`Channel '${channelName}' not found or empty`);
    }

    const n = ch.values.length;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0.0;
    let sumSq = 0.0;

    for (let i = 0; i < n; i++) {
      const v = ch.values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      sumSq += v * v;
    }

    const mean = sum / n;
    const rms = Math.sqrt(sumSq / n);
    const variance = Math.max(0, sumSq / n - mean * mean);
    const stdDev = Math.sqrt(variance);

    const tStart = ch.timestamps[0] ?? 0.0;
    const tEnd = ch.timestamps[n - 1] ?? 0.0;

    return {
      name: channelName,
      sampleCount: n,
      timeStart: tStart,
      timeEnd: tEnd,
      duration: tEnd - tStart,
      min,
      max,
      mean,
      rms,
      stdDev,
    };
  }

  /**
   * Resamples requested channels onto a strictly uniform common time grid using linear interpolation.
   */
  public resample(channelNames: string[], sampleRateHz = 100): ResampledTable {
    if (channelNames.length === 0) {
      throw new Error("Must specify at least one channel to resample");
    }

    // Determine overlapping time window
    let globalStart = -Infinity;
    let globalEnd = Infinity;

    for (const name of channelNames) {
      const ch = this.channels.get(name);
      if (!ch || ch.timestamps.length < 2) {
        throw new Error(`Channel '${name}' not found or has insufficient samples`);
      }
      const t0 = ch.timestamps[0]!;
      const t1 = ch.timestamps[ch.timestamps.length - 1]!;
      if (t0 > globalStart) globalStart = t0;
      if (t1 < globalEnd) globalEnd = t1;
    }

    if (globalEnd <= globalStart) {
      throw new Error("Selected channels do not have an overlapping temporal span");
    }

    const dt = 1.0 / sampleRateHz;
    const numPoints = Math.max(2, Math.floor((globalEnd - globalStart) / dt) + 1);
    const timeGrid = new Float64Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      timeGrid[i] = globalStart + i * dt;
    }

    const resampledChannels: Record<string, Float64Array> = {};

    for (const name of channelNames) {
      const ch = this.channels.get(name)!;
      const resVals = new Float64Array(numPoints);
      const rawTimes = ch.timestamps;
      const rawVals = ch.values;
      const rawLen = rawTimes.length;

      let idx = 0;
      for (let i = 0; i < numPoints; i++) {
        const t = timeGrid[i]!;

        // Advance idx to bracket t
        while (idx < rawLen - 2 && rawTimes[idx + 1]! < t) {
          idx++;
        }

        const tA = rawTimes[idx]!;
        const tB = rawTimes[idx + 1]!;
        const vA = rawVals[idx]!;
        const vB = rawVals[idx + 1]!;

        if (t <= tA) {
          resVals[i] = vA;
        } else if (t >= tB) {
          resVals[i] = vB;
        } else {
          const alpha = (t - tA) / (tB - tA || 1e-12);
          resVals[i] = vA + alpha * (vB - vA);
        }
      }

      resampledChannels[name] = resVals;
    }

    return {
      timeGrid,
      channels: resampledChannels,
      sampleRateHz,
    };
  }
}
