// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance, lock-free contiguous circular telemetry buffer.
 *
 * Stores multi-channel sensor time-series in a contiguous Float64Array typed array.
 * Provides continuous cubic Hermite spline interpolation to align asynchronous,
 * non-uniform field telemetry packets with DAE solver time grids.
 */

export interface TelemetryBufferOptions {
  /** Number of sensor channels (excluding timestamp). */
  numChannels: number;
  /** Maximum number of samples to hold in the circular buffer. Default: 10,000. */
  capacity?: number;
  /** Optional channel names for debugging and telemetry mapping. */
  channelNames?: string[];
}

export interface TelemetryWindow {
  times: Float64Array;
  /** Array of length `numChannels`, each containing samples for that channel. */
  channels: Float64Array[];
}

export class CircularTelemetryBuffer {
  readonly numChannels: number;
  readonly capacity: number;
  readonly channelNames: string[];

  // Contiguous layout: stride = 1 + numChannels
  // [t, y_0, y_1, ..., y_{C-1}]
  private readonly stride: number;
  private readonly buffer: Float64Array;

  private count = 0;
  private head = 0; // Index of the next write slot (in samples)

  constructor(options: TelemetryBufferOptions) {
    if (options.numChannels <= 0) {
      throw new Error(`CircularTelemetryBuffer: numChannels must be > 0, got ${options.numChannels}`);
    }
    this.numChannels = options.numChannels;
    this.capacity = options.capacity ?? 10_000;
    this.stride = 1 + this.numChannels;
    this.buffer = new Float64Array(this.capacity * this.stride);
    this.channelNames = options.channelNames ?? Array.from({ length: this.numChannels }, (_, i) => `ch_${i}`);
  }

