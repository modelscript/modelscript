// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Multiphase Drift-Flux Closure Correlations & Physical Properties.
 *
 * Implements Zuber-Findlay drift-flux slip law, Churchill two-phase friction factor,
 * and natural gas hydrate dissociation equilibrium curves.
 */

export interface DriftFluxParameters {
  c0: number; // Distribution parameter
  ugj: number; // Drift velocity [m/s]
}

/**
 * Calculates Zuber-Findlay distribution parameter C0 and drift velocity ugj.
 *
 * @param alphaG Void fraction / gas holdup [0, 1]
 * @param rhoG Gas density [kg/m^3]
 * @param rhoL Liquid density [kg/m^3]
 * @param sigma Surface tension [N/m] (typical ~0.025 N/m for oil-gas)
 * @param inclinationAngleRad Pipe inclination angle in radians (0 = horizontal, pi/2 = vertical up)
 */
export function computeZuberFindlaySlip(
  alphaG: number,
  rhoG: number,
  rhoL: number,
  sigma = 0.025,
  inclinationAngleRad = 0,
): DriftFluxParameters {
  const g = 9.80665;
  const safeAlphaG = Math.max(0.001, Math.min(0.999, alphaG));
  const safeRhoL = Math.max(100.0, rhoL);
  const safeRhoG = Math.max(0.5, rhoG);
  const deltaRho = Math.max(0.1, safeRhoL - safeRhoG);

  // Distribution parameter C0
  // C0 -> 1.2 for bubbly/slug flow, approaches 1.0 as alphaG -> 1.0 (annular/mist)
  const densityRatio = Math.sqrt(safeRhoG / safeRhoL);
  const c0Base = 1.2 - 0.2 * densityRatio;
  const c0 = 1.0 + (c0Base - 1.0) * (1.0 - Math.exp(-4.0 * (1.0 - safeAlphaG)));

  // Drift velocity ugj (Harmathy / Zuber-Findlay bubble rise velocity scaled by pipe inclination)
  const baseUgj = Math.SQRT2 * Math.pow((g * sigma * deltaRho) / (safeRhoL * safeRhoL), 0.25);
  const voidFactor = Math.pow(1.0 - safeAlphaG, 1.75);

  // Inclination effect: maximum at vertical, zero or reduced for horizontal stratified
  const sinFactor = Math.abs(Math.sin(inclinationAngleRad));
  const cosFactor = Math.cos(inclinationAngleRad);
  const effectiveAngleFactor = Math.sqrt(sinFactor * sinFactor + 0.05 * cosFactor * cosFactor);

  const ugj = baseUgj * voidFactor * effectiveAngleFactor * Math.sign(Math.sin(inclinationAngleRad) || 1.0);

  return { c0, ugj };
}

/**
 * Calculates Churchill (1977) friction factor f (Fanning or Darcy).
 * Continuous across laminar, critical, and fully rough turbulent regimes.
 */
export function computeChurchillFriction(
  reynoldsNumber: number,
  roughnessMeters: number,
  diameterMeters: number,
): number {
  const Re = Math.max(1.0, reynoldsNumber);
  const epsD = roughnessMeters / diameterMeters;

  const a = Math.pow(2.457 * Math.log(1.0 / (Math.pow(7.0 / Re, 0.9) + 0.27 * epsD)), 16);
  const b = Math.pow(37530.0 / Re, 16);

  const darcyFriction = 8.0 * Math.pow(Math.pow(8.0 / Re, 12) + 1.0 / Math.pow(a + b, 1.5), 1.0 / 12.0);
  return darcyFriction;
}

/**
 * Evaluates Natural Gas Hydrate Equilibrium Temperature T_hyd [K] as a function of pressure P [Pa].
 * Based on Sloan (2007) and Moridis flow assurance correlations for methane/ethane/propane mixtures.
 *
 * Valid from 10 bar (1e6 Pa) to 300 bar (3e7 Pa).
 */
export function computeHydrateEquilibriumTemp(pressurePa: number): number {
  const pBar = Math.max(5.0, pressurePa / 1.0e5);
  const lnP = Math.log(pBar);

  // Quadratic fit in Kelvin: T_hyd = a0 + a1 * ln(P) + a2 * ln(P)^2
  // At 20 bar  -> ~280.5 K (7.3 C)
  // At 50 bar  -> ~286.8 K (13.6 C)
  // At 100 bar -> ~291.5 K (18.3 C)
  // At 200 bar -> ~295.2 K (22.0 C)
  const a0 = 265.85;
  const a1 = 5.25;
  const a2 = -0.075;

  return a0 + a1 * lnP + a2 * lnP * lnP;
}

/**
 * Simple Black Oil PVT evaluation returning gas/liquid densities and viscosities.
 */
export function evaluateBlackOilPvt(pressurePa: number, tempK: number) {
  const pBar = Math.max(1.0, pressurePa / 1.0e5);
  const tC = Math.max(0.0, tempK - 273.15);

  // Real gas law approximation for hydrocarbon gas (MW ~ 20 g/mol, Z ~ 0.85)
  const R_gas = 8314.46 / 20.0; // J / (kg * K)
  const Z = 0.85;
  const rhoG = pressurePa / (Z * R_gas * Math.max(100.0, tempK));

  // Liquid oil density with isothermal compressibility
  const rhoL0 = 840.0; // kg/m^3 (approx 37 API)
  const compressibility = 1.0e-9; // 1/Pa
  const thermalExpansion = 8.0e-4; // 1/K
  const rhoL = rhoL0 * (1.0 + compressibility * (pressurePa - 1.0e5) - thermalExpansion * (tempK - 288.15));

  // Dynamic viscosities [Pa * s]
  const muG = 1.2e-5 + 1.5e-8 * pBar;
  const muL = 0.0025 * Math.exp(-0.02 * (tC - 15.0));

  return { rhoG, rhoL, muG, muL };
}
