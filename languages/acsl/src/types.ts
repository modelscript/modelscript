// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Data-oriented IR and linear CST types for ACSL (Advanced Continuous Simulation Language, 1975).
 */

export type AcslSectionKind = "PROGRAM" | "INITIAL" | "DYNAMIC" | "DERIVATIVE" | "DISCRETE" | "TERMINAL";

export type AcslVarKind = "REAL" | "INTEGER" | "LOGICAL" | "CONSTANT" | "ARRAY";

export interface AcslSpan {
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
}

export type AcslExpr =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "ident"; name: string }
  | { kind: "unary"; op: "+" | "-" | ".NOT."; operand: AcslExpr }
  | {
      kind: "binary";
      op:
        | "+"
        | "-"
        | "*"
        | "/"
        | "**"
        | ".EQ."
        | ".NE."
        | ".LT."
        | ".LE."
        | ".GT."
        | ".GE."
        | ".AND."
        | ".OR."
        | "=="
        | "/="
        | "<"
        | "<="
        | ">"
        | ">=";
      left: AcslExpr;
      right: AcslExpr;
    }
  | { kind: "call"; callee: string; args: AcslExpr[] };

export interface AcslDeclaration extends AcslSpan {
  kind: AcslVarKind;
  name: string;
  initialValue?: AcslExpr | undefined;
  arrayDimensions?: number[] | undefined;
  arrayValues?: number[] | undefined;
  section: AcslSectionKind;
}

export interface AcslAssignment extends AcslSpan {
  target: string;
  indexExpr?: AcslExpr | undefined;
  expr: AcslExpr;
  section: AcslSectionKind;
  blockName?: string | undefined;
  procedural?: boolean | undefined;
}

export interface AcslIntegratorSpec extends AcslSpan {
  stateVar: string;
  derivativeExpr: AcslExpr;
  initialCondExpr?: AcslExpr | undefined;
  operator: "INTEG" | "LIMINT";
  lowerBoundExpr?: AcslExpr | undefined;
  upperBoundExpr?: AcslExpr | undefined;
  section: AcslSectionKind;
}

export interface AcslScheduleStmt extends AcslSpan {
  targetDiscrete: string;
  triggerKind: "AT" | "XZ" | "XP" | "XN";
  expr: AcslExpr;
  section: AcslSectionKind;
}

export interface AcslTermtStmt extends AcslSpan {
  condition: AcslExpr;
  message?: string | undefined;
  section: AcslSectionKind;
}

export interface AcslProceduralBlock extends AcslSpan {
  outputs: string[];
  inputs: string[];
  assignments: AcslAssignment[];
  section: AcslSectionKind;
}

export interface AcslTableDef extends AcslSpan {
  name: string;
  dimensions: number;
  breakpoints: number[];
  values: number[];
  section: AcslSectionKind;
}

export interface AcslMacroDef extends AcslSpan {
  name: string;
  params: string[];
  body: string[];
}

export interface AcslDiscreteBlock extends AcslSpan {
  name: string;
  intervalVar?: string | undefined;
  intervalExpr?: AcslExpr | undefined;
  assignments: AcslAssignment[];
  schedules: AcslScheduleStmt[];
}

export interface AcslSectionRecord extends AcslSpan {
  kind: AcslSectionKind;
  name?: string | undefined;
  parentKind?: AcslSectionKind | undefined;
  closed: boolean;
}

export interface AcslParseError extends AcslSpan {
  code: "ACSL1001" | "ACSL1002";
  message: string;
}

export interface AcslProgram {
  name: string;
  source: string;
  sections: AcslSectionRecord[];
  declarations: AcslDeclaration[];
  assignments: AcslAssignment[];
  integrators: AcslIntegratorSpec[];
  discreteBlocks: AcslDiscreteBlock[];
  schedules: AcslScheduleStmt[];
  procedurals: AcslProceduralBlock[];
  tables: AcslTableDef[];
  macros: AcslMacroDef[];
  termts: AcslTermtStmt[];
  cinterval?: { name: string; expr: AcslExpr; span: AcslSpan } | undefined;
  maxterval?: { name: string; expr: AcslExpr; span: AcslSpan } | undefined;
  algorithm?: { code: number; span: AcslSpan } | undefined;
  derivt?: { name: string; span: AcslSpan } | undefined;
  parseErrors: AcslParseError[];
}
