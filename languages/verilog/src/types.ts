// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core types for IEEE 1364 Verilog AST, 4-state logic, diagnostics, and simulation.
 */

export type LogicVal = "0" | "1" | "X" | "Z";

export interface SourceSpan {
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface BitRange {
  msb: number;
  lsb: number;
}

export type PortDirection = "input" | "output" | "inout";
export type NetKind = "wire" | "reg" | "integer" | "tri" | "parameter" | "localparam";

export interface VerilogPortDecl {
  name: string;
  direction: PortDirection;
  netKind?: NetKind | undefined;
  signed?: boolean | undefined;
  range?: BitRange | undefined;
  span: SourceSpan;
}

export interface VerilogNetDecl {
  name: string;
  kind: NetKind;
  signed?: boolean | undefined;
  range?: BitRange | undefined;
  arraySize?: BitRange | undefined;
  initialValue?: VerilogExpr | undefined;
  span: SourceSpan;
}

export interface VerilogParamDecl {
  name: string;
  isLocal: boolean;
  range?: BitRange | undefined;
  value: VerilogExpr;
  span: SourceSpan;
}

export type VerilogExpr =
  | {
      kind: "number";
      raw: string;
      width?: number | undefined;
      base?: "b" | "o" | "d" | "h" | undefined;
      signed?: boolean | undefined;
      digits: string;
      numericValue?: number | undefined;
      span: SourceSpan;
    }
  | {
      kind: "identifier";
      name: string;
      span: SourceSpan;
    }
  | {
      kind: "index";
      target: VerilogExpr;
      index: VerilogExpr;
      span: SourceSpan;
    }
  | {
      kind: "slice";
      target: VerilogExpr;
      msb: VerilogExpr;
      lsb: VerilogExpr;
      span: SourceSpan;
    }
  | {
      kind: "unary";
      op: "+" | "-" | "!" | "~" | "&" | "~&" | "|" | "~|" | "^" | "~^" | "^~";
      operand: VerilogExpr;
      span: SourceSpan;
    }
  | {
      kind: "binary";
      op:
        | "+"
        | "-"
        | "*"
        | "/"
        | "%"
        | "&"
        | "|"
        | "^"
        | "~^"
        | "^~"
        | "&&"
        | "||"
        | "=="
        | "!="
        | "==="
        | "!=="
        | "<"
        | "<="
        | ">"
        | ">="
        | "<<"
        | ">>"
        | "<<<"
        | ">>>";
      left: VerilogExpr;
      right: VerilogExpr;
      span: SourceSpan;
    }
  | {
      kind: "ternary";
      condition: VerilogExpr;
      consequent: VerilogExpr;
      alternate: VerilogExpr;
      span: SourceSpan;
    }
  | {
      kind: "concat";
      elements: VerilogExpr[];
      span: SourceSpan;
    }
  | {
      kind: "replicate";
      count: VerilogExpr;
      elements: VerilogExpr[];
      span: SourceSpan;
    };

export type SensitivityItem =
  | { kind: "wildcard" }
  | { kind: "posedge"; signal: string; span: SourceSpan }
  | { kind: "negedge"; signal: string; span: SourceSpan }
  | { kind: "signal"; signal: string; span: SourceSpan };

export type VerilogStmt =
  | {
      kind: "block";
      label?: string | undefined;
      statements: VerilogStmt[];
      span: SourceSpan;
    }
  | {
      kind: "blocking_assign";
      lhs: VerilogExpr;
      rhs: VerilogExpr;
      span: SourceSpan;
    }
  | {
      kind: "nonblocking_assign";
      lhs: VerilogExpr;
      rhs: VerilogExpr;
      span: SourceSpan;
    }
  | {
      kind: "if";
      condition: VerilogExpr;
      consequent: VerilogStmt;
      alternate?: VerilogStmt | undefined;
      span: SourceSpan;
    }
  | {
      kind: "case";
      variant: "case" | "casex" | "casez";
      expression: VerilogExpr;
      items: Array<{
        patterns: VerilogExpr[]; // empty for default
        isDefault: boolean;
        statement: VerilogStmt;
        span: SourceSpan;
      }>;
      span: SourceSpan;
    }
  | {
      kind: "empty";
      span: SourceSpan;
    };

export interface VerilogAssignItem {
  kind: "assign";
  lhs: VerilogExpr;
  rhs: VerilogExpr;
  delay?: number | undefined;
  span: SourceSpan;
}

export interface VerilogAlwaysItem {
  kind: "always";
  sensitivity: SensitivityItem[];
  body: VerilogStmt;
  span: SourceSpan;
}

export interface VerilogInitialItem {
  kind: "initial";
  body: VerilogStmt;
  span: SourceSpan;
}

export type VerilogGateType =
  "and" | "nand" | "or" | "nor" | "xor" | "xnor" | "buf" | "not" | "bufif0" | "bufif1" | "notif0" | "notif1";

export interface VerilogGateItem {
  kind: "gate";
  gateType: VerilogGateType;
  instanceName?: string | undefined;
  delay?: number | undefined;
  ports: VerilogExpr[];
  span: SourceSpan;
}

export interface VerilogPortConnection {
  portName?: string | undefined; // undefined for positional
  expr: VerilogExpr;
  span: SourceSpan;
}

export interface VerilogModuleInstItem {
  kind: "instantiation";
  moduleType: string;
  instanceName: string;
  paramOverrides: Array<{ name?: string | undefined; expr: VerilogExpr }>;
  connections: VerilogPortConnection[];
  span: SourceSpan;
}

export type VerilogModuleItem =
  VerilogAssignItem | VerilogAlwaysItem | VerilogInitialItem | VerilogGateItem | VerilogModuleInstItem;

export interface VerilogModule {
  name: string;
  portOrder: string[];
  ports: Map<string, VerilogPortDecl>;
  nets: Map<string, VerilogNetDecl>;
  parameters: Map<string, VerilogParamDecl>;
  items: VerilogModuleItem[];
  duplicateDecls: Array<{ name: string; kind: "port" | "net" | "parameter"; span: SourceSpan }>;
  span: SourceSpan;
}

export interface VerilogDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  moduleName?: string | undefined;
  symbolName?: string | undefined;
  line: number;
  column: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface VerilogDesign {
  modules: VerilogModule[];
  syntaxErrors: VerilogDiagnostic[];
  sourceText: string;
}
