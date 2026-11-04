// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/bngl — BioNetGen Rule-Based Modeling Language (BNGL) AST & Data Types.
 *
 * Supports structured molecule types with binding sites and internal phosphorylation/conformational
 * states, complex bond graphs, seed species, observables, reversible/irreversible reaction rules,
 * compartments, parameters, and network generation / simulation actions.
 */

export interface BnglRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface BnglSiteDef {
  name: string;
  allowedStates: string[];
  range?: BnglRange | undefined;
}

export interface BnglMoleculeType {
  name: string;
  sites: BnglSiteDef[];
  range?: BnglRange | undefined;
}

export interface BnglComponentState {
  name: string;
  state?: string | undefined; // e.g. 'U', 'P', or '?'
  bond?: string | undefined; // e.g. '1', '2', '+', '?', or undefined (unbound)
  range?: BnglRange | undefined;
}

export interface BnglMoleculeInstance {
  name: string;
  components: BnglComponentState[];
  compartment?: string | undefined;
  range?: BnglRange | undefined;
}

export interface BnglComplexPattern {
  molecules: BnglMoleculeInstance[];
  compartment?: string | undefined;
  stoichiometry?: number | undefined;
  isConstant?: boolean | undefined;
  raw?: string | undefined;
  range?: BnglRange | undefined;
}

export interface BnglParameter {
  id: string;
  value: number;
  expression?: string | undefined;
  range?: BnglRange | undefined;
}

export interface BnglCompartment {
  id: string;
  dimensions: number;
  size: number;
  parent?: string | undefined;
  range?: BnglRange | undefined;
}

export interface BnglFunction {
  id: string;
  arguments: string[];
  expression: string;
  range?: BnglRange | undefined;
}

export interface BnglSeedSpecies {
  id: string;
  pattern: BnglComplexPattern;
  initialConcentration: number;
  concentrationExpression?: string | undefined;
  constant: boolean;
  compartment?: string | undefined;
  range?: BnglRange | undefined;
}

export type BnglObservableType = "Molecules" | "Species";

export interface BnglObservable {
  name: string;
  type: BnglObservableType;
  patterns: BnglComplexPattern[];
  range?: BnglRange | undefined;
}

export interface BnglReactionRule {
  id: string;
  name?: string | undefined;
  reactants: BnglComplexPattern[];
  products: BnglComplexPattern[];
  reversible: boolean;
  forwardRate: string;
  reverseRate?: string | undefined;
  modifiers?: string[] | undefined;
  range?: BnglRange | undefined;
}

export interface BnglAction {
  command: string;
  args: Record<string, string | number | boolean>;
  range?: BnglRange | undefined;
}

export interface BnglModel {
  id: string;
  name?: string | undefined;
  parameters: Map<string, BnglParameter>;
  compartments: Map<string, BnglCompartment>;
  functions: Map<string, BnglFunction>;
  moleculeTypes: Map<string, BnglMoleculeType>;
  seedSpecies: BnglSeedSpecies[];
  observables: Map<string, BnglObservable>;
  observableList?: BnglObservable[] | undefined;
  reactionRules: Map<string, BnglReactionRule>;
  reactionRuleList?: BnglReactionRule[] | undefined;
  actions: BnglAction[];
  range?: BnglRange | undefined;
}

export interface BnglDocument {
  model: BnglModel;
  actions: BnglAction[];
  sourceFile?: string | undefined;
}
