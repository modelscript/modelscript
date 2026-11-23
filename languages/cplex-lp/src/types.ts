// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for CPLEX LP and LINDO algebraic optimization models.
 */

export type ObjectiveSense = "minimize" | "maximize";

export type ConstraintSense = "<=" | ">=" | "=";

export type RawConstraintOperator = "<=" | "<" | ">=" | ">" | "=";

export type VariableDomain = "continuous" | "general" | "binary" | "semi-continuous";

export type SosType = "S1" | "S2";

export type LpDialect = "cplex-lp" | "lindo";

export interface SourceLocation {
  line: number; // 1-indexed
  column: number; // 1-indexed
  startOffset: number;
  endOffset: number;
}

export interface LinearTerm {
  coeff: number;
  variable: string;
  location?: SourceLocation | undefined;
}

export interface QuadraticTerm {
  /**
   * Raw coefficient inside the `[ ... ]` block BEFORE dividing by `divisor` (usually 2).
   * Effective objective contribution is `(coeff / divisor) * var1 * var2`.
   */
  coeff: number;
  var1: string;
  var2: string;
  location?: SourceLocation | undefined;
}

export interface QuadraticExpression {
  terms: QuadraticTerm[];
  /** Standard CPLEX LP divides quadratic block by 2 (`[ ... ] / 2`). */
  divisor: number;
}

export interface LpObjective {
  sense: ObjectiveSense;
  name?: string | undefined;
  linearTerms: LinearTerm[];
  quadratic?: QuadraticExpression | undefined;
  constant: number;
  location?: SourceLocation | undefined;
}

export interface LpConstraint {
  name: string;
  /** True when the constraint had an explicit `name:` label in source. */
  hasExplicitName: boolean;
  linearTerms: LinearTerm[];
  quadratic?: QuadraticExpression | undefined;
  operator: RawConstraintOperator;
  sense: ConstraintSense;
  rhs: number;
  location?: SourceLocation | undefined;
}

export interface LpVariableBound {
  variable: string;
  lower: number;
  upper: number;
  isFree: boolean;
  /** Explicit bound declarations recorded in source for diagnostic checking. */
  explicitLower?: number | undefined;
  explicitUpper?: number | undefined;
  explicitFree?: boolean | undefined;
  location?: SourceLocation | undefined;
}

export interface LpSosEntry {
  variable: string;
  weight: number;
  location?: SourceLocation | undefined;
}

export interface LpSosConstraint {
  name: string;
  type: SosType | string;
  entries: LpSosEntry[];
  location?: SourceLocation | undefined;
}

export interface LpParseError {
  message: string;
  location: SourceLocation;
}

export interface LpVariableInfo {
  name: string;
  domain: VariableDomain;
  lower: number;
  upper: number;
  isFree: boolean;
  /** True if the variable appeared in objective or constraints. */
  referencedInModel: boolean;
  firstLocation?: SourceLocation | undefined;
}

export interface CplexLpModel {
  name: string;
  dialect: LpDialect;
  objective?: LpObjective | undefined;
  constraints: LpConstraint[];
  bounds: Map<string, LpVariableBound>;
  generals: Set<string>;
  binaries: Set<string>;
  semiContinuous: Set<string>;
  sos: LpSosConstraint[];
  variables: Map<string, LpVariableInfo>;
  /** Ordered list of variable names in first-appearance order. */
  variableOrder: string[];
  hasEnd: boolean;
  parseErrors: LpParseError[];
  comments: string[];
}
