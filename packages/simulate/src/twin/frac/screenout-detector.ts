// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/twin/frac — Nolte-Smith Diagnostic & Screen-Out Early Warning Engine.
 *
 * Implements:
 * 1. Savitzky-Golay / rolling-window smoothed logarithmic Nolte-Smith derivative:
 *    b(t) = d(ln P_net) / d(ln t) = (t / P_net) * (dP_net / dt)
 * 2. Automatic Nolte-Smith regime classification (Modes I, II, III, IV).
 * 3. Time-to-Screenout (TTS) predictive forecasting against MAOP pressure limits.
 * 4. High-frequency alarm triaging (NORMAL, WATCH, WARNING, EMERGENCY_SHUTDOWN).
 */

import { CusumDriftDetector, type DriftChannelConfig } from "../drift-detector.js";
import type { NolteSmithRegime, ScreenoutAlarmLevel, ScreenoutDiagnostic } from "./types.js";

export interface ScreenoutDetectorOptions {
  /** Maximum Allowable Operating Pressure MAOP of wellhead / casing (Pascals, default: 7.0e7 Pa = ~10,150 psi). */
  maopPascals?: number | undefined;
  /** Warning threshold percentage of MAOP (default: 0.90 = 90% of MAOP). */
  warningPressureRatio?: number | undefined;
  /** Emergency shutdown threshold percentage of MAOP (default: 0.96 = 96% of MAOP). */
  emergencyPressureRatio?: number | undefined;
  /** Time window (seconds) for computing smoothed derivatives (default: 20 seconds). */
  smoothingWindowSeconds?: number | undefined;
  /** Optional CUSUM change-point detector settings for detecting abrupt pressure slope jumps. */
  cusumConfig?: DriftChannelConfig | undefined;
}

export class ScreenoutDetector {
  readonly maop: number;
  readonly warningRatio: number;
  readonly emergencyRatio: number;
  readonly windowSec: number;

  private readonly timeHistory: number[] = [];
  private readonly pNetHistory: number[] = [];
  private readonly pSurfHistory: number[] = [];
  private readonly cusum: CusumDriftDetector;

  constructor(options?: ScreenoutDetectorOptions) {
    this.maop = options?.maopPascals ?? 7.0e7; // 70 MPa (~10,150 psi)
    this.warningRatio = options?.warningPressureRatio ?? 0.9;
    this.emergencyRatio = options?.emergencyPressureRatio ?? 0.96;
    this.windowSec = options?.smoothingWindowSeconds ?? 20.0;

    const channelCfg: DriftChannelConfig = options?.cusumConfig ?? {
      name: "dP_surf_dt",
      expectedMean: 0.0,
      expectedStd: 5.0e3,
      minShift: 1.0e4,
      threshold: 4.0,
    };
    this.cusum = new CusumDriftDetector([channelCfg]);
  }

