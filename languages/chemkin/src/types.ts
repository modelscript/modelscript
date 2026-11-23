// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core AST / domain types for CHEMKIN gas-phase & surface chemical kinetics decks
 * (.inp, .ck, .therm).
 */

export interface ChemkinRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type ChemkinEnergyUnits = "CAL/MOLE" | "KCAL/MOLE" | "JOULES/MOLE" | "KJOULES/MOLE" | "KELVINS" | "EVOLTS";

export type ChemkinQuantityUnits = "MOLES" | "MOLECULES";

export interface ChemkinElement {
  name: string;
  atomicWeight?: number | undefined;
  range?: ChemkinRange | undefined;
}

export interface ChemkinSpecies {
  name: string;
  range?: ChemkinRange | undefined;
}

export type Nasa7Coeffs = [number, number, number, number, number, number, number];

export interface Nasa7ThermoRecord {
  species: string;
  phase: "G" | "S" | "L";
  composition: Record<string, number>;
  tLow: number;
  tMid: number;
  tHigh: number;
  /** High-temperature NASA-7 coefficients a1..a7 (T_mid <= T <= T_high). */
  highCoeffs: Nasa7Coeffs;
  /** Low-temperature NASA-7 coefficients a1..a7 (T_low <= T <= T_mid). */
  lowCoeffs: Nasa7Coeffs;
  range?: ChemkinRange | undefined;
}

export interface ArrheniusParams {
  A: number;
  b: number;
  Ea: number;
}

export interface TroeParams {
  a: number;
  T3: number;
  T1: number;
  T2?: number | undefined;
}

export interface SriParams {
  a: number;
  b: number;
  c: number;
  d?: number | undefined;
  e?: number | undefined;
}

export interface PlogEntry {
  pressureAtm: number;
  A: number;
  b: number;
  Ea: number;
}

export interface ChemkinSpeciesStoich {
  species: string;
  stoichiometry: number;
}

export interface ChemkinReaction {
  id: string;
  equation: string;
  reactants: ChemkinSpeciesStoich[];
  products: ChemkinSpeciesStoich[];
  reversible: boolean;
  /** True for three-body `+M` reactions. */
  thirdBody: boolean;
  /** True for pressure-dependent falloff `(+M)` or `(+SP)` reactions. */
  falloff: boolean;
  /** Specific collider species if written as `(+N2)` instead of `(+M)`. */
  thirdBodySpecies?: string | undefined;
  /** High-pressure (or elementary) Arrhenius parameters. */
  rate: ArrheniusParams;
  /** Low-pressure limit Arrhenius parameters (`LOW /A b Ea/`). */
  low?: ArrheniusParams | undefined;
  /** Troe falloff broadening parameters (`TROE /a T3 T1 [T2]/`). */
  troe?: TroeParams | undefined;
  /** SRI falloff broadening parameters (`SRI /a b c [d e]/`). */
  sri?: SriParams | undefined;
  /** Explicit reverse Arrhenius parameters (`REV /A b Ea/`). */
  rev?: ArrheniusParams | undefined;
  /** Pressure-dependent logarithmic interpolation entries (`PLOG /P A b Ea/`). */
  plog?: PlogEntry[] | undefined;
  /** Enhanced third-body collision efficiencies (`SP/val/`). */
  efficiencies: Record<string, number>;
  /** True if `DUPLICATE` or `DUP` auxiliary keyword was declared. */
  duplicate: boolean;
  range?: ChemkinRange | undefined;
}

export interface ChemkinDuplicateEntry {
  name: string;
  range?: ChemkinRange | undefined;
}

export interface ChemkinParseError {
  message: string;
  range?: ChemkinRange | undefined;
}

export interface ChemkinMechanism {
  name: string;
  elements: Map<string, ChemkinElement>;
  species: Map<string, ChemkinSpecies>;
  thermo: Map<string, Nasa7ThermoRecord>;
  defaultThermoTemps?: [number, number, number] | undefined;
  reactions: ChemkinReaction[];
  energyUnits: ChemkinEnergyUnits;
  quantityUnits: ChemkinQuantityUnits;
  duplicateElements: ChemkinDuplicateEntry[];
  duplicateSpecies: ChemkinDuplicateEntry[];
  parseErrors: ChemkinParseError[];
}

export interface ChemkinDocument {
  uri: string;
  source: string;
  mechanism: ChemkinMechanism;
}
