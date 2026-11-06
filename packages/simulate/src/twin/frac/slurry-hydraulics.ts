// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/twin/frac — Wellbore Slurry Hydraulics Solver.
 *
 * Implements:
 * 1. Exact mass/volume balance slurry mixture density from proppant concentration.
 * 2. True Vertical Depth (TVD) hydrostatic pressure integration along wellbore survey.
 * 3. Generalized non-Newtonian power-law pipe friction with Drag Reduction Agent (DRA) degradation.
 * 4. Surface-to-bottomhole treating pressure (BHTP) translation:
 *    BHTP(t) = P_surf(t) + P_hyd(t) - P_fric(t)
 */

import type { FracTelemetrySample, SlurryRheologyConfig, WellboreGeometry, WellboreHydraulicsState } from "./types.js";

// Standard physical constants
const GRAVITY = 9.80665; // m/s²
const DEFAULT_WATER_DENSITY = 1000.0; // kg/m³
const DEFAULT_PROPPANT_DENSITY = 2650.0; // kg/m³ (Silica sand)

/**
 * Computes exact proppant slurry mixture density from proppant concentration.
 *
 * Formula:
 *   rho_slurry = (rho_base + C_prop) / (1 + C_prop / rho_proppant)
 *
 * @param proppantConcKgPerM3  Proppant mass added per m³ of clean fluid (kg/m³).
 * @param baseDensity          Base clean fluid density (kg/m³, default: 1000).
 * @param proppantDensity      Solid grain density (kg/m³, default: 2650).
 */
export function calculateSlurryDensity(
  proppantConcKgPerM3: number,
  baseDensity = DEFAULT_WATER_DENSITY,
  proppantDensity = DEFAULT_PROPPANT_DENSITY,
): number {
  if (proppantConcKgPerM3 <= 0.0) {
    return Math.max(800.0, baseDensity);
  }
  const cleanRho = Math.max(800.0, baseDensity);
  const grainRho = Math.max(1200.0, proppantDensity);
  const volumeExpansion = 1.0 + proppantConcKgPerM3 / grainRho;
  return (cleanRho + proppantConcKgPerM3) / volumeExpansion;
}

/**
 * Converts Field Units (ppg / PPA) to SI (kg/m³).
 * 1 PPA (pound proppant added per gallon water) = 119.8264 kg/m³.
 */
export function ppaToKgPerM3(ppa: number): number {
  return ppa * 119.826427;
}

/**
 * Converts Field Flow Rate (bpm - barrels per minute) to SI (m³/s).
 * 1 bpm = 0.00264979 m³/s.
 */
export function bpmToM3PerSec(bpm: number): number {
  return bpm * 0.00264978825;
}

/**
 * Converts Pressure in psi to Pascals.
 * 1 psi = 6894.75729 Pascals.
 */
export function psiToPascals(psi: number): number {
  return psi * 6894.757293;
}

/**
 * Converts Pressure in Pascals to psi.
 */
export function pascalsToPsi(pa: number): number {
  return pa / 6894.757293;
}

/**
 * Calculates Fanning friction factor for generalized power-law non-Newtonian fluid
 * in smooth and rough pipes using Dodge-Metzner and Churchill correlations.
 *
 * @param reGen      Generalized Reynolds number.
 * @param n          Flow behavior index (dimensionless, slickwater n ~ 0.6 to 0.8).
 * @param roughness  Relative pipe roughness (epsilon / D).
 */
