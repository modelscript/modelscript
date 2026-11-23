// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Cleanroom NASA-7 Thermodynamic Species Database & Evaluator.
 *
 * Polynomial coefficients follow the public NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF
 * 7-coefficient parameterization:
 *   Cp°(T)/R   = a1 + a2*T + a3*T^2 + a4*T^3 + a5*T^4
 *   H°(T)/(RT) = a1 + (a2/2)*T + (a3/3)*T^2 + (a4/4)*T^3 + (a5/5)*T^4 + a6/T
 *   S°(T)/R    = a1*ln(T) + a2*T + (a3/2)*T^2 + (a4/3)*T^3 + (a5/4)*T^4 + a7
 *   G°(T)/(RT) = H°(T)/(RT) - S°(T)/R
 */

import { CEA_STD_SPECIES_DATA } from "../catalog/cea-std-schemas.js";
import type { CeaSpeciesData, Nasa7Polynomial } from "../types.js";

export const R_UNIVERSAL = 8.31446261815324; // J/(mol*K)
export const P_STD_PA = 101325.0; // Pa (1 atm reference for NASA-7 S°)
export const P_BAR_PA = 100000.0; // Pa (1 bar)
export const G0_STANDARD = 9.80665; // m/s^2

export const ATOMIC_WEIGHTS_KG_MOL: Record<string, number> = {
  H: 0.00100794,
  He: 0.004002602,
  C: 0.0120107,
  N: 0.0140067,
  O: 0.0159994,
  Ar: 0.039948,
};

export interface Nasa7EvalResult {
  cpOverR: number;
  hOverRT: number;
  sOverR: number;
  gOverRT: number;
  cpJMolK: number;
  hJMol: number;
  sJMolK: number;
  gJMol: number;
}

/**
 * Evaluates dimensionless and molar NASA-7 thermodynamic properties at temperature T [K].
 */
export function evalNasa7(poly: Nasa7Polynomial, temperatureK: number): Nasa7EvalResult {
  const T = Math.max(50.0, Math.min(20000.0, temperatureK));
  const c = T >= poly.tMid ? poly.high : poly.low;
  const [a1, a2, a3, a4, a5, a6, a7] = c;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  const cpOverR = a1 + a2 * T + a3 * T2 + a4 * T3 + a5 * T4;
  const hOverRT = a1 + (a2 * T) / 2 + (a3 * T2) / 3 + (a4 * T3) / 4 + (a5 * T4) / 5 + a6 / T;
  const sOverR = a1 * Math.log(T) + a2 * T + (a3 * T2) / 2 + (a4 * T3) / 3 + (a5 * T4) / 4 + a7;
  const gOverRT = hOverRT - sOverR;

  const RT = R_UNIVERSAL * T;
  return {
    cpOverR,
    hOverRT,
    sOverR,
    gOverRT,
    cpJMolK: cpOverR * R_UNIVERSAL,
    hJMol: hOverRT * RT,
    sJMolK: sOverR * R_UNIVERSAL,
    gJMol: gOverRT * RT,
  };
}

/**
 * Computes molar mass [kg/mol] from elemental stoichiometry.
 */
export function computeMolarMass(formula: Record<string, number>): number {
  let mw = 0;
  for (const [el, count] of Object.entries(formula)) {
    const aw = ATOMIC_WEIGHTS_KG_MOL[el] ?? 0;
    mw += aw * count;
  }
  return mw;
}

