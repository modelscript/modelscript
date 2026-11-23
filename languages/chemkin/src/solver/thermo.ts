// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeMolecularWeightGPerMol, getStdThermoRecord } from "../catalog/chemkin-std-schemas.js";
import type { ChemkinEnergyUnits, ChemkinMechanism, ChemkinQuantityUnits, Nasa7ThermoRecord } from "../types.js";

export const GAS_CONSTANT_R = 8.31446261815324; // J/(mol*K)
export const STANDARD_PRESSURE_PA = 101325.0; // Pa (1 atm)
export const AVOGADRO_NA = 6.02214076e23; // 1/mol

export interface Nasa7ThermoState {
  T: number;
  cpOverR: number;
  hOverRT: number;
  sOverR: number;
  /** Molar heat capacity at constant pressure [J/(mol*K)]. */
  cpMolar: number;
  /** Molar heat capacity at constant volume [J/(mol*K)]. */
  cvMolar: number;
  /** Molar enthalpy [J/mol]. */
  hMolar: number;
  /** Molar internal energy [J/mol]. */
  uMolar: number;
  /** Molar entropy at standard pressure [J/(mol*K)]. */
  sMolar: number;
  /** Molar Gibbs free energy at standard pressure [J/mol]. */
  gMolar: number;
}

/**
 * Evaluates NASA-7 14-coefficient ideal-gas thermodynamic properties at temperature `T` [K].
 */
export function evaluateNasa7(record: Nasa7ThermoRecord, T: number): Nasa7ThermoState {
  const tSafe = Math.max(1.0, T);
  const c = tSafe >= record.tMid ? record.highCoeffs : record.lowCoeffs;
  const t2 = tSafe * tSafe;
  const t3 = t2 * tSafe;
  const t4 = t3 * tSafe;

  const cpOverR = c[0] + c[1] * tSafe + c[2] * t2 + c[3] * t3 + c[4] * t4;
  const hOverRT =
    c[0] + (c[1] * tSafe) / 2.0 + (c[2] * t2) / 3.0 + (c[3] * t3) / 4.0 + (c[4] * t4) / 5.0 + c[5] / tSafe;
  const sOverR =
    c[0] * Math.log(tSafe) + c[1] * tSafe + (c[2] * t2) / 2.0 + (c[3] * t3) / 3.0 + (c[4] * t4) / 4.0 + c[6];

  const cpMolar = cpOverR * GAS_CONSTANT_R;
  const cvMolar = cpMolar - GAS_CONSTANT_R;
  const hMolar = hOverRT * GAS_CONSTANT_R * tSafe;
  const uMolar = hMolar - GAS_CONSTANT_R * tSafe;
  const sMolar = sOverR * GAS_CONSTANT_R;
  const gMolar = hMolar - tSafe * sMolar;

  return {
    T: tSafe,
    cpOverR,
    hOverRT,
    sOverR,
    cpMolar,
    cvMolar,
    hMolar,
    uMolar,
    sMolar,
    gMolar,
  };
}

/**
 * Converts activation energy `Ea` from CHEMKIN deck energy units into SI [J/mol].
 */
export function convertEaToJPerMol(Ea: number, units: ChemkinEnergyUnits): number {
  switch (units) {
    case "CAL/MOLE":
      return Ea * 4.184;
    case "KCAL/MOLE":
      return Ea * 4184.0;
    case "JOULES/MOLE":
      return Ea;
    case "KJOULES/MOLE":
      return Ea * 1000.0;
    case "KELVINS":
      return Ea * GAS_CONSTANT_R;
    case "EVOLTS":
      return Ea * 96485.33212;
  }
}

/**
 * Converts pre-exponential factor `A` from CHEMKIN CGS (`cm^3`, `mol`/`molecule`, `s`)
 * into SI (`m^3`, `mol`, `s`) for a reaction step of total order `order`.
 */
export function convertAToSI(A: number, order: number, quantityUnits: ChemkinQuantityUnits): number {
  const exp = order - 1;
  if (exp === 0) return A;
  let factor = Math.pow(1e-6, exp);
  if (quantityUnits === "MOLECULES") {
    factor *= Math.pow(AVOGADRO_NA, exp);
  }
  return A * factor;
}

/**
 * Resolves a species' NASA-7 thermo record from the mechanism or the cleanroom standard library.
 */
export function resolveSpeciesThermo(mech: ChemkinMechanism, speciesName: string): Nasa7ThermoRecord | undefined {
  const direct = mech.thermo.get(speciesName);
  if (direct) return direct;
  const upper = speciesName.toUpperCase();
  for (const [k, v] of mech.thermo) {
    if (k.toUpperCase() === upper) return v;
  }
  return getStdThermoRecord(speciesName);
}

/**
 * Computes a species' molecular weight in SI [kg/mol].
 */
export function resolveSpeciesMolecularWeightKgPerMol(mech: ChemkinMechanism, speciesName: string): number {
  const customWeights: Record<string, number> = {};
  for (const [name, el] of mech.elements) {
    if (el.atomicWeight !== undefined) {
      customWeights[name.toUpperCase()] = el.atomicWeight;
    }
  }
  const thermo = resolveSpeciesThermo(mech, speciesName);
  if (thermo && Object.keys(thermo.composition).length > 0) {
    const gPerMol = computeMolecularWeightGPerMol(thermo.composition, customWeights);
    if (gPerMol > 0) return gPerMol * 1e-3;
  }
  // Default fallback (e.g. generic synthetic species A, B in analytical kinetics tests)
  return 0.028; // 28 g/mol
}
