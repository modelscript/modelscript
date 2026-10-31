// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Systems Biology Markup Language (SBML L2/L3) AST & Data Types.
 *
 * Conforms to SBML Level 2 and Level 3 Core specifications for biochemical reaction networks.
 */

export interface SbmlRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface SbmlCompartment {
  id: string;
  name?: string | undefined;
  spatialDimensions: number; // default 3
  size: number; // volume / area / length (default 1.0)
  units?: string | undefined;
  constant: boolean; // default true
  range?: SbmlRange | undefined;
}

export interface SbmlSpecies {
  id: string;
  name?: string | undefined;
  compartment: string;
  initialAmount?: number | undefined;
  initialConcentration?: number | undefined;
  substanceUnits?: string | undefined;
  hasOnlySubstanceUnits: boolean; // default false
  boundaryCondition: boolean; // default false (if true, amount is clamped)
  constant: boolean; // default false
  range?: SbmlRange | undefined;
}

export interface SbmlParameter {
  id: string;
  name?: string | undefined;
  value: number;
  units?: string | undefined;
  constant: boolean; // default true
  range?: SbmlRange | undefined;
}

export interface SbmlSpeciesReference {
  species: string;
  stoichiometry: number; // default 1.0
  constant: boolean; // default true
  range?: SbmlRange | undefined;
}

export interface SbmlKineticLaw {
  formula: string; // mathematical rate formula (e.g. "k1 * S1 * E")
  parameters: Map<string, SbmlParameter>; // local kinetic parameters
  range?: SbmlRange | undefined;
}

export interface SbmlReaction {
  id: string;
  name?: string | undefined;
  reversible: boolean; // default true
  fast: boolean; // default false
  compartment?: string | undefined;
  reactants: SbmlSpeciesReference[];
  products: SbmlSpeciesReference[];
  modifiers: SbmlSpeciesReference[];
  kineticLaw?: SbmlKineticLaw | undefined;
  range?: SbmlRange | undefined;
}

export interface SbmlFunctionDefinition {
  id: string;
  name?: string | undefined;
  arguments: string[];
  body: string;
  range?: SbmlRange | undefined;
}

export type SbmlRuleType = "assignment" | "rate" | "algebraic";

export interface SbmlRule {
  type: SbmlRuleType;
  variable: string;
  formula: string;
  range?: SbmlRange | undefined;
}

export interface SbmlEventAssignment {
  variable: string;
  formula: string;
  range?: SbmlRange | undefined;
}

export interface SbmlEvent {
  id?: string | undefined;
  name?: string | undefined;
  trigger: string;
  assignments: SbmlEventAssignment[];
  range?: SbmlRange | undefined;
}

export interface SbmlModel {
  id: string;
  name?: string | undefined;
  level: number;
  version: number;
  compartments: Map<string, SbmlCompartment>;
  species: Map<string, SbmlSpecies>;
  parameters: Map<string, SbmlParameter>;
  reactions: Map<string, SbmlReaction>;
  functionDefinitions?: Map<string, SbmlFunctionDefinition> | undefined;
  rules?: SbmlRule[] | undefined;
  events?: SbmlEvent[] | undefined;
  range?: SbmlRange | undefined;
}

export interface SbmlDocument {
  level: number;
  version: number;
  model: SbmlModel;
  sourceFile?: string | undefined;
}
