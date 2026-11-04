// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Gas-Phase Chemical Kinetics & NASA-7 Thermochemistry AST & Data Types.
 *
 * Conforms to Cantera YAML (.yaml) and legacy CTI (.cti) chemical mechanism specifications.
 */

export interface CanteraRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface Nasa7Polynomial {
  model: "NASA7";
  Tmin: number;
  Tmid: number;
  Tmax: number;
  lowCoeffs: number[]; // 7 coefficients [a0..a6] for Tmin <= T <= Tmid
  highCoeffs: number[]; // 7 coefficients [a0..a6] for Tmid <= T <= Tmax
  range?: CanteraRange | undefined;
}

export interface CanteraSpecies {
  name: string;
  composition: Record<string, number>; // e.g. { H: 2, O: 1 }
  charge?: number | undefined; // explicit net electrical charge (or composition.E * -1)
  thermo?: Nasa7Polynomial | undefined;
  note?: string | undefined;
  range?: CanteraRange | undefined;
}

export interface ArrheniusRate {
  A: number; // pre-exponential factor
  b: number; // temperature exponent
  Ea: number; // activation energy [J/mol]
  range?: CanteraRange | undefined;
}

export interface TroeFalloff {
  A: number;
  T3: number;
  T1: number;
  T2?: number | undefined;
  range?: CanteraRange | undefined;
}

export interface CanteraSpeciesStoich {
  species: string;
  stoichiometry: number;
}

export type CanteraReactionType = "elementary" | "three-body" | "falloff" | "plog";

export interface CanteraReaction {
  id: string;
  equation: string;
  type: CanteraReactionType;
  reversible: boolean;
  reactants: CanteraSpeciesStoich[];
  products: CanteraSpeciesStoich[];
  rateConstant: ArrheniusRate;
  lowRateConstant?: ArrheniusRate | undefined;
  troe?: TroeFalloff | undefined;
  efficiencies?: Record<string, number> | undefined;
  duplicate?: boolean | undefined;
  orders?: Record<string, number> | undefined;
  range?: CanteraRange | undefined;
}

export interface CanteraPhaseState {
  T?: number | undefined; // K
  P?: number | undefined; // Pa
  X?: Record<string, number> | undefined; // mole fractions
  Y?: Record<string, number> | undefined; // mass fractions
}

export interface CanteraPhase {
  name: string;
  thermo: string; // e.g. "ideal-gas"
  kinetics?: string | undefined; // e.g. "gas"
  elements: string[];
  species: string[];
  state?: CanteraPhaseState | undefined;
  range?: CanteraRange | undefined;
}

export interface CanteraMechanism {
  name: string;
  description?: string | undefined;
  units?: Record<string, string> | undefined;
  phases: Map<string, CanteraPhase>;
  species: Map<string, CanteraSpecies>;
  reactions: CanteraReaction[];
  range?: CanteraRange | undefined;
}

export interface CanteraDocument {
  format: "yaml" | "cti";
  mechanism: CanteraMechanism;
  sourceFile?: string | undefined;
}
