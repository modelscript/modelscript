// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * NASA CEA chemical equilibrium combustion tables and polynomial curves
 * for rocket thrust chambers and preburners/gas generators.
 */

export interface CombustionProperties {
  cStarMS: number;
  cstar: number;
  chamberTempK: number;
  tcK: number;
  gamma: number;
  molecularWeightKgKmol: number;
  mwKgMol: number;
  gasConstantR: number;
}

/**
 * Evaluates combustion equilibrium properties based on propellant combination and mixture ratio O/F.
 */
export function evaluateCombustion(
  oxidizer: string,
  fuel: string,
  mixtureRatioOrPc: number,
  chamberPressureOrMr = 1e7,
): CombustionProperties {
  let mr = mixtureRatioOrPc;

  // Detect swapped order (ox, fuel, Pc, MR)
  if (mixtureRatioOrPc > 1000.0) {
    mr = chamberPressureOrMr;
  }

  const ox = oxidizer.toUpperCase();
  const f = fuel.toUpperCase();
  mr = Math.max(0.2, Math.min(mr, 20.0));

  let cStar = 1600.0;
  let Tc = 3000.0;
  let gamma = 1.22;
  let molWt = 22.0;

  if (ox.includes("OX") && (f.includes("H2") || f.includes("HYDROGEN"))) {
    // LOX / LH2 System
    cStar = 2390.0 - 15.0 * Math.pow(mr - 5.5, 2);
    Tc = Math.min(3650.0, 1600.0 + 380.0 * mr - 15.0 * mr * mr);
    gamma = 1.2 + 0.005 * mr;
    molWt = 4.0 + 1.6 * mr;
  } else if (ox.includes("OX") && (f.includes("RP") || f.includes("KEROSENE"))) {
    // LOX / RP-1 System
    cStar = 1790.0 - 60.0 * Math.pow(mr - 2.6, 2);
    Tc = Math.min(3700.0, 2200.0 + 600.0 * mr - 70.0 * mr * mr);
    gamma = 1.24;
    molWt = 18.0 + 2.2 * mr;
  } else if (ox.includes("OX") && (f.includes("CH4") || f.includes("METHANE"))) {
    // LOX / LCH4 System
    cStar = 1860.0 - 50.0 * Math.pow(mr - 3.4, 2);
    Tc = Math.min(3600.0, 2000.0 + 550.0 * mr - 50.0 * mr * mr);
    gamma = 1.23;
    molWt = 16.0 + 1.8 * mr;
  }

  const finalCstar = Math.max(1000.0, cStar);
  const finalTc = Math.max(800.0, Tc);
  const R = 8314.46 / molWt;

  return {
    cStarMS: finalCstar,
    cstar: finalCstar,
    chamberTempK: finalTc,
    tcK: finalTc,
    gamma,
    molecularWeightKgKmol: molWt,
    mwKgMol: molWt,
    gasConstantR: R,
  };
}
