// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/phreeqc — Aqueous Speciation, Davies / Debye-Hückel Activity & Mineral Saturation Solver.
 *
 * Computes:
 *   1. Ionic strength: I = 0.5 * sum(m_i * z_i^2)
 *   2. Davies / Extended Debye-Hückel activity coefficients:
 *      log10(gamma_i) = -A(T) * z_i^2 * (sqrt(I) / (1 + sqrt(I)) - 0.3 * I)
 *   3. Carbonate equilibrium speciation: H2CO3*, HCO3-, CO3-2 (Van 't Hoff temperature-corrected K1, K2, Kw)
 *   4. Electroneutrality charge balance & optional pH / ion charge-balance adjustment
 *   5. Mineral Saturation Indices: SI = log10(IAP / Ksp) for Calcite, Aragonite, Gypsum, Anhydrite, Halite, Dolomite, Fluorite
 */

import type { MineralSaturationResult, PhreeqcDocument, PhreeqcSolution, SpeciationResult } from "../types.js";

export interface MasterSpeciesMetadata {
  canonicalElement: string;
  aqueousSpecies: string;
  charge: number;
  gfw: number; // Gram formula weight in g/mol
}

export const KNOWN_MASTER_SPECIES: ReadonlyMap<string, MasterSpeciesMetadata> = new Map<string, MasterSpeciesMetadata>([
  ["Ca", { canonicalElement: "Ca", aqueousSpecies: "Ca+2", charge: 2, gfw: 40.078 }],
  ["Ca+2", { canonicalElement: "Ca", aqueousSpecies: "Ca+2", charge: 2, gfw: 40.078 }],
  ["Mg", { canonicalElement: "Mg", aqueousSpecies: "Mg+2", charge: 2, gfw: 24.305 }],
  ["Mg+2", { canonicalElement: "Mg", aqueousSpecies: "Mg+2", charge: 2, gfw: 24.305 }],
  ["Na", { canonicalElement: "Na", aqueousSpecies: "Na+", charge: 1, gfw: 22.9898 }],
  ["Na+", { canonicalElement: "Na", aqueousSpecies: "Na+", charge: 1, gfw: 22.9898 }],
  ["K", { canonicalElement: "K", aqueousSpecies: "K+", charge: 1, gfw: 39.0983 }],
  ["K+", { canonicalElement: "K", aqueousSpecies: "K+", charge: 1, gfw: 39.0983 }],
  ["Li", { canonicalElement: "Li", aqueousSpecies: "Li+", charge: 1, gfw: 6.941 }],
  ["Sr", { canonicalElement: "Sr", aqueousSpecies: "Sr+2", charge: 2, gfw: 87.62 }],
  ["Ba", { canonicalElement: "Ba", aqueousSpecies: "Ba+2", charge: 2, gfw: 137.327 }],
  ["Fe", { canonicalElement: "Fe", aqueousSpecies: "Fe+2", charge: 2, gfw: 55.845 }],
  ["Fe(2)", { canonicalElement: "Fe(2)", aqueousSpecies: "Fe+2", charge: 2, gfw: 55.845 }],
  ["Fe(3)", { canonicalElement: "Fe(3)", aqueousSpecies: "Fe+3", charge: 3, gfw: 55.845 }],
  ["Mn", { canonicalElement: "Mn", aqueousSpecies: "Mn+2", charge: 2, gfw: 54.938 }],
  ["Mn(2)", { canonicalElement: "Mn(2)", aqueousSpecies: "Mn+2", charge: 2, gfw: 54.938 }],
  ["Al", { canonicalElement: "Al", aqueousSpecies: "Al+3", charge: 3, gfw: 26.9815 }],
  ["Zn", { canonicalElement: "Zn", aqueousSpecies: "Zn+2", charge: 2, gfw: 65.38 }],
  ["Cu", { canonicalElement: "Cu", aqueousSpecies: "Cu+2", charge: 2, gfw: 63.546 }],
  ["Cl", { canonicalElement: "Cl", aqueousSpecies: "Cl-", charge: -1, gfw: 35.453 }],
  ["Cl-", { canonicalElement: "Cl", aqueousSpecies: "Cl-", charge: -1, gfw: 35.453 }],
  ["Br", { canonicalElement: "Br", aqueousSpecies: "Br-", charge: -1, gfw: 79.904 }],
  ["F", { canonicalElement: "F", aqueousSpecies: "F-", charge: -1, gfw: 18.9984 }],
  ["F-", { canonicalElement: "F", aqueousSpecies: "F-", charge: -1, gfw: 18.9984 }],
  ["S", { canonicalElement: "S(6)", aqueousSpecies: "SO4-2", charge: -2, gfw: 96.0626 }],
  ["S(6)", { canonicalElement: "S(6)", aqueousSpecies: "SO4-2", charge: -2, gfw: 96.0626 }],
  ["SO4", { canonicalElement: "S(6)", aqueousSpecies: "SO4-2", charge: -2, gfw: 96.0626 }],
  ["SO4-2", { canonicalElement: "S(6)", aqueousSpecies: "SO4-2", charge: -2, gfw: 96.0626 }],
  ["S(-2)", { canonicalElement: "S(-2)", aqueousSpecies: "HS-", charge: -1, gfw: 33.073 }],
  ["C", { canonicalElement: "C(4)", aqueousSpecies: "HCO3-", charge: -1, gfw: 61.0168 }],
  ["C(4)", { canonicalElement: "C(4)", aqueousSpecies: "HCO3-", charge: -1, gfw: 61.0168 }],
  ["HCO3", { canonicalElement: "C(4)", aqueousSpecies: "HCO3-", charge: -1, gfw: 61.0168 }],
  ["Alkalinity", { canonicalElement: "Alkalinity", aqueousSpecies: "HCO3-", charge: -1, gfw: 50.043 }],
  ["N", { canonicalElement: "N(5)", aqueousSpecies: "NO3-", charge: -1, gfw: 62.0049 }],
  ["N(5)", { canonicalElement: "N(5)", aqueousSpecies: "NO3-", charge: -1, gfw: 62.0049 }],
  ["NO3", { canonicalElement: "N(5)", aqueousSpecies: "NO3-", charge: -1, gfw: 62.0049 }],
  ["N(-3)", { canonicalElement: "N(-3)", aqueousSpecies: "NH4+", charge: 1, gfw: 18.0385 }],
  ["P", { canonicalElement: "P", aqueousSpecies: "HPO4-2", charge: -2, gfw: 95.979 }],
  ["Si", { canonicalElement: "Si", aqueousSpecies: "H4SiO4", charge: 0, gfw: 60.0843 }],
  ["B", { canonicalElement: "B", aqueousSpecies: "H3BO3", charge: 0, gfw: 61.833 }],
  ["O(0)", { canonicalElement: "O(0)", aqueousSpecies: "O2", charge: 0, gfw: 31.9988 }],
  ["H(0)", { canonicalElement: "H(0)", aqueousSpecies: "H2", charge: 0, gfw: 2.0159 }],
]);

export interface MineralPhaseMetadata {
  name: string;
  formula: string;
  logKsp25: number; // log10(Ksp) at 25 °C (298.15 K)
  deltaHkJ: number; // Standard enthalpy of dissolution in kJ/mol
  ions: Array<{ species: string; stoich: number }>;
}

export const STANDARD_MINERAL_PHASES: ReadonlyMap<string, MineralPhaseMetadata> = new Map<string, MineralPhaseMetadata>(
  [
    [
      "Calcite",
      {
        name: "Calcite",
        formula: "CaCO3",
        logKsp25: -8.48,
        deltaHkJ: -9.61,
        ions: [
          { species: "Ca+2", stoich: 1 },
          { species: "CO3-2", stoich: 1 },
        ],
      },
    ],
    [
      "Aragonite",
      {
        name: "Aragonite",
        formula: "CaCO3",
        logKsp25: -8.336,
        deltaHkJ: -10.83,
        ions: [
          { species: "Ca+2", stoich: 1 },
          { species: "CO3-2", stoich: 1 },
        ],
      },
    ],
    [
      "Gypsum",
      {
        name: "Gypsum",
        formula: "CaSO4:2H2O",
        logKsp25: -4.58,
        deltaHkJ: -0.46,
        ions: [
          { species: "Ca+2", stoich: 1 },
          { species: "SO4-2", stoich: 1 },
        ],
      },
    ],
    [
      "Anhydrite",
      {
        name: "Anhydrite",
        formula: "CaSO4",
        logKsp25: -4.36,
        deltaHkJ: -17.61,
        ions: [
          { species: "Ca+2", stoich: 1 },
          { species: "SO4-2", stoich: 1 },
        ],
      },
    ],
    [
      "Halite",
      {
        name: "Halite",
        formula: "NaCl",
        logKsp25: 1.582,
        deltaHkJ: 3.84,
        ions: [
          { species: "Na+", stoich: 1 },
          { species: "Cl-", stoich: 1 },
        ],
      },
    ],
    [
      "Dolomite",
      {
        name: "Dolomite",
        formula: "CaMg(CO3)2",
        logKsp25: -17.09,
        deltaHkJ: -39.62,
        ions: [
          { species: "Ca+2", stoich: 1 },
          { species: "Mg+2", stoich: 1 },
          { species: "CO3-2", stoich: 2 },
        ],
      },
    ],
    [
      "Fluorite",
      {
        name: "Fluorite",
        formula: "CaF2",
        logKsp25: -10.6,
        deltaHkJ: 19.62,
        ions: [
          { species: "Ca+2", stoich: 1 },
          { species: "F-", stoich: 2 },
        ],
      },
    ],
  ],
);

export const KNOWN_EQUILIBRIUM_PHASE_NAMES = new Set<string>([
  ...STANDARD_MINERAL_PHASES.keys(),
  "Quartz",
  "Chalcedony",
  "SiO2(a)",
  "Barite",
  "Celestite",
  "Siderite",
  "Rhodochrosite",
  "Brucite",
  "Portlandite",
  "Sylvite",
  "Hematite",
  "Goethite",
  "Pyrite",
  "Gibbsite",
  "Kaolinite",
  "Hydroxyapatite",
  "CO2(g)",
  "O2(g)",
  "H2S(g)",
  "CH4(g)",
  "N2(g)",
]);

const GAS_CONSTANT_R = 8.314462618; // J/(mol*K)
const LN10 = Math.LN10;

/**
 * Computes Van 't Hoff temperature-adjusted log10(K) from 25 °C reference logK25 and deltaH (kJ/mol).
 */
export function computeTemperatureLogK(logK25: number, deltaHkJ: number, tempC: number): number {
  const tk = Math.max(273.15, tempC + 273.15);
  const tRef = 298.15;
  return logK25 - ((deltaHkJ * 1000.0) / (LN10 * GAS_CONSTANT_R)) * (1.0 / tk - 1.0 / tRef);
}

/**
 * Computes Debye-Hückel parameter A(T) as a function of temperature in °C.
 * At 25 °C, A = 0.5092 (kg/mol)^0.5.
 */
export function computeDebyeHuckelA(tempC: number): number {
  return 0.4913 + 0.000656 * tempC + 0.0000024 * tempC * tempC;
}

/**
 * Computes Davies activity coefficient log10(gamma_i):
 *   log10(gamma_i) = -A * z_i^2 * (sqrt(I) / (1 + sqrt(I)) - 0.3 * I)
 */
export function computeDaviesLogGamma(charge: number, ionicStrength: number, debyeA: number): number {
  if (charge === 0 || ionicStrength <= 0) return 0.0;
  const sqrtI = Math.sqrt(ionicStrength);
  return -debyeA * (charge * charge) * (sqrtI / (1.0 + sqrtI) - 0.3 * ionicStrength);
}

/**
 * Converts input concentration in solution units to molality (mol/kgw).
 */
export function convertToMolality(
  value: number,
  defaultUnits: string,
  meta: MasterSpeciesMetadata,
  overrideUnits?: string,
  overrideGfw?: number,
): number {
  const units = (overrideUnits ?? defaultUnits).toLowerCase();
  const gfw = overrideGfw ?? meta.gfw;

  if (units.startsWith("mol/")) {
    return value;
  }
  if (units.startsWith("mmol/")) {
    return value * 1.0e-3;
  }
  if (units.startsWith("umol/") || units.startsWith("ug/")) {
    return units.startsWith("umol/") ? value * 1.0e-6 : value / (gfw * 1.0e6);
  }
  if (units.startsWith("mg/") || units === "ppm") {
    return value / (gfw * 1000.0);
  }
  if (units.startsWith("g/")) {
    return value / gfw;
  }
  if (units === "meq/l" || units === "meq/kgw") {
    const absZ = Math.max(1, Math.abs(meta.charge));
    return (value * 1.0e-3) / absZ;
  }
  // Default fallback: mmol/kgw
  return value * 1.0e-3;
}

export interface SpeciationSolverOptions {
  solutionNumber?: number | undefined;
  adjustChargeBalance?: boolean | undefined;
  maxIterations?: number | undefined;
  tolerance?: number | undefined;
}

/**
 * Solves aqueous speciation, Davies activity coefficients, carbonate equilibria,
 * electrical charge balance, and mineral saturation indices for a PHREEQC solution or document.
 */
export function solvePhreeqcSpeciation(
  docOrSolution: PhreeqcDocument | PhreeqcSolution,
  options?: SpeciationSolverOptions,
): SpeciationResult {
  let solution: PhreeqcSolution;
  if ("solutions" in docOrSolution) {
    const solNum = options?.solutionNumber;
    if (solNum !== undefined && docOrSolution.solutions.has(solNum)) {
      solution = docOrSolution.solutions.get(solNum)!;
    } else {
      const first = docOrSolution.solutions.values().next().value;
      if (first) {
        solution = first;
      } else {
        solution = {
          number: 1,
          temp: 25.0,
          pH: 7.0,
          pe: 4.0,
          units: "mmol/kgw",
          waterMass: 1.0,
          solutes: new Map(),
        };
      }
    }
  } else {
    solution = docOrSolution;
  }

  const tempC = solution.temp;
  const debyeA = computeDebyeHuckelA(tempC);
  const maxIter = options?.maxIterations ?? 25;
  const tol = options?.tolerance ?? 1.0e-10;

  // Temperature-adjusted carbonate & water dissociation constants
  const logKw = computeTemperatureLogK(-14.0, 55.84, tempC);
  const logK1 = computeTemperatureLogK(-6.352, 9.15, tempC); // H2CO3* <-> H+ + HCO3-
  const logK2 = computeTemperatureLogK(-10.329, 14.9, tempC); // HCO3- <-> H+ + CO3-2
  const Kw = Math.pow(10, logKw);
  const K1 = Math.pow(10, logK1);
  const K2 = Math.pow(10, logK2);

  // Convert input solute concentrations to total element molalities (mol/kgw)
  const totalMolalities: Record<string, number> = {};
  const nonCarbonateSpeciesMolalities = new Map<string, { molality: number; charge: number }>();

  let totalCarbon = 0.0;
  let explicitAlkalinity: number | undefined;

  for (const [rawElem, rawVal] of solution.solutes) {
    const meta = KNOWN_MASTER_SPECIES.get(rawElem);
    const spec = solution.soluteSpecs?.get(rawElem);
    if (!meta) {
      totalMolalities[rawElem] = Math.max(0, rawVal * 1.0e-3);
      continue;
    }

    const molality = Math.max(0, convertToMolality(rawVal, solution.units, meta, spec?.units, spec?.gfw));
    totalMolalities[meta.canonicalElement] = (totalMolalities[meta.canonicalElement] ?? 0.0) + molality;

    if (meta.canonicalElement === "C(4)") {
      totalCarbon += molality;
    } else if (meta.canonicalElement === "Alkalinity") {
      explicitAlkalinity = molality;
    } else {
      const existing = nonCarbonateSpeciesMolalities.get(meta.aqueousSpecies);
      if (existing) {
        existing.molality += molality;
      } else {
        nonCarbonateSpeciesMolalities.set(meta.aqueousSpecies, {
          molality,
          charge: meta.charge,
        });
      }
    }
  }

  if (totalCarbon === 0.0 && explicitAlkalinity !== undefined && explicitAlkalinity > 0) {
    totalCarbon = explicitAlkalinity;
    totalMolalities["C(4)"] = totalCarbon;
  }

  // Inner function to evaluate speciation at a given pH
  const evaluateAtPh = (currentPh: number) => {
    const aH = Math.pow(10, -currentPh);
    let ionicStrength = 0.001;

    // Initial guess for ionic strength from non-carbonate ions + totalCarbon
    let initSum = 0.0;
    for (const entry of nonCarbonateSpeciesMolalities.values()) {
      initSum += entry.molality * entry.charge * entry.charge;
    }
    initSum += totalCarbon * 1.0;
    ionicStrength = Math.max(1.0e-7, 0.5 * initSum);

    let gamma1 = 1.0; // z = +/- 1
    let gamma2 = 1.0; // z = +/- 2
    let mH = aH;
    let mOH = Kw / aH;
    let mH2CO3 = 0.0;
    let mHCO3 = 0.0;
    let mCO3 = 0.0;

    for (let iter = 0; iter < maxIter; iter++) {
      const logGamma1 = computeDaviesLogGamma(1, ionicStrength, debyeA);
      const logGamma2 = computeDaviesLogGamma(2, ionicStrength, debyeA);
      gamma1 = Math.pow(10, logGamma1);
      gamma2 = Math.pow(10, logGamma2);

      mH = aH / gamma1;
      mOH = Kw / (aH * gamma1);

      if (totalCarbon > 0) {
        const term1 = K1 / (aH * gamma1);
        const term2 = (K1 * K2) / (aH * aH * gamma2);
        const denom = 1.0 + term1 + term2;
        mH2CO3 = totalCarbon / denom;
        mHCO3 = (totalCarbon * term1) / denom;
        mCO3 = (totalCarbon * term2) / denom;
      } else {
        mH2CO3 = 0.0;
        mHCO3 = 0.0;
        mCO3 = 0.0;
      }

      let sumMZ2 = mH * 1.0 + mOH * 1.0 + mHCO3 * 1.0 + mCO3 * 4.0;
      for (const entry of nonCarbonateSpeciesMolalities.values()) {
        sumMZ2 += entry.molality * entry.charge * entry.charge;
      }
      const nextI = 0.5 * sumMZ2;
      if (Math.abs(nextI - ionicStrength) < tol) {
        ionicStrength = nextI;
        break;
      }
      ionicStrength = nextI;
    }

    // Compute charge balance error: sum(z_i * m_i)
    let netCharge = mH - mOH - mHCO3 - 2.0 * mCO3;
    let absCharge = mH + mOH + mHCO3 + 2.0 * mCO3;
    for (const entry of nonCarbonateSpeciesMolalities.values()) {
      netCharge += entry.molality * entry.charge;
      absCharge += entry.molality * Math.abs(entry.charge);
    }

    return {
      pH: currentPh,
      ionicStrength,
      mH,
      mOH,
      mH2CO3,
      mHCO3,
      mCO3,
      netCharge,
      absCharge,
    };
  };

  let targetPh = solution.pH;
  const shouldAdjustPh =
    (options?.adjustChargeBalance ?? true) &&
    (solution.pHChargeBalance === true || solution.chargeBalanceElement === "pH");

  if (shouldAdjustPh) {
    // Bisection for electroneutrality on pH in [1.0, 13.0]
    let low = 1.0;
    let high = 13.0;
    let fLow = evaluateAtPh(low).netCharge; // positive at low pH (high H+)
    const fHigh = evaluateAtPh(high).netCharge; // negative at high pH (high OH-, CO3-2)
    if (fLow * fHigh <= 0) {
      for (let b = 0; b < 45; b++) {
        const mid = 0.5 * (low + high);
        const fMid = evaluateAtPh(mid).netCharge;
        if (Math.abs(fMid) < 1.0e-12) {
          targetPh = mid;
          break;
        }
        if (fLow * fMid <= 0) {
          high = mid;
        } else {
          low = mid;
          fLow = fMid;
        }
        targetPh = mid;
      }
    }
  }

  const state = evaluateAtPh(targetPh);

  // Assemble speciesMolalities, activityCoefficients, logActivityCoefficients, activities
  const speciesCharges = new Map<string, number>([
    ["H+", 1],
    ["OH-", -1],
    ["H2CO3", 0],
    ["HCO3-", -1],
    ["CO3-2", -2],
  ]);
  for (const [spName, entry] of nonCarbonateSpeciesMolalities) {
    speciesCharges.set(spName, entry.charge);
  }

  const speciesMolalities: Record<string, number> = {
    "H+": state.mH,
    "OH-": state.mOH,
    H2CO3: state.mH2CO3,
    "HCO3-": state.mHCO3,
    "CO3-2": state.mCO3,
  };
  for (const [spName, entry] of nonCarbonateSpeciesMolalities) {
    speciesMolalities[spName] = entry.molality;
  }

  const logActivityCoefficients: Record<string, number> = {};
  const activityCoefficients: Record<string, number> = {};
  const activities: Record<string, number> = {};

  for (const [spName, molality] of Object.entries(speciesMolalities)) {
    const z = speciesCharges.get(spName) ?? 0;
    const logGamma = computeDaviesLogGamma(z, state.ionicStrength, debyeA);
    const gamma = Math.pow(10, logGamma);
    logActivityCoefficients[spName] = logGamma;
    activityCoefficients[spName] = gamma;
    activities[spName] = molality * gamma;
  }

  // Evaluate Mineral Saturation Indices: SI = log10(IAP / Ksp)
  const saturationIndices: Record<string, MineralSaturationResult> = {};
  const mineralResults: MineralSaturationResult[] = [];

  for (const [, mineralMeta] of STANDARD_MINERAL_PHASES) {
    const logKsp = computeTemperatureLogK(mineralMeta.logKsp25, mineralMeta.deltaHkJ, tempC);
    const ksp = Math.pow(10, logKsp);

    let allPresent = true;
    let iap = 1.0;
    let logIAP = 0.0;

    for (const ion of mineralMeta.ions) {
      const act = activities[ion.species] ?? 0.0;
      if (act <= 0.0) {
        allPresent = false;
        iap = 0.0;
        logIAP = -99.0;
        break;
      }
      iap *= Math.pow(act, ion.stoich);
      logIAP += ion.stoich * Math.log10(act);
    }

    const si = allPresent ? logIAP - logKsp : -99.0 - logKsp;
    let satState: "supersaturated" | "undersaturated" | "equilibrium" = "equilibrium";
    if (si > 1.0e-3) satState = "supersaturated";
    else if (si < -1.0e-3) satState = "undersaturated";

    const res: MineralSaturationResult = {
      mineral: mineralMeta.name,
      formula: mineralMeta.formula,
      logKsp,
      logIAP,
      iap,
      ksp,
      si,
      state: satState,
    };
    saturationIndices[mineralMeta.name] = res;
    if (allPresent) {
      mineralResults.push(res);
    }
  }

  const percentChargeError = state.absCharge > 0 ? (100.0 * state.netCharge) / state.absCharge : 0.0;

  return {
    solutionNumber: solution.number,
    temperatureC: tempC,
    pH: state.pH,
    pe: solution.pe,
    ionicStrength: state.ionicStrength,
    debyeHuckelA: debyeA,
    chargeBalanceError: state.netCharge,
    percentChargeError,
    totalMolalities,
    speciesMolalities,
    activityCoefficients,
    logActivityCoefficients,
    activities,
    carbonateSpeciation: {
      totalCarbon,
      h2co3: state.mH2CO3,
      hco3: state.mHCO3,
      co3: state.mCO3,
      alkalinity: state.mHCO3 + 2.0 * state.mCO3 + state.mOH - state.mH,
    },
    saturationIndices,
    mineralResults,
  };
}
