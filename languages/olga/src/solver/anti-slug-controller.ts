// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Active Topside Anti-Slug Closed-Loop Feedback Controller.
 *
 * Implements:
 * 1. Riser-base pressure transmitter (PT_inlet) error feedback
 * 2. High-pass (washout) filter to isolate resonant slug oscillation frequencies
 * 3. Gain-scheduled PI controller with anti-windup clamping
 * 4. Actuator physical slew-rate travel limiters (|dZ/dt| <= R_max)
 * 5. Topside slug catcher high-liquid-level override logic
 */

export interface AntiSlugControllerOptions {
  /** Target pressure setpoint at riser base [Pa] */
  setpointPa: number;
  /** Proportional gain K_p [1/Pa] (e.g. 1.5e-6) */
  kp: number;
  /** Integral action time constant tau_i [s] (e.g. 60.0) */
  tiSeconds: number;
  /** Washout (high-pass) filter time constant tau_w [s] (e.g. 40.0) */
  washoutTimeSeconds?: number;
  /** Gain-scheduling parameter gamma: K_p(Z) = K_p0 * (1 + gamma * (1 - Z)) */
  gainSchedulingFactor?: number;
  /** Maximum choke physical travel slew rate [1/s] (e.g. 0.05 = 5%/s) */
  maxSlewRatePerSecond?: number;
  /** Minimum allowable choke opening [0..1] */
  minChokeOpening?: number;
  /** Maximum allowable choke opening [0..1] */
  maxChokeOpening?: number;
  /** Nominal baseline choke opening [0..1] */
  nominalChokeOpening?: number;
  /** Topside slug catcher capacity [m^3] for high-level override */
  slugCatcherCapacityM3?: number;
  /** Fraction of capacity triggering override (default 0.8 = 80%) */
  slugCatcherOverrideThreshold?: number;
  /** Slug catcher override proportional gain */
  slugCatcherOverrideGain?: number;
}

export interface AntiSlugSensorInputs {
  /** Measured pressure at subsea riser base [Pa] */
  riserBasePressurePa: number;
  /** Measured topside arrival pressure upstream of choke [Pa] */
  topsidePressurePa?: number;
  /** Liquid surge volume currently held in topside slug catcher [m^3] */
  surgeVolumeM3?: number;
}

export interface AntiSlugControlOutput {
  /** Commanded choke valve opening [0..1] */
  chokeOpening: number;
  /** Raw setpoint error e(t) = P_sp - P_meas [Pa] */
  rawErrorPa: number;
  /** Filtered setpoint error through washout filter [Pa] */
  filteredErrorPa: number;
  /** Current integral action state */
  integralState: number;
  /** True if slug catcher high-level override is active */
  surgeOverrideActive: boolean;
}

export class AntiSlugController {
  public readonly options: Required<AntiSlugControllerOptions>;
  private prevMeasuredPressure: number | null = null;
  private washoutState: number = 0.0;
  private integratorState: number = 0.0;
  private currentChoke: number;

  constructor(options: AntiSlugControllerOptions) {
    this.options = {
      setpointPa: options.setpointPa,
      kp: options.kp,
      tiSeconds: Math.max(0.1, options.tiSeconds),
      washoutTimeSeconds: Math.max(1.0, options.washoutTimeSeconds ?? 40.0),
      gainSchedulingFactor: Math.max(0.0, options.gainSchedulingFactor ?? 0.5),
      maxSlewRatePerSecond: Math.max(0.001, options.maxSlewRatePerSecond ?? 0.05),
      minChokeOpening: Math.max(0.01, options.minChokeOpening ?? 0.05),
      maxChokeOpening: Math.min(1.0, options.maxChokeOpening ?? 1.0),
      nominalChokeOpening: Math.max(0.05, Math.min(1.0, options.nominalChokeOpening ?? 0.5)),
      slugCatcherCapacityM3: options.slugCatcherCapacityM3 ?? 100.0,
      slugCatcherOverrideThreshold: options.slugCatcherOverrideThreshold ?? 0.8,
      slugCatcherOverrideGain: options.slugCatcherOverrideGain ?? 1.5,
    };

    this.currentChoke = this.options.nominalChokeOpening;
  }

