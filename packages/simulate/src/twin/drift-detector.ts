// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multi-channel CUSUM & Page-Hinkley sequential hypothesis testing engine.
 *
 * Continuously evaluates innovation residuals: r(t) = y_meas(t) - y_twin(t)
 * to detect structural physical degradation, sensor bias, or model drift,
 * while rejecting random Gaussian measurement noise.
 */

export interface DriftChannelConfig {
  /** Channel name or sensor identifier. */
  name: string;
  /** Expected residual mean under normal operating conditions. Default: 0. */
  expectedMean?: number;
  /** Expected standard deviation of sensor noise (σ). Default: 1.0. */
  expectedStd?: number;
  /** Minimal detectable shift δ (in units of measurement, or defaults to 1.5 * σ). */
  minShift?: number;
  /** Decision threshold h (in standard units, e.g. 5.0). */
  threshold?: number;
}

export type DriftSeverity = "low" | "medium" | "high" | "critical";

export interface DriftEvent {
  /** Timestamp when drift threshold was crossed. */
  time: number;
  /** Channel index that triggered the drift. */
  channelIndex: number;
  /** Name of the affected sensor / variable. */
  channelName: string;
  /** Direction of the drift. */
  direction: "positive" | "negative";
  /** Current CUSUM decision statistic value. */
  score: number;
  /** Threshold that was exceeded. */
  threshold: number;
  /** Severity calculated based on threshold ratio. */
  severity: DriftSeverity;
  /** Estimated shift magnitude (raw measurement units). */
  estimatedShift: number;
}

export class CusumDriftDetector {
  readonly numChannels: number;
  private readonly configs: Required<DriftChannelConfig>[];

  // Cumulative decision statistics
  private readonly sPos: Float64Array;
  private readonly sNeg: Float64Array;

  // Running statistics for online adaptive shift estimation
  private readonly count: Int32Array;
  private readonly sumRes: Float64Array;

  constructor(channelConfigs: DriftChannelConfig[]) {
    if (channelConfigs.length === 0) {
      throw new Error("CusumDriftDetector: requires at least one channel config");
    }
    this.numChannels = channelConfigs.length;

    this.configs = channelConfigs.map((cfg, idx) => {
      const expectedMean = cfg.expectedMean ?? 0.0;
      const expectedStd = cfg.expectedStd !== undefined && cfg.expectedStd > 0 ? cfg.expectedStd : 1.0;
      const minShift = cfg.minShift !== undefined && cfg.minShift > 0 ? cfg.minShift : 1.5 * expectedStd;
      const threshold = cfg.threshold !== undefined && cfg.threshold > 0 ? cfg.threshold : 5.0;

      return {
        name: cfg.name ?? `sensor_${idx}`,
        expectedMean,
        expectedStd,
        minShift,
        threshold,
      };
    });

    this.sPos = new Float64Array(this.numChannels);
    this.sNeg = new Float64Array(this.numChannels);
    this.count = new Int32Array(this.numChannels);
    this.sumRes = new Float64Array(this.numChannels);
  }

  /**
   * Update the detector with new innovation residuals r_i(t) = y_meas,i(t) - y_twin,i(t).
   * Returns a DriftEvent if any channel crosses its decision threshold.
   */
  update(time: number, residuals: ArrayLike<number>): DriftEvent | null {
    if (residuals.length < this.numChannels) {
      throw new Error(`CusumDriftDetector.update: expected ${this.numChannels} residuals, got ${residuals.length}`);
    }

    let primaryEvent: DriftEvent | null = null;
    let highestSeverityRatio = 0.0;

    for (let c = 0; c < this.numChannels; c++) {
      const cfg = this.configs[c]!;
      const r = residuals[c]!;

      // Normalize residual
      const std = cfg.expectedStd;
      const mean = cfg.expectedMean;
      const delta = cfg.minShift;
      const slack = delta / (2.0 * std); // k = δ / (2σ)

      const normalizedDeviation = (r - mean) / std;

      // Update two-sided CUSUM: S+ and S-
      const newSPos = Math.max(0, this.sPos[c]! + normalizedDeviation - slack);
      const newSNeg = Math.max(0, this.sNeg[c]! - normalizedDeviation - slack);

      this.sPos[c] = newSPos;
      this.sNeg[c] = newSNeg;
      this.count[c]!++;
      this.sumRes[c]! += r;

      const threshold = cfg.threshold;
      let triggered = false;
      let direction: "positive" | "negative" = "positive";
      let score = 0;

      if (newSPos >= threshold) {
        triggered = true;
        direction = "positive";
        score = newSPos;
      } else if (newSNeg >= threshold) {
        triggered = true;
        direction = "negative";
        score = newSNeg;
      }

      if (triggered) {
        const ratio = score / threshold;
        let severity: DriftSeverity = "low";
        if (ratio >= 3.0) severity = "critical";
        else if (ratio >= 2.0) severity = "high";
        else if (ratio >= 1.3) severity = "medium";

        const avgShift = this.sumRes[c]! / Math.max(1, this.count[c]!) - mean;

        const event: DriftEvent = {
          time,
          channelIndex: c,
          channelName: cfg.name,
          direction,
          score,
          threshold,
          severity,
          estimatedShift: avgShift,
        };

        if (ratio > highestSeverityRatio) {
          highestSeverityRatio = ratio;
          primaryEvent = event;
        }
      }
    }

    return primaryEvent;
  }

  /**
   * Get current scores across all channels.
   */
  getScores(): {
    channelIndex: number;
    name: string;
    scorePos: number;
    scoreNeg: number;
    threshold: number;
    isDrifting: boolean;
  }[] {
    return this.configs.map((cfg, c) => ({
      channelIndex: c,
      name: cfg.name,
      scorePos: this.sPos[c]!,
      scoreNeg: this.sNeg[c]!,
      threshold: cfg.threshold,
      isDrifting: this.sPos[c]! >= cfg.threshold || this.sNeg[c]! >= cfg.threshold,
    }));
  }

  /**
   * Calibrate expected baseline noise and shift parameter from an empirical burn-in sample window.
   */
  calibrateFromData(residualsWindow: ArrayLike<number>[]): void {
    const N = residualsWindow.length;
    if (N < 10) return;

    for (let c = 0; c < this.numChannels; c++) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += residualsWindow[i]![c]!;
      }
      const mean = sum / N;

      let varSum = 0;
      for (let i = 0; i < N; i++) {
        const diff = residualsWindow[i]![c]! - mean;
        varSum += diff * diff;
      }
      const std = Math.max(1e-6, Math.sqrt(varSum / (N - 1)));

      this.configs[c]!.expectedMean = mean;
      this.configs[c]!.expectedStd = std;
      this.configs[c]!.minShift = 1.5 * std;
    }

    this.reset();
  }

  /**
   * Reset decision statistics for all channels or a specific channel.
   */
  reset(channelIndex?: number): void {
    if (channelIndex !== undefined) {
      if (channelIndex >= 0 && channelIndex < this.numChannels) {
        this.sPos[channelIndex] = 0;
        this.sNeg[channelIndex] = 0;
        this.count[channelIndex] = 0;
        this.sumRes[channelIndex] = 0;
      }
    } else {
      this.sPos.fill(0);
      this.sNeg.fill(0);
      this.count.fill(0);
      this.sumRes.fill(0);
    }
  }
}