export function calculatePowerLawFanningFriction(reGen: number, n = 0.75, roughness = 0.0004): number {
  if (reGen <= 1e-4) return 0.04;

  // Laminar regime: Re_gen < 2100
  if (reGen < 2100.0) {
    return 16.0 / Math.max(1.0, reGen);
  }

  // Turbulent regime: Dodge-Metzner correlation for non-Newtonian flow with pipe roughness
  // f = 0.0791 / (n^0.675 * Re_gen^0.25)
  const nClamped = Math.max(0.3, Math.min(1.0, n));
  const fSmooth = 0.0791 / (Math.pow(nClamped, 0.675) * Math.pow(reGen, 0.25));

  // Roughness contribution (von Kármán fully rough asymptote: 1 / sqrt(f) = -4 log(roughness / 3.7))
  if (roughness > 1e-5) {
    const fRough = 1.0 / Math.pow(-4.0 * Math.log10(roughness / 3.7), 2.0);
    return Math.max(fSmooth, fRough);
  }

  return Math.max(0.0015, fSmooth);
}

/**
 * Integrates hydrostatic pressure head from surface down to target depth along the survey stations.
 */
export function integrateHydrostaticPressure(
  survey: WellboreGeometry,
  averageSlurryDensity: number,
  targetMeasuredDepth?: number,
): number {
  const targetMd = targetMeasuredDepth ?? survey.totalMeasuredDepth;
  const stations = survey.surveyStations;

  if (stations.length === 0) {
    // Fallback: direct vertical depth product
    return averageSlurryDensity * GRAVITY * survey.trueVerticalDepth;
  }

  let totalHydrostatic = 0.0;
  for (let i = 0; i < stations.length; i++) {
    const curr = stations[i]!;
    if (i === 0) {
      const segTvd = Math.min(curr.trueVerticalDepth, survey.trueVerticalDepth);
      totalHydrostatic += averageSlurryDensity * GRAVITY * Math.max(0.0, segTvd);
    } else {
      const prev = stations[i - 1]!;
      if (prev.measuredDepth >= targetMd) break;

      const effectiveMd = Math.min(curr.measuredDepth, targetMd);
      const frac = (effectiveMd - prev.measuredDepth) / Math.max(1e-4, curr.measuredDepth - prev.measuredDepth);
      const deltaTvd = frac * (curr.trueVerticalDepth - prev.trueVerticalDepth);

      totalHydrostatic += averageSlurryDensity * GRAVITY * Math.max(0.0, deltaTvd);
    }
    if (curr.measuredDepth >= targetMd) break;
  }

  return totalHydrostatic;
}

/**
 * Calculates pipe frictional pressure loss down the casing string for a given slurry flow rate.
 */
