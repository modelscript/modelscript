// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Hydrate Slurry Formation Kinetics & Plugging Risk (CSMHYD / Camargo-Mills).
 *
 * Implements transient hydrate crystal nucleation and growth kinetics:
 * - Subcooling driving force: DeltaT_sub = T_eq(P) - T
 * - Englezos / Bishnoi / CSMHYD intrinsic crystal growth rate:
 *     dn_H / dt = K_1 * A_s * DeltaT_sub * exp(-E_a / (R * T))
 * - Slurry solid volume fraction: Phi_H = V_hydrate / V_liquid
 * - Camargo & Mills (1998) / Krieger-Dougherty slurry apparent viscosity:
 *     mu_slurry = mu_liquid * (1 - Phi_H / Phi_max)^(-2.5)
 * - Dynamic agglomeration, deposition, and pipeline plugging index.
 */

import { getHydrateFormationTemperatureK } from "./thermal-cooldown.js";

export const HYDRATE_DENSITY_KG_M3 = 915.0; // Typical structure II natural gas hydrate
export const HYDRATE_MOLAR_MASS_KG_MOL = 0.12; // Effective molar mass (gas + water cage)
export const MAX_PACKING_FRACTION = 0.45; // Close-packing limit Phi_max
export const INTRINSIC_GROWTH_CONST = 4.5e-5; // mol / (m^2 * s * K)
export const ACTIVATION_ENERGY_J_MOL = 78300.0; // E_a
export const GAS_CONSTANT = 8.314462; // R [J / (mol * K)]

export interface HydrateKineticsInput {
  pressurePa: number;
  temperatureK: number;
  waterVolumeFraction: number; // alpha_w [0.0 - 1.0]
  mixtureVelocity: number; // m/s (controls shear and droplet Sauter mean diameter)
  pipeDiameter: number; // m
  timeStepSeconds: number; // dt [s]
  currentHydrateFraction?: number | undefined; // Phi_H from previous timestep
  liquidViscosity?: number | undefined; // base liquid viscosity mu_0 [Pa * s] (default 0.002)
  inhibitorWeightFraction?: number | undefined; // e.g. 0.20 for 20 wt% MEG
}

export interface HydrateKineticsResult {
  /** Hydrate equilibrium dissociation temperature at pressure P [K]. */
  equilibriumTempK: number;
  /** Subcooling driving force DeltaT_sub = max(0, T_eq - T) [K]. */
  subcoolingK: number;
  /** Droplet surface area per unit liquid volume A_s [m^2 / m^3]. */
  interfacialAreaM2PerM3: number;
  /** Hydrate crystal growth rate [mol / (m^2 * s)]. */
  crystalGrowthRateMolPerM2S: number;
  /** Hydrate mass generation rate [kg / (m^3 * s)]. */
  massRateKgPerM3S: number;
  /** Hydrate solid volume fraction in liquid phase Phi_H [0.0 - 0.45]. */
  hydrateVolumeFraction: number;
  /** Hydrate slurry apparent viscosity mu_slurry [Pa * s]. */
  slurryViscosityPaS: number;
  /** Relative viscosity ratio mu_slurry / mu_0. */
  relativeViscosity: number;
  /** Whether hydrate crystals are actively nucleating and growing. */
  isForming: boolean;
  /** Dynamic pipeline plugging risk index [0.0 = safe, 1.0 = imminent plug]. */
  pluggingRiskIndex: number;
  /** Estimated time until slurry reaches close-packing lockup (seconds). */
  timeToBlockageSeconds: number | null;
}

/**
 * Calculates dynamic hydrate kinetics and slurry rheology.
 */
