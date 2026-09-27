// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Prognostics, Virtual Sensor Synthesis, and Remaining Useful Life (RUL) estimation.
 *
 * Extracts unmeasurable internal physics states from the WebAssembly DAE arena
 * and projects asset health degradation forward under prospective duty cycles.
 */

import type { DenseHermiteCheckpointTape } from "../core/dense-checkpoint-tape.js";

export interface VirtualSensorSpec {
  /** Identifier of the virtual sensor (e.g. "rotor_hotspot_temp"). */
  id: string;
  /** Human-readable display label. */
  name: string;
  /** SI or engineering units (e.g. "degC", "MPa"). */
  unit: string;
  /** DAE variable name corresponding to this internal state. */
  daeVariableName: string;
  /** Safe operating limit for threshold alerts. */
  alarmThreshold?: number;
}

export interface VirtualSensorReading {
  sensorId: string;
  time: number;
  value: number;
  alarmExceeded: boolean;
}

export interface DamageModelConfig {
  /** Type of cumulative damage law. */
  type: "arrhenius" | "fatigue_miner" | "linear_wear";
  /** Critical damage threshold representing end-of-life (typically 1.0). */
  criticalDamageThreshold?: number;
  /** Pre-exponential factor or degradation rate constant. */
  rateConstant: number;
  /** Activation energy / thermal sensitivity (for Arrhenius). */
  activationEnergy?: number;
  /** Boltzmann constant or gas constant scale. */
  boltzmannScale?: number;
  /** Exponent factor (e.g. Basquin slope or power-law exponent). */
  exponent?: number;
}

export interface RulForecast {
  /** Current accumulated damage (0.0 = pristine, 1.0 = failure). */
  currentDamage: number;
  /** Current asset health score (100% - damage%). */
  healthScore: number;
  /** Median projected Remaining Useful Life (hours or seconds). */
  rulP50: number;
  /** Conservative 10th percentile (90% confidence asset survives to this time). */
  rulP10: number;
  /** Optimistic 90th percentile. */
  rulP90: number;
  /** Projected failure timestamp (relative to current time). */
  projectedFailureDuration: number;
}

export class VirtualSensorSynthesizer {
  private readonly sensors: Map<string, VirtualSensorSpec> = new Map();

  constructor(specs: VirtualSensorSpec[] = []) {
    for (const spec of specs) {
      this.sensors.set(spec.id, spec);
    }
  }

  registerSensor(spec: VirtualSensorSpec): void {
    this.sensors.set(spec.id, spec);
  }

  getSensor(id: string): VirtualSensorSpec | undefined {
    return this.sensors.get(id);
  }

  /**
   * Synthesize virtual sensor readings from a continuous Hermite checkpoint tape at time `t`.
   */
  evaluateAt(tape: DenseHermiteCheckpointTape, t: number): VirtualSensorReading[] {
    const results: VirtualSensorReading[] = [];
    const stateMap = tape.getStateMap(t);
    const algMap = tape.getAlgebraicMap(t);

    for (const [id, spec] of this.sensors) {
      const stateVal = stateMap.get(spec.daeVariableName);
      const val = stateVal !== undefined ? stateVal : (algMap.get(spec.daeVariableName) ?? 0.0);
      const alarmExceeded = spec.alarmThreshold !== undefined ? val >= spec.alarmThreshold : false;

      results.push({
        sensorId: id,
        time: t,
        value: val,
        alarmExceeded,
      });
    }

    return results;
  }
}

export class RulPredictor {
  readonly damageConfig: Required<DamageModelConfig>;

  constructor(config: DamageModelConfig) {
    this.damageConfig = {
      type: config.type,
      criticalDamageThreshold: config.criticalDamageThreshold ?? 1.0,
      rateConstant: config.rateConstant,
      activationEnergy: config.activationEnergy ?? 0.8, // eV
      boltzmannScale: config.boltzmannScale ?? 8.617333262145e-5, // eV/K
      exponent: config.exponent ?? 1.0,
    };
  }

  /**
   * Calculate incremental damage dD/dt given instantaneous stress / temperature `stress`.
   */
  computeDamageRate(stress: number): number {
    switch (this.damageConfig.type) {
      case "arrhenius": {
        // stress = Temperature in Kelvin
        const T = Math.max(10.0, stress);
        const arg = -this.damageConfig.activationEnergy / (this.damageConfig.boltzmannScale * T);
        return this.damageConfig.rateConstant * Math.exp(Math.max(-80.0, Math.min(80.0, arg)));
      }
      case "fatigue_miner": {
        // stress = Stress amplitude in MPa, rate = (stress / S0)^m
        const s = Math.max(0.0, stress);
        return this.damageConfig.rateConstant * Math.pow(s, this.damageConfig.exponent);
      }
      case "linear_wear":
      default: {
        return this.damageConfig.rateConstant * Math.max(0.0, stress);
      }
    }
  }

  /**
   * Predict RUL given current cumulative damage and projected operating profile.
   *
   * @param currentDamage Current normalized damage level [0.0, criticalDamageThreshold].
   * @param dutyCycleStress Projected average stress/temperature or representative cycle.
   * @param uncertaintyStd Standard deviation of operational load variability (e.g. 0.1 for 10% load variation).
   */
  predictRul(currentDamage: number, dutyCycleStress: number, uncertaintyStd = 0.1): RulForecast {
    const dCrit = this.damageConfig.criticalDamageThreshold;
    const remainingMargin = Math.max(0.0, dCrit - currentDamage);
    const healthScore = Math.max(0.0, Math.min(100.0, (1.0 - currentDamage / dCrit) * 100.0));

    const nominalRate = this.computeDamageRate(dutyCycleStress);
    if (nominalRate <= 1e-15 || remainingMargin <= 0.0) {
      return {
        currentDamage,
        healthScore: remainingMargin <= 0.0 ? 0.0 : healthScore,
        rulP50: remainingMargin <= 0.0 ? 0.0 : Infinity,
        rulP10: remainingMargin <= 0.0 ? 0.0 : Infinity,
        rulP90: remainingMargin <= 0.0 ? 0.0 : Infinity,
        projectedFailureDuration: remainingMargin <= 0.0 ? 0.0 : Infinity,
      };
    }

    const nominalDuration = remainingMargin / nominalRate;

    // Uncertainty quantiles for log-normal distribution under load variance
    const p10Factor = Math.exp(-1.28155 * uncertaintyStd);
    const p90Factor = Math.exp(1.28155 * uncertaintyStd);

    return {
      currentDamage,
      healthScore,
      rulP50: nominalDuration,
      rulP10: nominalDuration * p10Factor,
      rulP90: nominalDuration * p90Factor,
      projectedFailureDuration: nominalDuration,
    };
  }
}
