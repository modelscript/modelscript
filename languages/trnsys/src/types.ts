// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for TRNSYS (.dck) Transient System Simulation decks.
 */

export interface TrnsysParseError {
  message: string;
  line: number;
  column: number;
}

export interface TrnsysSimulationCard {
  tStart: number;
  tStop: number;
  dt: number;
  line: number;
}

export interface TrnsysTolerancesCard {
  integration: number;
  convergence: number;
  line: number;
}

export interface TrnsysLimitsCard {
  maxIterations: number;
  maxWarnings: number;
  traceLimit?: number | undefined;
  line: number;
}

export interface TrnsysAssignment {
  name: string;
  expression: string;
  value?: number | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface TrnsysEquationBlock {
  declaredCount: number;
  equations: TrnsysAssignment[];
  line: number;
}

export type TrnsysValue =
  { kind: "number"; value: number; raw: string } | { kind: "variable"; name: string; raw: string };

export type TrnsysInputConnection =
  | { kind: "connection"; unitNumber: number; outputIndex: number; raw: string; line: number }
  | { kind: "constant"; value: number; raw: string; line: number }
  | { kind: "variable"; name: string; raw: string; line: number };

export interface TrnsysUnit {
  unitNumber: number;
  typeNumber: number;
  label?: string | undefined;
  parametersDeclared?: number | undefined;
  parameters: TrnsysValue[];
  inputsDeclared?: number | undefined;
  inputs: TrnsysInputConnection[];
  initialInputs: TrnsysValue[];
  derivativesDeclared?: number | undefined;
  derivatives: TrnsysValue[];
  labels: string[];
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface TrnsysAssignCard {
  filename: string;
  logicalUnit: number;
  line: number;
}

export interface TrnsysDeck {
  name: string;
  version?: number | undefined;
  simulation?: TrnsysSimulationCard | undefined;
  tolerances?: TrnsysTolerancesCard | undefined;
  limits?: TrnsysLimitsCard | undefined;
  dfq?: number | undefined;
  width?: number | undefined;
  listMode?: "LIST" | "NOLIST" | undefined;
  map?: boolean | undefined;
  constants: TrnsysAssignment[];
  equationBlocks: TrnsysEquationBlock[];
  units: TrnsysUnit[];
  assigns: TrnsysAssignCard[];
  hasEnd: boolean;
  parseErrors: TrnsysParseError[];
}

export type TrnsysDiagnosticSeverity = "error" | "warning" | "info";

export interface TrnsysDiagnostic {
  code: string;
  rule: string;
  severity: TrnsysDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  unitNumber?: number | undefined;
}
