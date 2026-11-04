// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/antimony — Antimony Modular Reaction Network & Pathway AST & Data Types.
 *
 * Supports modular biochemical reaction networks, compartments, boundary/floating species,
 * stoichiometric reactions, rate/assignment rules, state-triggered events, and submodels.
 */

export interface AntimonyRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface AntimonyCompartment {
  id: string;
  name?: string | undefined;
  size: number; // volume (default 1.0)
  units?: string | undefined;
  constant: boolean; // default true
  range?: AntimonyRange | undefined;
}

export interface AntimonySpecies {
  id: string;
  name?: string | undefined;
  compartment: string;
  initialConcentration?: number | undefined;
  initialAmount?: number | undefined;
  units?: string | undefined;
  hasOnlySubstanceUnits: boolean; // default false
  boundaryCondition: boolean; // true if prefixed with '$'
  constant: boolean; // true if declared 'const'
  isExplicitlyConst?: boolean | undefined;
  range?: AntimonyRange | undefined;
}

export interface AntimonyParameter {
  id: string;
  name?: string | undefined;
  value: number;
  formula?: string | undefined;
  units?: string | undefined;
  constant: boolean; // default true for 'const', false for 'var'/'formula'
  isExplicitlyConst?: boolean | undefined;
  range?: AntimonyRange | undefined;
}

export interface AntimonySpeciesReference {
  species: string;
  stoichiometry: number; // default 1.0
  boundaryCondition?: boolean | undefined;
  range?: AntimonyRange | undefined;
}

export interface AntimonyReaction {
  id: string;
  name?: string | undefined;
  reversible: boolean; // true for '->' or '<->', false for '=>'
  compartment?: string | undefined;
  reactants: AntimonySpeciesReference[];
  products: AntimonySpeciesReference[];
  modifiers: AntimonySpeciesReference[];
  rateLaw: string;
  range?: AntimonyRange | undefined;
}

export type AntimonyRuleType = "assignment" | "rate" | "initial";

export interface AntimonyRule {
  type: AntimonyRuleType;
  variable: string;
  formula: string;
  range?: AntimonyRange | undefined;
}

export interface AntimonyAssignmentRule extends AntimonyRule {
  type: "assignment";
}

export interface AntimonyRateRule extends AntimonyRule {
  type: "rate";
}

export interface AntimonyEventAssignment {
  variable: string;
  formula: string;
  range?: AntimonyRange | undefined;
}

export interface AntimonyEvent {
  id: string;
  name?: string | undefined;
  trigger: string;
  delay?: string | undefined;
  assignments: AntimonyEventAssignment[];
  range?: AntimonyRange | undefined;
}

export interface AntimonyDeletion {
  target: string;
  range?: AntimonyRange | undefined;
}

export interface AntimonySubmodel {
  id: string;
  moduleName: string;
  arguments: string[];
  deletions?: string[] | undefined;
  range?: AntimonyRange | undefined;
}

export interface AntimonyFunctionDefinition {
  id: string;
  name?: string | undefined;
  arguments: string[];
  body: string;
  range?: AntimonyRange | undefined;
}

export interface AntimonyModule {
  id: string;
  name?: string | undefined;
  arguments: string[];
  compartments: Map<string, AntimonyCompartment>;
  species: Map<string, AntimonySpecies>;
  parameters: Map<string, AntimonyParameter>;
  reactions: Map<string, AntimonyReaction>;
  reactionList?: AntimonyReaction[] | undefined;
  rules: AntimonyRule[];
  events: AntimonyEvent[];
  submodels: AntimonySubmodel[];
  deletions?: AntimonyDeletion[] | undefined;
  displayNames?: Map<string, string> | undefined;
  range?: AntimonyRange | undefined;
}

export interface AntimonyDocument {
  mainModule: AntimonyModule;
  modules: Map<string, AntimonyModule>;
  functions: Map<string, AntimonyFunctionDefinition>;
  sourceFile?: string | undefined;
}
