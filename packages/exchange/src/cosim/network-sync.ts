// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Distributed Clock Synchronization & Dead-Reckoning for Co-Simulation.
 *
 * Implements PTP/NTP-style clock offset and round-trip latency estimation, alongside
 * dead-reckoning extrapolation for distributed and edge MQTT/WebSocket co-simulation.
 *
 * Prevents orchestrator starvation when network packets experience jitter or burst drops.
 */

import { HermiteInterpolator } from "./coupling.js";

/** Time synchronization sample from a ping/pong exchange. */
export interface TimeSyncSample {
  /** Master transmission timestamp [ms]. */
  t1: number;
  /** Participant receive timestamp [ms]. */
  t2: number;
  /** Participant response timestamp [ms]. */
  t3: number;
  /** Master arrival timestamp [ms]. */
  t4: number;
}

/** Computed clock synchronization metrics. */
export interface ClockSyncMetrics {
  roundTripTimeMs: number;
  clockOffsetMs: number;
  filteredRttMs: number;
  filteredOffsetMs: number;
  sampleCount: number;
}

/** Notification when dead-reckoning extrapolation is used. */
export interface DeadReckoningEvent {
  participantId: string;
  variableName: string;
  time: number;
  extrapolatedValue: number;
  consecutiveSteps: number;
}

export interface NetworkSyncOptions {
  /** Maximum allowable consecutive dead-reckoning extrapolations before stalling (default: 3). */
  maxConsecutiveExtrapolations?: number | undefined;
  /** Timeout in ms to wait for a remote participant before dead-reckoning (default: 50 ms). */
  responseTimeoutMs?: number | undefined;
  /** Smoothing factor alpha for RTT and offset EMA filter in (0, 1] (default: 0.2). */
  emaAlpha?: number | undefined;
}

/**
 * Manages distributed time synchronization and clock skew tracking for remote participants.
 */
export class NetworkTimeSynchronizer {
  private readonly syncMetrics = new Map<string, ClockSyncMetrics>();
  private readonly emaAlpha: number;

  constructor(options: NetworkSyncOptions = {}) {
    this.emaAlpha = options.emaAlpha ?? 0.2;
  }

  /**
   * Records a 4-timestamp exchange and updates the filtered RTT and clock offset.
   */
  recordSample(participantId: string, sample: TimeSyncSample): ClockSyncMetrics {
    const { t1, t2, t3, t4 } = sample;
    // RTT = (t4 - t1) - (t3 - t2)
    const rtt = Math.max(0, t4 - t1 - (t3 - t2));
    // Offset = ((t2 - t1) + (t3 - t4)) / 2
    const offset = (t2 - t1 + (t3 - t4)) * 0.5;

    let current = this.syncMetrics.get(participantId);
    if (!current) {
      current = {
        roundTripTimeMs: rtt,
        clockOffsetMs: offset,
        filteredRttMs: rtt,
        filteredOffsetMs: offset,
        sampleCount: 1,
      };
      this.syncMetrics.set(participantId, current);
    } else {
      current.roundTripTimeMs = rtt;
      current.clockOffsetMs = offset;
      current.filteredRttMs = (1.0 - this.emaAlpha) * current.filteredRttMs + this.emaAlpha * rtt;
      current.filteredOffsetMs = (1.0 - this.emaAlpha) * current.filteredOffsetMs + this.emaAlpha * offset;
      current.sampleCount++;
    }

    return current;
  }

  /** Gets the latest clock sync metrics for a participant. */
  getMetrics(participantId: string): ClockSyncMetrics | undefined {
    return this.syncMetrics.get(participantId);
  }

  /** Converts a remote participant timestamp to local master time. */
  remoteToLocalTimeMs(participantId: string, remoteTimeMs: number): number {
    const m = this.syncMetrics.get(participantId);
    return m ? remoteTimeMs - m.filteredOffsetMs : remoteTimeMs;
  }
}

/**
 * Dead-reckoning extrapolation buffer for resilient distributed co-simulation.
 */
export class DeadReckoningBuffer {
  private readonly interpolators = new Map<string, HermiteInterpolator>();
  private readonly consecutiveCount = new Map<string, number>();
  private readonly maxConsecutive: number;
  private readonly timeoutMs: number;

  constructor(options: NetworkSyncOptions = {}) {
    this.maxConsecutive = options.maxConsecutiveExtrapolations ?? 3;
    this.timeoutMs = options.responseTimeoutMs ?? 50;
  }

  get responseTimeout(): number {
    return this.timeoutMs;
  }

  /**
   * Registers a received actual output value from a remote participant,
   * resetting the consecutive dead-reckoning counter.
   */
  recordValue(participantId: string, variableName: string, time: number, value: number): void {
    const key = `${participantId}.${variableName}`;
    let interp = this.interpolators.get(key);
    if (!interp) {
      interp = new HermiteInterpolator();
      this.interpolators.set(key, interp);
    }
    interp.addPoint(time, value);
    this.consecutiveCount.set(key, 0);
  }

  /**
   * Attempts to retrieve or extrapolate a variable value when a packet has been delayed.
   */
  getOrExtrapolate(
    participantId: string,
    variableName: string,
    currentTime: number,
  ): { value: number; wasExtrapolated: boolean; consecutiveSteps: number; canContinue: boolean } {
    const key = `${participantId}.${variableName}`;
    const interp = this.interpolators.get(key);

    if (!interp) {
      return { value: 0.0, wasExtrapolated: true, consecutiveSteps: 1, canContinue: true };
    }

    // Check if we have exact data at currentTime
    if (interp.lastTime !== undefined && Math.abs(interp.lastTime - currentTime) < 1e-12) {
      return {
        value: interp.evaluate(currentTime),
        wasExtrapolated: false,
        consecutiveSteps: 0,
        canContinue: true,
      };
    }

    // Missing packet -> extrapolate
    const prevCount = this.consecutiveCount.get(key) ?? 0;
    const nextCount = prevCount + 1;
    this.consecutiveCount.set(key, nextCount);

    const extrapolatedVal = interp.evaluate(currentTime);
    const canContinue = nextCount <= this.maxConsecutive;

    return {
      value: extrapolatedVal,
      wasExtrapolated: true,
      consecutiveSteps: nextCount,
      canContinue,
    };
  }

  /**
   * Calculates drift error between the extrapolated guess and the late arriving actual value.
   */
  computeDrift(participantId: string, variableName: string, time: number, actualValue: number): number {
    const key = `${participantId}.${variableName}`;
    const interp = this.interpolators.get(key);
    if (!interp) return 0.0;
    const guess = interp.evaluate(time);
    return Math.abs(actualValue - guess);
  }

  /** Clear all buffer histories. */
  clear(): void {
    this.interpolators.clear();
    this.consecutiveCount.clear();
  }
}