export function calculateHydrateKinetics(input: HydrateKineticsInput): HydrateKineticsResult {
  let teq = getHydrateFormationTemperatureK(input.pressurePa);

  // If thermodynamic inhibitor is present (e.g. MEG), depress equilibrium temperature
  if (input.inhibitorWeightFraction && input.inhibitorWeightFraction > 0) {
    const w = Math.min(60.0, input.inhibitorWeightFraction * 100);
    // Hammerschmidt: DeltaT = 1297 * w / (62.07 * (100 - w))
    const depression = (1297.0 * w) / (62.07 * (100.0 - w));
    teq -= depression;
  }

  const subcooling = Math.max(0.0, teq - input.temperatureK);
  const isForming = subcooling > 0.5 && input.waterVolumeFraction > 0.001;

  // Estimate water droplet Sauter mean diameter d32 based on Hinze / Hughmark Weber number
  const mu0 = input.liquidViscosity ?? 0.002;
  const vm = Math.max(0.2, Math.abs(input.mixtureVelocity));
  const rhoL = 850.0;
  const sigma = 0.025; // Interfacial tension N/m
  // We = rho * v^2 * D / sigma
  const weber = (rhoL * vm * vm * input.pipeDiameter) / sigma;
  const d32 = Math.max(20e-6, Math.min(2e-3, input.pipeDiameter * 0.06 * Math.pow(Math.max(10, weber), -0.6)));

  // Interfacial area per unit liquid volume: A_s = 6 * alpha_w / d32
  const as = Math.min(1e5, (6.0 * Math.max(1e-4, input.waterVolumeFraction)) / d32);

  let growthRate = 0.0;
  let massRate = 0.0;

  if (isForming) {
    // Englezos / CSMHYD rate equation
    const arrhenius = Math.exp(-ACTIVATION_ENERGY_J_MOL / (GAS_CONSTANT * Math.max(250.0, input.temperatureK)));
    growthRate = INTRINSIC_GROWTH_CONST * as * subcooling * arrhenius;
    massRate = growthRate * HYDRATE_MOLAR_MASS_KG_MOL;
  }

  // Integrate solid volume fraction
  const currentPhi = input.currentHydrateFraction ?? 0.0;
  const deltaPhi = (massRate * input.timeStepSeconds) / HYDRATE_DENSITY_KG_M3;
  // Maximum conversion limited by available water
  const maxAllowablePhi = Math.min(MAX_PACKING_FRACTION, input.waterVolumeFraction * 1.25);
  const newPhi = Math.min(maxAllowablePhi, Math.max(0.0, currentPhi + deltaPhi));

  // Camargo & Mills (1998) / Krieger-Dougherty slurry viscosity
  // mu_rel = (1 - Phi / Phi_max)^(-2.5)
  const phiRatio = Math.min(0.96, newPhi / MAX_PACKING_FRACTION);
  const relViscosity = Math.pow(1.0 - phiRatio, -2.5);
  const slurryViscosity = mu0 * relViscosity;

  // Plugging risk index: combination of solid volume fraction and subcooling
  // When Phi exceeds 0.25, particle jamming and agglomeration accelerate sharply
  const phiRisk = Math.min(1.0, Math.pow(newPhi / 0.35, 1.8));
  const subcoolingFactor = Math.min(1.0, subcooling / 10.0);
  const pluggingRiskIndex = Math.min(1.0, Math.max(0.0, phiRisk * 0.8 + subcoolingFactor * 0.2));

  // Time to blockage: estimate how long before Phi reaches 0.35 at current generation rate
  let timeToBlockageSeconds: number | null = null;
  if (isForming && massRate > 1e-7 && newPhi < 0.35) {
    const remainingVolFraction = 0.35 - newPhi;
    const rateOfVolFractionPerSec = massRate / HYDRATE_DENSITY_KG_M3;
    timeToBlockageSeconds = remainingVolFraction / rateOfVolFractionPerSec;
  }

  return {
    equilibriumTempK: teq,
    subcoolingK: subcooling,
    interfacialAreaM2PerM3: as,
    crystalGrowthRateMolPerM2S: growthRate,
    massRateKgPerM3S: massRate,
    hydrateVolumeFraction: newPhi,
    slurryViscosityPaS: slurryViscosity,
    relativeViscosity: relViscosity,
    isForming,
    pluggingRiskIndex,
    timeToBlockageSeconds,
  };
}