export function calculateWellborePipeFriction(
  slurryRateM3PerSec: number,
  slurryDensity: number,
  survey: WellboreGeometry,
  rheology?: SlurryRheologyConfig | undefined,
  targetMeasuredDepth?: number,
): { frictionLossPascals: number; effectiveDragReduction: number } {
  const q = Math.abs(slurryRateM3PerSec);
  if (q < 1e-6) {
    return { frictionLossPascals: 0.0, effectiveDragReduction: 0.0 };
  }

  const targetMd = targetMeasuredDepth ?? survey.totalMeasuredDepth;
  const n = rheology?.flowBehaviorIndexN ?? 0.75;
  const k = rheology?.consistencyIndexK ?? 0.015; // Pa * s^n
  const maxDra = rheology?.maxDragReduction ?? 0.7; // 70% max friction reduction
  const draDegradation = rheology?.draDegradationRatePerMeter ?? 1.5e-5; // 1/m

  // Compute average wellbore diameter and length
  let totalLength = 0.0;
  let totalFriction = 0.0;
  let weightedDraSum = 0.0;

  const stations = survey.surveyStations;
  if (stations.length === 0) {
    // Default 5.5" (0.1397m OD, ~0.1214m ID) single casing string
    const d = 0.1214;
    const area = (Math.PI / 4.0) * d * d;
    const v = q / area;

    // Generalized Reynolds number for power-law
    const reGen =
      (Math.pow(d, n) * Math.pow(v, 2.0 - n) * slurryDensity) /
      (k * Math.pow((3.0 * n + 1.0) / (4.0 * n), n) * Math.pow(8.0, n - 1.0));

    const fFanning = calculatePowerLawFanningFriction(reGen, n, 4.5e-5 / d);
    const avgDepth = targetMd / 2.0;
    const draEff = maxDra * Math.exp(-draDegradation * avgDepth);
    const fEff = fFanning * (1.0 - draEff);

    // Darcy pressure drop: dP = 2 * f_fanning * (L/D) * rho * v^2
    const dp = 2.0 * fEff * (targetMd / d) * slurryDensity * v * v;
    return { frictionLossPascals: dp, effectiveDragReduction: draEff };
  }

  for (let i = 0; i < stations.length; i++) {
    const curr = stations[i]!;
    const prevMd = i === 0 ? 0.0 : stations[i - 1]!.measuredDepth;
    if (prevMd >= targetMd) break;

    const segEndMd = Math.min(curr.measuredDepth, targetMd);
    const segLength = Math.max(0.0, segEndMd - prevMd);
    if (segLength <= 0.0) continue;

    const d = curr.innerDiameter;
    const area = (Math.PI / 4.0) * d * d;
    const v = q / area;

    const reGen =
      (Math.pow(d, n) * Math.pow(v, 2.0 - n) * slurryDensity) /
      (k * Math.pow((3.0 * n + 1.0) / (4.0 * n), n) * Math.pow(8.0, n - 1.0));

    const relRoughness = (curr.roughnessMeters ?? 4.5e-5) / d;
    const fFanning = calculatePowerLawFanningFriction(reGen, n, relRoughness);

    const segMidpoint = prevMd + segLength / 2.0;
    const draEff = maxDra * Math.exp(-draDegradation * segMidpoint);
    const fEff = fFanning * (1.0 - draEff);

    const dpSeg = 2.0 * fEff * (segLength / d) * slurryDensity * v * v;
    totalFriction += dpSeg;
    totalLength += segLength;
    weightedDraSum += draEff * segLength;
  }

  const avgDra = totalLength > 0.0 ? weightedDraSum / totalLength : maxDra;
  return { frictionLossPascals: totalFriction, effectiveDragReduction: avgDra };
}

/**
 * Solves instantaneous wellbore hydraulics state translating surface pressure to bottom-hole.
 *
 * @param sample   Telemetry sample containing surface pressure, rate, and proppant conc.
 * @param survey   Wellbore trajectory and casing geometry.
 * @param rheology Fluid rheology and DRA parameters.
 * @param targetMd Measured depth of target stage perforations (default: survey total depth).
 */
export function solveWellboreHydraulics(
  sample: FracTelemetrySample,
  survey: WellboreGeometry,
  rheology?: SlurryRheologyConfig | undefined,
  targetMd?: number,
): WellboreHydraulicsState {
  const baseRho = rheology?.baseFluidDensityKgPerM3 ?? DEFAULT_WATER_DENSITY;
  const propRho = rheology?.proppantGrainDensityKgPerM3 ?? DEFAULT_PROPPANT_DENSITY;

  // 1. Dynamic Slurry Density
  const slurryRho = calculateSlurryDensity(sample.proppantConcentrationKgPerM3, baseRho, propRho);

  // 2. Hydrostatic Pressure Head
  const pHyd = integrateHydrostaticPressure(survey, slurryRho, targetMd);

  // 3. Pipe Friction Pressure Drop
  const { frictionLossPascals, effectiveDragReduction } = calculateWellborePipeFriction(
    sample.slurryRateM3PerSec,
    slurryRho,
    survey,
    rheology,
    targetMd,
  );

  // 4. BHTP = P_surf + P_hyd - P_fric
  const bhtp = sample.surfacePressurePascals + pHyd - frictionLossPascals;

  return {
    timeSeconds: sample.timeSeconds,
    slurryDensityKgPerM3: slurryRho,
    hydrostaticPressurePascals: pHyd,
    pipeFrictionPressurePascals: frictionLossPascals,
    effectiveDragReduction,
    bottomHoleTreatingPressurePascals: bhtp,
  };
}