  /**
   * Pushes a new observation and computes live screen-out diagnostics.
   *
   * @param timeSeconds    Current elapsed time from stage start (seconds).
   * @param netPressurePa  Net fracture pressure: P_net = BHTP - sigma_min - dP_perf (Pascals).
   * @param surfPressurePa Surface treating pressure (Pascals).
   */
  evaluate(timeSeconds: number, netPressurePa: number, surfPressurePa: number): ScreenoutDiagnostic {
    this.timeHistory.push(timeSeconds);
    this.pNetHistory.push(Math.max(1e3, netPressurePa));
    this.pSurfHistory.push(surfPressurePa);

    // Prune history outside 2x the smoothing window
    const cutoffTime = timeSeconds - 2.5 * this.windowSec;
    while (this.timeHistory.length > 3 && this.timeHistory[0]! < cutoffTime) {
      this.timeHistory.shift();
      this.pNetHistory.shift();
      this.pSurfHistory.shift();
    }

    const n = this.timeHistory.length;
    if (n < 3) {
      return {
        timeSeconds,
        nolteSmithSlope: 0.2,
        dNetPressureDt: 0.0,
        dSurfacePressureDt: 0.0,
        regime: "MODE_I_STABLE_PROPAGATION",
        alarmLevel: "NORMAL",
        timeToScreenoutSeconds: null,
        message: "Initializing screen-out tracking window",
      };
    }

    // 1. Linear regression across window for smoothed dP_net/dt and dP_surf/dt
    const t0 = this.timeHistory[0]!;
    let sumT = 0.0;
    let sumT2 = 0.0;
    let sumPNet = 0.0;
    let sumTPNet = 0.0;
    let sumPSurf = 0.0;
    let sumTPSurf = 0.0;

    for (let i = 0; i < n; i++) {
      const dt = this.timeHistory[i]! - t0;
      const pn = this.pNetHistory[i]!;
      const ps = this.pSurfHistory[i]!;

      sumT += dt;
      sumT2 += dt * dt;
      sumPNet += pn;
      sumTPNet += dt * pn;
      sumPSurf += ps;
      sumTPSurf += dt * ps;
    }

    const denom = n * sumT2 - sumT * sumT;
    const dPnetDt = denom !== 0.0 ? (n * sumTPNet - sumT * sumPNet) / denom : 0.0;
    const dPsurfDt = denom !== 0.0 ? (n * sumTPSurf - sumT * sumPSurf) / denom : 0.0;

    // 2. Nolte-Smith Logarithmic Slope: b = (t / P_net) * (dP_net / dt)
    // Use effective elapsed pumping time (at least 30s to avoid singularity at start)
    const effectiveTime = Math.max(30.0, timeSeconds);
    const avgPnet = sumPNet / n;
    const nolteSmithSlope = (effectiveTime / Math.max(1e4, avgPnet)) * dPnetDt;

    // Update CUSUM change-point detector with surface pressure derivative
    const driftEvent = this.cusum.update(timeSeconds, [dPsurfDt]);

    // 3. Regime Classification
    let regime: NolteSmithRegime;
    if (nolteSmithSlope > 1.7) {
      regime = "MODE_IV_NEAR_WELLBORE_SCREENOUT";
    } else if (nolteSmithSlope >= 0.75) {
      regime = "MODE_III_TIP_SCREENOUT";
    } else if (nolteSmithSlope >= 0.08) {
      regime = "MODE_I_STABLE_PROPAGATION";
    } else {
      regime = "MODE_II_HEIGHT_GROWTH";
    }

    // 4. Time-to-Screenout (TTS) Calculation
    const currentSurfP = surfPressurePa;
    const pressureMargin = this.maop - currentSurfP;
    let tts: number | null = null;
    if (dPsurfDt > 1.0e3 && pressureMargin > 0.0) {
      // Linear projection to MAOP breach
      tts = pressureMargin / dPsurfDt;
    }

    // 5. Alarm Triaging
    let alarmLevel: ScreenoutAlarmLevel = "NORMAL";
    let message = "Stable propagation regime";

    const emergencyP = this.maop * this.emergencyRatio;
    const warningP = this.maop * this.warningRatio;

    if (currentSurfP >= emergencyP || (tts !== null && tts < 60.0 && regime === "MODE_IV_NEAR_WELLBORE_SCREENOUT")) {
      alarmLevel = "EMERGENCY_SHUTDOWN";
      message = `CRITICAL: Immediate screen-out or MAOP breach in ${tts !== null ? Math.round(tts) : 0}s. Emergency shutdown advised.`;
    } else if (
      currentSurfP >= warningP ||
      (tts !== null &&
        tts < 180.0 &&
        (regime === "MODE_III_TIP_SCREENOUT" || regime === "MODE_IV_NEAR_WELLBORE_SCREENOUT")) ||
      (driftEvent !== null && (regime === "MODE_III_TIP_SCREENOUT" || regime === "MODE_IV_NEAR_WELLBORE_SCREENOUT"))
    ) {
      alarmLevel = "WARNING";
      message = `WARNING: Impending screen-out (${regime}). TTS: ${tts !== null ? Math.round(tts) : "N/A"}s. Consider cutting sand or increasing rate.`;
    } else if (regime === "MODE_III_TIP_SCREENOUT") {
      alarmLevel = "WATCH";
      message = "WATCH: Tip screen-out detected (Mode III). Fracture length propagation halted; ballooning underway.";
    } else if (regime === "MODE_II_HEIGHT_GROWTH") {
      alarmLevel = "NORMAL";
      message = "Mode II: Pressure flat or negative slope (possible height growth or natural fracture loss).";
    }

    return {
      timeSeconds,
      nolteSmithSlope,
      dNetPressureDt: dPnetDt,
      dSurfacePressureDt: dPsurfDt,
      regime,
      alarmLevel,
      timeToScreenoutSeconds: tts,
      message,
    };
  }

  /**
   * Resets detector history for a new stage.
   */
  reset(): void {
    this.timeHistory.length = 0;
    this.pNetHistory.length = 0;
    this.pSurfHistory.length = 0;
    this.cusum.reset();
  }
}
