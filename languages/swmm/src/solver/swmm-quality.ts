// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — Water Quality Pollutant Buildup & Washoff Engine.
 *
 * Implements standard exponential buildup and rating-curve washoff kinetics
 * for urban storm runoff water quality tracking (TSS, BOD, TN, TP).
 */

import type { SwmmDeck } from "../types.js";

export type PollutantName = "TSS" | "BOD" | "TN" | "TP";

export interface PollutantParams {
  name: PollutantName;
  units: "MG/L" | "UG/L";
  maxBuildupKgPerHa: number;
  buildupRatePerDay: number;
  washoffCoeff: number;
  washoffExponent: number; // typically 1.0 - 2.0
}

export interface SubcatchmentQualityResult {
  subcatchmentId: string;
  totalRunoffVolumeM3: number;
  pollutantMassesKg: Record<string, number>;
  eventMeanConcentrationsMgL: Record<string, number>;
}

export interface SwmmQualityResult {
  subcatchments: Map<string, SubcatchmentQualityResult>;
  totalExportedMassKg: Record<string, number>;
  dominantPollutant: string;
}

export const DEFAULT_POLLUTANTS: PollutantParams[] = [
  {
    name: "TSS",
    units: "MG/L",
    maxBuildupKgPerHa: 100.0,
    buildupRatePerDay: 0.15,
    washoffCoeff: 0.05,
    washoffExponent: 1.5,
  },
  {
    name: "BOD",
    units: "MG/L",
    maxBuildupKgPerHa: 15.0,
    buildupRatePerDay: 0.1,
    washoffCoeff: 0.03,
    washoffExponent: 1.2,
  },
  {
    name: "TN",
    units: "MG/L",
    maxBuildupKgPerHa: 2.5,
    buildupRatePerDay: 0.08,
    washoffCoeff: 0.04,
    washoffExponent: 1.3,
  },
  {
    name: "TP",
    units: "MG/L",
    maxBuildupKgPerHa: 0.5,
    buildupRatePerDay: 0.06,
    washoffCoeff: 0.04,
    washoffExponent: 1.3,
  },
];

/**
 * Calculates pollutant buildup, washoff, and Event Mean Concentrations (EMC)
 * for all subcatchments under a storm rainfall-runoff event.
 */
export function computeSwmmWaterQuality(
  deck: SwmmDeck,
  runoffVolumesM3: Map<string, number>,
  antecedentDryDays = 5.0,
  pollutants: PollutantParams[] = DEFAULT_POLLUTANTS,
): SwmmQualityResult {
  const subResults = new Map<string, SubcatchmentQualityResult>();
  const totalExported: Record<string, number> = {};

  for (const pol of pollutants) {
    totalExported[pol.name] = 0.0;
  }

  for (const [subId, sub] of deck.subcatchments) {
    const areaHa = sub.area;
    const runoffVolM3 = runoffVolumesM3.get(subId) ?? Math.max(10.0, areaHa * 100.0);
    const polMasses: Record<string, number> = {};
    const emcs: Record<string, number> = {};

    for (const pol of pollutants) {
      // 1. Exponential buildup over dry antecedent days: B = Bmax * (1 - exp(-k * t)) [kg/ha]
      const buildupPerHa = pol.maxBuildupKgPerHa * (1.0 - Math.exp(-pol.buildupRatePerDay * antecedentDryDays));
      const totalAvailableKg = buildupPerHa * areaHa;

      // 2. Washoff mass: W = k_wash * (runoffDepth_mm)^exponent * B
      const runoffDepthMm = (runoffVolM3 / (areaHa * 10000.0)) * 1000.0;
      const washFraction = Math.min(
        0.95,
        pol.washoffCoeff * Math.pow(Math.max(0.1, runoffDepthMm), pol.washoffExponent),
      );
      const washoffKg = totalAvailableKg * washFraction;

      polMasses[pol.name] = washoffKg;
      totalExported[pol.name] = (totalExported[pol.name] ?? 0.0) + washoffKg;

      // 3. Event Mean Concentration: EMC = (Mass_kg * 1e6 mg/kg) / (Volume_m3 * 1000 L/m3) = Mass_kg * 1000 / Volume_m3
      const emc = runoffVolM3 > 0 ? (washoffKg * 1000.0) / runoffVolM3 : 0.0;
      emcs[pol.name] = emc;
    }

    subResults.set(subId, {
      subcatchmentId: subId,
      totalRunoffVolumeM3: runoffVolM3,
      pollutantMassesKg: polMasses,
      eventMeanConcentrationsMgL: emcs,
    });
  }

  // Find dominant pollutant by exported mass
  let dominant = "TSS";
  let maxMass = 0.0;
  for (const [name, mass] of Object.entries(totalExported)) {
    if (mass > maxMass) {
      maxMass = mass;
      dominant = name;
    }
  }

  return {
    subcatchments: subResults,
    totalExportedMassKg: totalExported,
    dominantPollutant: dominant,
  };
}
