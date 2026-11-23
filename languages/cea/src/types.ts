// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Core AST, Thermodynamic, and Solver Types for NASA CEA.
 */

export interface CeaSourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type CeaProblemType = "hp" | "tp" | "uv" | "tv" | "sp" | "sv" | "rocket" | "deton" | "shock";

export type CeaPressureUnit = "bar" | "atm" | "psia" | "mmhg" | "pa";

export type CeaTemperatureUnit = "k" | "c" | "r" | "f";

export type CeaReactantRole = "fuel" | "oxid" | "name";

export interface CeaProblemSection {
  caseName?: string | undefined;
  problemType?: CeaProblemType | undefined;
  rawProblemTypes: string[];
  unknownTokens: Array<{ token: string; line: number; column: number }>;
  equilibrium: boolean;
  frozen: boolean;
  iac?: boolean | undefined;
  fac?: boolean | undefined;
  pressures: number[];
  pressureUnit: CeaPressureUnit;
  pressuresBar: number[];
  temperatures: number[];
  temperatureUnit: CeaTemperatureUnit;
  temperaturesK: number[];
  ofRatios: number[];
  phiRatios: number[];
  piPeRatios: number[];
  supar: number[];
  subar: number[];
  mach: number[];
  u1: number[];
  tcEstK?: number | undefined;
  span?: CeaSourceSpan | undefined;
}

export interface CeaReactant {
  role: CeaReactantRole;
  name: string;
  wtPercent?: number | undefined;
  moles?: number | undefined;
  temperatureK?: number | undefined;
  enthalpyKjMol?: number | undefined;
  formula?: Record<string, number> | undefined;
  density?: number | undefined;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface CeaOutputOptions {
  siunits: boolean;
  calories: boolean;
  short: boolean;
  massf: boolean;
  molef: boolean;
  transport: boolean;
  trace?: number | undefined;
  plot: string[];
  span?: CeaSourceSpan | undefined;
}

export interface CeaParseDiagnostic {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface CeaDeck {
  name: string;
  hasProblem: boolean;
  hasReactants: boolean;
  hasEnd: boolean;
  problem: CeaProblemSection;
  reactants: CeaReactant[];
  only: string[];
  omit: string[];
  insert: string[];
  output: CeaOutputOptions;
  comments: Array<{ text: string; line: number }>;
  parseErrors: CeaParseDiagnostic[];
  rawText: string;
}

export interface Nasa7Polynomial {
  tLow: number;
  tMid: number;
  tHigh: number;
  /** Low-temperature coefficients [a1..a7] for [tLow, tMid] */
  low: readonly [number, number, number, number, number, number, number];
  /** High-temperature coefficients [a1..a7] for [tMid, tHigh] */
  high: readonly [number, number, number, number, number, number, number];
}

export interface CeaSpeciesData {
  name: string;
  aliases: string[];
  formula: Record<string, number>;
  molarMassKgMol: number;
  phase: "gas" | "condensed";
  /** Standard enthalpy of formation at 298.15 K [kJ/mol] */
  hf298KjMol: number;
  /** Optional liquid/cryogenic enthalpy of formation at normal boiling point [kJ/mol] */
  liquidHfKjMol?: number | undefined;
  /** Normal boiling point [K] for cryogenic propellants */
  normalBoilingK?: number | undefined;
  nasa7: Nasa7Polynomial;
  description: string;
  provenance: string;
}

export interface EquilibriumState {
  temperatureK: number;
  pressurePa: number;
  pressureBar: number;
  densityKgM3: number;
  molarMassKgMol: number;
  molarMassGMol: number;
  enthalpyJKg: number;
  internalEnergyJKg: number;
  entropyJKgK: number;
  gibbsJKg: number;
  cpJKgK: number;
  cvJKgK: number;
  gamma: number;
  sonicVelocityMS: number;
  totalMolesPerKg: number;
  moleFractions: Record<string, number>;
  massFractions: Record<string, number>;
  speciesMolesPerKg: Record<string, number>;
  elementMolesPerKg: Record<string, number>;
  elementResidualMax: number;
  converged: boolean;
  iterations: number;
}

export interface RocketStationResult {
  station: "chamber" | "throat" | "exit";
  state: EquilibriumState;
  areaRatio: number;
  mach: number;
  velocityMS: number;
  cStarMS: number;
  cf: number;
  cfVac: number;
  ispVacS: number;
  ispSlS: number;
}

export interface RocketPerformanceResult {
  mode: "equilibrium" | "frozen";
  ofRatio: number;
  phi: number;
  chamber: RocketStationResult;
  throat: RocketStationResult;
  exits: RocketStationResult[];
  cStarMS: number;
  ispVacS: number;
  ispSlS: number;
  cfVac: number;
  cf: number;
}

export interface DetonationResult {
  initialState: {
    temperatureK: number;
    pressurePa: number;
    densityKgM3: number;
    enthalpyJKg: number;
    molarMassGMol: number;
  };
  cjState: EquilibriumState;
  detonationVelocityMS: number;
  machCJ: number;
  pressureRatio: number;
  temperatureRatio: number;
  densityRatio: number;
  converged: boolean;
}

export interface CeaSolveResult {
  problemType: CeaProblemType;
  equilibrium?: EquilibriumState | undefined;
  rocket?: RocketPerformanceResult | undefined;
  detonation?: DetonationResult | undefined;
}