  /**
   * Resets all internal controller filter states and integrators.
   */
  public reset(): void {
    this.prevMeasuredPressure = null;
    this.washoutState = 0.0;
    this.integratorState = 0.0;
    this.currentChoke = this.options.nominalChokeOpening;
  }

  /**
   * Advances controller by dt seconds and computes the next choke opening command.
   */
  public step(inputs: AntiSlugSensorInputs, dt: number): AntiSlugControlOutput {
    const P_meas = inputs.riserBasePressurePa;
    const dtSafe = Math.max(1e-4, dt);

    // 1. Raw setpoint tracking error: e(t) = P_meas - P_sp
    // Note: When riser base pressure increases (slug building), error is positive,
    // demanding valve opening to relieve pressure; when pressure drops, throttle valve.
    const rawError = P_meas - this.options.setpointPa;

    // 2. High-pass (Washout) Filter:
    // H(s) = s * tau_w / (1 + s * tau_w)
    // Discretized: y_w[k] = alpha * (y_w[k-1] + P[k] - P[k-1])
    // where alpha = tau_w / (tau_w + dt)
    let filteredError: number;
    if (this.prevMeasuredPressure === null) {
      filteredError = 0.0;
      this.washoutState = 0.0;
    } else {
      const alpha = this.options.washoutTimeSeconds / (this.options.washoutTimeSeconds + dtSafe);
      const deltaP = P_meas - this.prevMeasuredPressure;
      this.washoutState = alpha * (this.washoutState + deltaP);
      filteredError = this.washoutState;
    }
    this.prevMeasuredPressure = P_meas;

    // 3. Gain Scheduling:
    // Choke valve non-linearity causes lower sensitivity near wide open.
    // K_p(Z) = K_p0 * (1 + gamma * (1 - Z))
    const scheduledKp = this.options.kp * (1.0 + this.options.gainSchedulingFactor * (1.0 - this.currentChoke));

    // 4. Integrator update with anti-windup:
    // Only integrate if not saturated in the direction of error
    const isSaturatedHigh = this.currentChoke >= this.options.maxChokeOpening && rawError > 0;
    const isSaturatedLow = this.currentChoke <= this.options.minChokeOpening && rawError < 0;

    if (!isSaturatedHigh && !isSaturatedLow) {
      this.integratorState += (scheduledKp / this.options.tiSeconds) * rawError * dtSafe;
    }

    // 5. PI Controller output:
    // Delta Z = K_p * filteredError + Integrator
    let targetChoke = this.options.nominalChokeOpening + scheduledKp * filteredError + this.integratorState;

    // 6. Topside Slug Catcher High-Level Override:
    // If liquid volume > threshold * capacity, throttle choke aggressively to prevent separator trip
    let surgeOverrideActive = false;
    if (inputs.surgeVolumeM3 !== undefined && this.options.slugCatcherCapacityM3 > 0) {
      const thresholdVol = this.options.slugCatcherOverrideThreshold * this.options.slugCatcherCapacityM3;
      if (inputs.surgeVolumeM3 > thresholdVol) {
        surgeOverrideActive = true;
        const excessFraction =
          (inputs.surgeVolumeM3 - thresholdVol) / Math.max(1.0, this.options.slugCatcherCapacityM3 - thresholdVol);
        const backoff = this.options.slugCatcherOverrideGain * excessFraction;
        targetChoke = Math.max(this.options.minChokeOpening, targetChoke - backoff);
      }
    }

    // 7. Clamp to physical limits [minChoke, maxChoke]
    const clampedTarget = Math.max(this.options.minChokeOpening, Math.min(this.options.maxChokeOpening, targetChoke));

    // 8. Actuator Slew-Rate Limiting: |dZ / dt| <= R_max
    const maxDelta = this.options.maxSlewRatePerSecond * dtSafe;
    const deltaZ = clampedTarget - this.currentChoke;
    const appliedDelta = Math.max(-maxDelta, Math.min(maxDelta, deltaZ));

    this.currentChoke += appliedDelta;
    this.currentChoke = Math.max(
      this.options.minChokeOpening,
      Math.min(this.options.maxChokeOpening, this.currentChoke),
    );

    return {
      chokeOpening: this.currentChoke,
      rawErrorPa: rawError,
      filteredErrorPa: filteredError,
      integralState: this.integratorState,
      surgeOverrideActive,
    };
  }
}