  /**
   * Push a new sensor reading into the buffer.
   * @param time Sample timestamp (seconds).
   * @param values Channel values (length must be >= numChannels).
   */
  push(time: number, values: ArrayLike<number>): void {
    if (values.length < this.numChannels) {
      throw new Error(`CircularTelemetryBuffer: expected at least ${this.numChannels} values, got ${values.length}`);
    }

    const offset = this.head * this.stride;
    this.buffer[offset] = time;
    for (let c = 0; c < this.numChannels; c++) {
      this.buffer[offset + 1 + c] = values[c]!;
    }

    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Batch push multiple samples.
   */
  pushBatch(times: ArrayLike<number>, channelData: ArrayLike<number>[]): void {
    const n = times.length;
    for (let i = 0; i < n; i++) {
      const sample = new Float64Array(this.numChannels);
      for (let c = 0; c < this.numChannels; c++) {
        sample[c] = channelData[c]![i]!;
      }
      this.push(times[i]!, sample);
    }
  }

  /**
   * Total number of valid samples currently buffered.
   */
  getSampleCount(): number {
    return this.count;
  }

  /**
   * Returns the time range spanned by the current buffer, or null if empty.
   */
  getTimeRange(): { startTime: number; endTime: number } | null {
    if (this.count === 0) return null;

    const oldestIdx = this.count < this.capacity ? 0 : this.head;
    const newestIdx = (this.head - 1 + this.capacity) % this.capacity;

    const startTime = this.buffer[oldestIdx * this.stride]!;
    const endTime = this.buffer[newestIdx * this.stride]!;
    return { startTime, endTime };
  }

  /**
   * Retrieve sample at logical index `k` in chronological order (0 = oldest, count-1 = newest).
   */
  getSample(logicalIndex: number): { time: number; values: Float64Array } {
    if (logicalIndex < 0 || logicalIndex >= this.count) {
      throw new RangeError(`CircularTelemetryBuffer: index ${logicalIndex} out of bounds (count=${this.count})`);
    }

    const startSlot = this.count < this.capacity ? 0 : this.head;
    const actualSlot = (startSlot + logicalIndex) % this.capacity;
    const offset = actualSlot * this.stride;

    const time = this.buffer[offset]!;
    const values = new Float64Array(this.numChannels);
    for (let c = 0; c < this.numChannels; c++) {
      values[c] = this.buffer[offset + 1 + c]!;
    }
    return { time, values };
  }

  /**
   * Continuous cubic Hermite spline interpolation at arbitrary query time `t`.
   * Returns null if buffer has fewer than 2 samples or if `t` is outside [startTime, endTime].
   */
  interpolate(t: number): Float64Array | null {
    if (this.count < 2) return null;

    const range = this.getTimeRange();
    if (!range) return null;

    // Tolerance epsilon for floating point timestamp comparison
    const eps = 1e-9;
    if (t < range.startTime - eps || t > range.endTime + eps) {
      return null;
    }

    // Clamp boundary
    if (t <= range.startTime) {
      return this.getSample(0).values;
    }
    if (t >= range.endTime) {
      return this.getSample(this.count - 1).values;
    }

    // Binary search for interval [k, k + 1] such that time(k) <= t <= time(k + 1)
    let low = 0;
    let high = this.count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const sMid = this.getSample(mid);
      if (sMid.time <= t) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const k0 = Math.max(0, high);
    const k1 = Math.min(this.count - 1, k0 + 1);

    const s0 = this.getSample(k0);
    const s1 = this.getSample(k1);
    const dt = s1.time - s0.time;

    if (dt <= 1e-12) {
      return s0.values;
    }

    const tau = (t - s0.time) / dt;
    const tau2 = tau * tau;
    const tau3 = tau2 * tau;

    // Hermite basis functions
    const h00 = 2 * tau3 - 3 * tau2 + 1;
    const h10 = tau3 - 2 * tau2 + tau;
    const h01 = -2 * tau3 + 3 * tau2;
    const h11 = tau3 - tau2;

    const result = new Float64Array(this.numChannels);

    for (let c = 0; c < this.numChannels; c++) {
      const y0 = s0.values[c]!;
      const y1 = s1.values[c]!;

      // Estimate tangents using centered differences (Catmull-Rom) with boundary fallback
      let d0: number;
      if (k0 > 0) {
        const sPrev = this.getSample(k0 - 1);
        d0 = (y1 - sPrev.values[c]!) / (s1.time - sPrev.time);
      } else {
        d0 = (y1 - y0) / dt;
      }

      let d1: number;
      if (k1 < this.count - 1) {
        const sNext = this.getSample(k1 + 1);
        d1 = (sNext.values[c]! - y0) / (sNext.time - s0.time);
      } else {
        d1 = (y1 - y0) / dt;
      }

      result[c] = h00 * y0 + h10 * dt * d0 + h01 * y1 + h11 * dt * d1;
    }

    return result;
  }

  /**
   * Resamples data uniformly within [startTime, endTime] at `numPoints` intervals.
   * Designed for direct ingestion into `solveDaeAdjoint` target trajectories.
   */
  resampleUniform(startTime: number, endTime: number, numPoints: number): TelemetryWindow {
    if (numPoints < 2) {
      throw new Error(`CircularTelemetryBuffer.resampleUniform: numPoints must be >= 2, got ${numPoints}`);
    }

    const times = new Float64Array(numPoints);
    const channels: Float64Array[] = Array.from({ length: this.numChannels }, () => new Float64Array(numPoints));

    const dt = (endTime - startTime) / (numPoints - 1);
    for (let i = 0; i < numPoints; i++) {
      const t = startTime + i * dt;
      times[i] = t;
      const interp = this.interpolate(t);
      for (let c = 0; c < this.numChannels; c++) {
        channels[c]![i] = interp ? interp[c]! : 0.0;
      }
    }

    return { times, channels };
  }

  /**
   * Extract all actual recorded samples within [startTime, endTime].
   */
  extractWindow(startTime: number, endTime: number): TelemetryWindow {
    const indices: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const s = this.getSample(i);
      if (s.time >= startTime && s.time <= endTime) {
        indices.push(i);
      }
    }

    const n = indices.length;
    const times = new Float64Array(n);
    const channels: Float64Array[] = Array.from({ length: this.numChannels }, () => new Float64Array(n));

    for (let j = 0; j < n; j++) {
      const s = this.getSample(indices[j]!);
      times[j] = s.time;
      for (let c = 0; c < this.numChannels; c++) {
        channels[c]![j] = s.values[c]!;
      }
    }

    return { times, channels };
  }

  /**
   * Reset buffer contents.
   */
  clear(): void {
    this.count = 0;
    this.head = 0;
    this.buffer.fill(0);
  }
}
