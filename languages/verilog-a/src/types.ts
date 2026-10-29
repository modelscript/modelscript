// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — Core AST & Type Definitions.
 *
 * Defines the strongly typed Abstract Syntax Tree for Verilog-A / Verilog-AMS (IEEE 1857).
 * Encapsulates modules, ports, disciplines, continuous analog blocks, contribution
 * statements (<+), branch access operators (V, I), and expression trees.
 */

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type PortDirection = "inout" | "input" | "output";

export interface VerilogAPort {
  name: string;
  direction: PortDirection;
  discipline?: string | undefined;
  sourceRange: SourceRange;
}

export interface VerilogADisciplineDecl {
  discipline: string;
  nodes: string[];
  sourceRange: SourceRange;
}

export interface VerilogAParameterRange {
  min?: number | undefined;
  max?: number | undefined;
  minInclusive: boolean;
  maxInclusive: boolean;
}

export interface VerilogAParameter {
  name: string;
  type: "real" | "integer" | "string";
  defaultValue: number | string;
  rangeSpec?: VerilogAParameterRange | undefined;
  description?: string | undefined;
  sourceRange: SourceRange;
}

export interface VerilogAVariable {
  name: string;
  type: "real" | "integer";
  initialValue?: number | undefined;
  sourceRange: SourceRange;
}

export type VerilogABranchNature = "V" | "I" | "Potential" | "Flow" | "Temp" | "Pwr" | "Phi" | "MMF" | "Omega" | "Tau";

export interface VerilogABranchAccess {
  nature: VerilogABranchNature;
  node1: string;
  node2?: string | undefined;
  sourceRange: SourceRange;
}

export type VerilogAExpr =
  | {
      kind: "number";
      value: number;
      raw: string;
      sourceRange: SourceRange;
    }
  | {
      kind: "identifier";
      name: string;
      sourceRange: SourceRange;
    }
  | {
      kind: "branch_access";
      nature: VerilogABranchNature;
      node1: string;
      node2?: string | undefined;
      sourceRange: SourceRange;
    }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/" | "^" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";
      left: VerilogAExpr;
      right: VerilogAExpr;
      sourceRange: SourceRange;
    }
  | {
      kind: "unary";
      op: "+" | "-" | "!";
      argument: VerilogAExpr;
      sourceRange: SourceRange;
    }
  | {
      kind: "call";
      func: string;
      args: VerilogAExpr[];
      sourceRange: SourceRange;
    };

export interface VerilogAContribution {
  kind: "contribution";
  lhs: VerilogABranchAccess;
  rhs: VerilogAExpr;
  sourceRange: SourceRange;
}

export interface VerilogAAssignment {
  kind: "assignment";
  variable: string;
  rhs: VerilogAExpr;
  sourceRange: SourceRange;
}

export interface VerilogAIf {
  kind: "if";
  condition: VerilogAExpr;
  thenBranch: VerilogAStatement[];
  elseBranch?: VerilogAStatement[] | undefined;
  sourceRange: SourceRange;
}

export interface VerilogABlock {
  kind: "block";
  statements: VerilogAStatement[];
  sourceRange: SourceRange;
}

export type VerilogAStatement = VerilogAContribution | VerilogAAssignment | VerilogAIf | VerilogABlock;

export interface VerilogAAnalogBlock {
  statements: VerilogAStatement[];
  sourceRange: SourceRange;
}

export interface VerilogAModule {
  name: string;
  ports: VerilogAPort[];
  disciplines: VerilogADisciplineDecl[];
  parameters: VerilogAParameter[];
  variables: VerilogAVariable[];
  internalNodes: string[];
  analogBlock?: VerilogAAnalogBlock | undefined;
  sourceRange: SourceRange;
}

export interface VerilogADiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: SourceRange;
  quickFix?:
    | {
        title: string;
        newText: string;
        range: SourceRange;
      }
    | undefined;
}

export interface VerilogADocument {
  uri?: string | undefined;
  modules: VerilogAModule[];
  includes: string[];
  sourceRange: SourceRange;
}