const EXTRA_COMBUSTION_SPECIES: readonly CeaSpeciesData[] = [
  {
    name: "HO2",
    aliases: [],
    formula: { H: 1, O: 2 },
    molarMassKgMol: 0.03300674,
    phase: "gas",
    hf298KjMol: 12.55,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [4.30179801, -4.74912051e-3, 2.11582891e-5, -2.42763894e-8, 9.29225124e-12, 294.80804, 3.71666245],
      high: [4.0172109, 2.23982013e-3, -6.3365815e-7, 1.1424637e-10, -1.07908535e-14, 111.856713, 3.78510215],
    },
    description: "Hydroperoxyl radical",
    provenance: "GRI-Mech 3.0 / NASA RP-1311",
  },
  {
    name: "N",
    aliases: ["ATOMIC_N"],
    formula: { N: 1 },
    molarMassKgMol: 0.0140067,
    phase: "gas",
    hf298KjMol: 472.68,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [2.5, 0, 0, 0, 0, 56104.637, 4.1939087],
      high: [2.4159429, 1.7489065e-4, -1.1902369e-7, 3.0226245e-11, -2.0360982e-15, 56133.773, 4.6496096],
    },
    description: "Atomic nitrogen radical",
    provenance: "GRI-Mech 3.0 / NASA RP-1311",
  },
  {
    name: "NO2",
    aliases: [],
    formula: { N: 1, O: 2 },
    molarMassKgMol: 0.0460055,
    phase: "gas",
    hf298KjMol: 33.1,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [3.9440312, -1.585429e-3, 1.6657812e-5, -2.0475426e-8, 7.8350564e-12, 2896.6179, 6.3119917],
      high: [4.8847542, 2.1723956e-3, -8.2806906e-7, 1.574751e-10, -1.0510895e-14, 2316.4983, -0.11741695],
    },
    description: "Nitrogen dioxide",
    provenance: "GRI-Mech 3.0 / NASA RP-1311",
  },
  {
    name: "NH3",
    aliases: ["AMMONIA"],
    formula: { N: 1, H: 3 },
    molarMassKgMol: 0.01703052,
    phase: "gas",
    hf298KjMol: -45.9,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [4.2860274, -4.660523e-3, 2.1718513e-5, -2.2808887e-8, 8.2638046e-12, -6741.7285, -0.62537277],
      high: [2.6344521, 5.666256e-3, -1.7278676e-6, 2.3867161e-10, -1.2578786e-14, -6544.6958, 6.5662928],
    },
    description: "Ammonia",
    provenance: "GRI-Mech 3.0 / NASA RP-1311",
  },
];

export const CEA_SPECIES_LIST: readonly CeaSpeciesData[] = [...CEA_STD_SPECIES_DATA, ...EXTRA_COMBUSTION_SPECIES];

export const CEA_STD_SPECIES_NAMES = [
  "H2",
  "O2",
  "H2O",
  "OH",
  "H",
  "O",
  "CH4",
  "CO",
  "CO2",
  "N2",
  "NO",
  "RP-1",
  "N2O4",
  "MMH",
  "UDMH",
  "He",
  "Ar",
] as const;

const speciesLookupMap = new Map<string, CeaSpeciesData>();
for (const sp of CEA_SPECIES_LIST) {
  speciesLookupMap.set(sp.name.toUpperCase(), sp);
  for (const alias of sp.aliases) {
    speciesLookupMap.set(alias.toUpperCase(), sp);
  }
}

/**
 * Case-insensitive lookup of a NASA CEA species by canonical name or alias (e.g. `H2(L)`, `LOX`, `RP-1`).
 */
export function lookupCeaSpecies(name: string): CeaSpeciesData | undefined {
  return speciesLookupMap.get(name.trim().toUpperCase());
}

/**
 * Computes reactant molar enthalpy [J/mol] at the given input temperature or explicit enthalpy override.
 */
export function computeReactantEnthalpyJMol(
  species: CeaSpeciesData,
  rawName: string,
  temperatureK?: number,
  explicitEnthalpyKjMol?: number,
): number {
  if (explicitEnthalpyKjMol !== undefined && Number.isFinite(explicitEnthalpyKjMol)) {
    return explicitEnthalpyKjMol * 1000.0;
  }
  const upper = rawName.trim().toUpperCase();
  const isExplicitLiquid =
    upper.endsWith("(L)") ||
    upper === "LOX" ||
    upper === "LH2" ||
    upper === "LCH4" ||
    upper === "RP-1" ||
    upper === "RP1";
  const T = temperatureK ?? 298.15;

  if (
    species.liquidHfKjMol !== undefined &&
    (isExplicitLiquid || (species.normalBoilingK !== undefined && T <= species.normalBoilingK + 15.0))
  ) {
    return species.liquidHfKjMol * 1000.0;
  }
  if (species.phase === "condensed") {
    const cp = species.nasa7.low[0] * R_UNIVERSAL;
    return species.hf298KjMol * 1000.0 + cp * (T - 298.15);
  }
  return evalNasa7(species.nasa7, T).hJMol;
}
