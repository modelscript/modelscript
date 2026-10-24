// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Thermodynamic Hydrate Inhibition (MEG & Methanol).
 *
 * Models thermodynamic chemical inhibitors (Monoethylene Glycol, Methanol, Ethanol),
 * evaluating hydrate equilibrium temperature depression (Hammerschmidt / Nielsen equation)
 * and calculating minimum inhibitor dosing rates required to ensure flowline subsea safety.
 */

import { getHydrateFormationTemperatureK } from "./thermal-cooldown.js";

export type ThermodynamicInhibitorKind = "MEG" | "METHANOL" | "ETHANOL";

export interface InhibitorProperties {
  kind: ThermodynamicInhibitorKind;
  molecularWeight: number; // g / mol
  hammerschmidtConstant: number; // K * (g / mol)
  density: number; // kg / m^3
}

export const INHIBITOR_DATABASE: Record<ThermodynamicInhibitorKind, InhibitorProperties> = {
  MEG: {
    kind: "MEG",
    molecularWeight: 62.07,
    hammerschmidtConstant: 1297.0,
    density: 1113.0,
  },
  METHANOL: {
    kind: "METHANOL",
    molecularWeight: 32.04,
    hammerschmidtConstant: 1297.0,
    density: 792.0,
  },
  ETHANOL: {
    kind: "ETHANOL",
    molecularWeight: 46.07,
    hammerschmidtConstant: 1297.0,
    density: 789.0,
  },
};

export interface InhibitionResult {
  /** Uninhibited hydrate formation temperature [K]. */
  uninhibitedHydrateTempK: number;
  /** Depressed hydrate formation temperature after chemical inhibition [K]. */
  inhibitedHydrateTempK: number;
  /** Hydrate temperature depression DeltaT_hyd [K]. */
  temperatureDepressionK: number;
  /** Resulting subcooling safety margin [K] (T_fluid - T_hyd,inhibited). */
  subcoolingMarginK: number;
  /** Whether the system is safe from hydrate formation (subcooling margin >= required margin). */
  isSafe: boolean;
}

export interface InhibitorDosingRequirements {
  /** Required inhibitor concentration in the aqueous phase [weight %]. */
  requiredInhibitorWeightPercent: number;
  /** Minimum chemical inhibitor mass injection rate [kg / h]. */
  injectionMassRateKgPerHour: number;
  /** Minimum chemical inhibitor volumetric injection rate [liters / h]. */
  injectionVolumeRateLitersPerHour: number;
  /** Required inhibitor dosage ratio (kg inhibitor / kg produced water). */
  dosageRatio: number;
}

/**
 * Calculates hydrate equilibrium depression DeltaT_hyd given inhibitor concentration in aqueous phase.
 *
 * @param weightPercent  Inhibitor mass fraction in free water (0 to 80 wt%)
 * @param inhibitorKind  Type of chemical inhibitor ('MEG', 'METHANOL', 'ETHANOL')
 */
export function calculateHydrateDepression(
  weightPercent: number,
  inhibitorKind: ThermodynamicInhibitorKind = "MEG",
): number {
  const w = Math.max(0.0, Math.min(85.0, weightPercent));
  if (w <= 0.0) return 0.0;

  const props = INHIBITOR_DATABASE[inhibitorKind];
  // Hammerschmidt Equation:
  // DeltaT_hyd = (K_H * W) / (M * (100 - W))
  const deltaT = (props.hammerschmidtConstant * w) / (props.molecularWeight * (100.0 - w));
  return deltaT;
}

/**
 * Evaluates inhibited hydrate equilibrium temperature and safety margin for a flowline condition.
 */
export function evaluateHydrateInhibition(
  pressurePa: number,
  fluidTemperatureK: number,
  inhibitorWeightPercent: number,
  inhibitorKind: ThermodynamicInhibitorKind = "MEG",
  requiredSafetyMarginK = 3.0,
): InhibitionResult {
  const uninhibitedTemp = getHydrateFormationTemperatureK(pressurePa);
  const depression = calculateHydrateDepression(inhibitorWeightPercent, inhibitorKind);
  const inhibitedTemp = uninhibitedTemp - depression;
  const margin = fluidTemperatureK - inhibitedTemp;

  return {
    uninhibitedHydrateTempK: uninhibitedTemp,
    inhibitedHydrateTempK: inhibitedTemp,
    temperatureDepressionK: depression,
    subcoolingMarginK: margin,
    isSafe: margin >= requiredSafetyMarginK,
  };
}

/**
 * Computes required inhibitor injection rate to protect a pipeline with a known water production rate.
 *
 * @param pressurePa             Lowest operating / arrival pressure [Pa]
 * @param minFluidTempK          Lowest observed pipeline temperature [K] (e.g. seabed ambient)
 * @param waterProductionRateKgH Produced water mass rate [kg / hour]
 * @param inhibitorKind          Inhibitor type ('MEG' | 'METHANOL')
 * @param targetSafetyMarginK    Target margin above hydrate curve (default: 3.0 K)
 */
export function calculateInhibitorDosing(
  pressurePa: number,
  minFluidTempK: number,
  waterProductionRateKgH: number,
  inhibitorKind: ThermodynamicInhibitorKind = "MEG",
  targetSafetyMarginK = 3.0,
): InhibitorDosingRequirements {
  const uninhibitedTemp = getHydrateFormationTemperatureK(pressurePa);
  // Target depressed hydrate temperature: T_hyd,target = minFluidTempK - targetSafetyMarginK
  const targetHydrateTemp = minFluidTempK - targetSafetyMarginK;
  const requiredDepressionK = Math.max(0.0, uninhibitedTemp - targetHydrateTemp);

  if (requiredDepressionK <= 0.0) {
    return {
      requiredInhibitorWeightPercent: 0.0,
      injectionMassRateKgPerHour: 0.0,
      injectionVolumeRateLitersPerHour: 0.0,
      dosageRatio: 0.0,
    };
  }

  const props = INHIBITOR_DATABASE[inhibitorKind];
  // Solve Hammerschmidt for W:
  // DeltaT = (K * W) / (M * (100 - W))
  // DeltaT * M * 100 - DeltaT * M * W = K * W
  // W * (K + DeltaT * M) = 100 * DeltaT * M
  // W = (100 * DeltaT * M) / (K + DeltaT * M)
  const num = 100.0 * requiredDepressionK * props.molecularWeight;
  const den = props.hammerschmidtConstant + requiredDepressionK * props.molecularWeight;
  const targetW = Math.min(80.0, num / den);

  // Injection mass rate:
  // W = m_inh / (m_inh + m_water) * 100
  // m_inh = m_water * (W / (100 - W))
  const dosageRatio = targetW / (100.0 - targetW);
  const injectionMassRateKgH = waterProductionRateKgH * dosageRatio;
  const injectionVolumeRateLitersH = (injectionMassRateKgH / props.density) * 1000.0;

  return {
    requiredInhibitorWeightPercent: targetW,
    injectionMassRateKgPerHour: injectionMassRateKgH,
    injectionVolumeRateLitersPerHour: injectionVolumeRateLitersH,
    dosageRatio,
  };
}
