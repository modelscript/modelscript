// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Asphaltene Phase Stability & Deposition (De Boer / SARA).
 *
 * Implements:
 * - De Boer Colloidal Instability Index (CII) from SARA analysis:
 *     CII = (Saturates + Asphaltenes) / (Aromatics + Resins)
 * - Asphaltene Onset Pressure (AOP) envelope across pipeline pressure/temperature
 * - Dynamic flocculation, deposition flux, and wall thickness accumulation
 * - Flowline hydraulic constriction and localized pressure drop penalty
 */

import type { SaraFractions } from "../types.js";
export type { SaraFractions };

export type AsphalteneStabilityStatus = "STABLE" | "MODERATELY_STABLE" | "UNSTABLE";

export interface AsphalteneInput {
  sara: SaraFractions;
  operatingPressurePa: number;
  operatingTemperatureK: number;
  bubblePointPressurePa: number;
  mixtureVelocity: number; // m/s
  wallShearStressPa?: number | undefined; // Pa
  pipeDiameter: number; // m
  exposureTimeHours: number; // cumulative hours
  existingDepositThicknessM?: number | undefined; // m
}

export interface AsphalteneEvaluationResult {
  /** Colloidal Instability Index (CII). */
  colloidalInstabilityIndex: number;
  /** Fluid stability classification. */
  stabilityStatus: AsphalteneStabilityStatus;
  /** Upper Asphaltene Onset Pressure [Pa]. */
  upperAopPressurePa: number;
  /** Lower Asphaltene Onset Pressure [Pa]. */
  lowerAopPressurePa: number;
  /** Whether current operating state lies inside the AOP precipitation envelope. */
  isInPrecipitationEnvelope: boolean;
  /** Net asphaltene deposition rate [um / hour]. */
  depositionRateUmPerHour: number;
  /** Cumulative accumulated deposit thickness [mm]. */
  accumulatedThicknessMm: number;
  /** Constricted internal pipeline diameter [m]. */
  constrictedDiameterM: number;
  /** Hydraulic flow resistance multiplier (P / P_clean) due to diameter reduction. */
  hydraulicPenaltyFactor: number;
  /** Recommended flow assurance mitigation action. */
  mitigationRecommendation: string;
}

export const ASPHALTENE_DENSITY_KG_M3 = 1180.0;

/**
 * Computes the De Boer Colloidal Instability Index (CII).
 *   CII = (Saturates + Asphaltenes) / (Aromatics + Resins)
 */
export function computeColloidalInstabilityIndex(sara: SaraFractions): number {
  const numerator = sara.saturatesPercent + sara.asphaltenesPercent;
  const denominator = Math.max(0.1, sara.aromaticsPercent + sara.resinsPercent);
  return numerator / denominator;
}

/**
 * Classifies fluid stability based on De Boer criteria.
 */
export function classifyAsphalteneStability(cii: number): AsphalteneStabilityStatus {
  if (cii < 0.7) return "STABLE";
  if (cii <= 0.9) return "MODERATELY_STABLE";
  return "UNSTABLE";
}

/**
 * Evaluates asphaltene precipitation tendency and dynamic wall deposition.
 */
export function evaluateAsphalteneRisk(input: AsphalteneInput): AsphalteneEvaluationResult {
  const cii = computeColloidalInstabilityIndex(input.sara);
  const status = classifyAsphalteneStability(cii);

  // Upper AOP typically sits 40 - 80 bar above bubble point pressure for light/medium crudes
  // Higher CII expands the AOP envelope
  const deltaAopUpper = 45.0e5 + (cii - 0.7) * 40.0e5;
  const upperAop = Math.max(input.bubblePointPressurePa, input.bubblePointPressurePa + deltaAopUpper);

  // Lower AOP sits below bubble point (light ends vaporize, enriching liquid in resins/aromatics)
  const lowerAop = Math.max(10.0e5, input.bubblePointPressurePa * 0.55);

  const p = input.operatingPressurePa;
  const isInEnvelope = p >= lowerAop && p <= upperAop && status !== "STABLE";

  // Deposition kinetics:
  // Near bubble point, supersaturation driving force reaches peak:
  let drivingForce = 0.0;
  if (isInEnvelope) {
    const pb = input.bubblePointPressurePa;
    const normDist = 1.0 - Math.min(1.0, Math.abs(p - pb) / (upperAop - lowerAop));
    drivingForce = Math.max(0.1, normDist * (cii / 0.8));
  }

  // Mass deposition flux J_dep [kg / (m^2 * s)]
  const vm = Math.max(0.2, Math.abs(input.mixtureVelocity));
  const tauW = input.wallShearStressPa ?? 0.5 * 850.0 * 0.005 * vm * vm;
  const kDep = 1.8e-7; // Mass transfer coefficient
  const jDep = isInEnvelope ? kDep * drivingForce * (input.sara.asphaltenesPercent / 100.0) * vm * 850.0 : 0.0;

  // Shear detachment / erosion flux J_shear
  const kShear = 1.2e-8;
  const jShear = kShear * Math.pow(Math.max(0, tauW), 1.2);

  const netFlux = Math.max(0.0, jDep - jShear); // kg / (m^2 * s)
  const growthRateMPerSec = netFlux / ASPHALTENE_DENSITY_KG_M3;
  const growthRateUmPerHour = growthRateMPerSec * 1e6 * 3600.0;

  const currentThickness = input.existingDepositThicknessM ?? 0.0;
  const newThickness = currentThickness + growthRateMPerSec * input.exposureTimeHours * 3600.0;
  const thicknessMm = newThickness * 1000.0;

  const constrictedD = Math.max(0.01, input.pipeDiameter - 2.0 * newThickness);
  // Darcy-Weisbach pressure drop penalty: DeltaP ~ 1 / D^5
  const hydraulicPenalty = Math.pow(input.pipeDiameter / constrictedD, 5.0);

  let recommendation = "Asphaltenes stable; maintain standard flow assurance monitoring.";
  if (status === "UNSTABLE") {
    if (isInEnvelope) {
      recommendation =
        "CRITICAL: Operating within AOP precipitation envelope! Continuous aromatic solvent / dispersant injection required.";
    } else {
      recommendation = "High CII index; avoid blending with incompatible paraffinic crudes or gas injection.";
    }
  } else if (status === "MODERATELY_STABLE" && isInEnvelope) {
    recommendation =
      "Operating near bubble point in moderate precipitation zone; monitor pigging wax/asphaltene returns.";
  }

  return {
    colloidalInstabilityIndex: cii,
    stabilityStatus: status,
    upperAopPressurePa: upperAop,
    lowerAopPressurePa: lowerAop,
    isInPrecipitationEnvelope: isInEnvelope,
    depositionRateUmPerHour: growthRateUmPerHour,
    accumulatedThicknessMm: thicknessMm,
    constrictedDiameterM: constrictedD,
    hydraulicPenaltyFactor: hydraulicPenalty,
    mitigationRecommendation: recommendation,
  };
}
