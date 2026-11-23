// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for ESL (European Space Agency Simulation Language, 1980s).
 */

export type EslDataType = "REAL" | "INTEGER" | "LOGICAL" | "CONSTANT";

export type EslBlockKind = "STUDY" | "MODEL" | "SUBMODEL" | "SEGMENT" | "PACKAGE";

export type EslSectionKind = "INITIAL" | "DYNAMIC" | "STEP" | "TERMINAL";

export interface EslSourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type EslBinaryOp =
  "+" | "-" | "*" | "/" | "**" | "^" | "=" | "==" | "/=" | "<>" | "!=" | "<" | "<=" | ">" | ">=" | "AND" | "OR";

export type EslUnaryOp = "+" | "-" | "NOT";

export type EslExpr =
  | { kind: "number"; value: number; span: EslSourceSpan }
  | { kind: "boolean"; value: boolean; span: EslSourceSpan }
  | { kind: "string"; value: string; span: EslSourceSpan }
  | { kind: "identifier"; name: string; span: EslSourceSpan }
  | { kind: "derivative"; target: string; order: number; span: EslSourceSpan }
  | { kind: "unary"; op: EslUnaryOp; operand: EslExpr; span: EslSourceSpan }
  | { kind: "binary"; op: EslBinaryOp; left: EslExpr; right: EslExpr; span: EslSourceSpan }
  | { kind: "call"; callee: string; args: EslExpr[]; span: EslSourceSpan }
  | { kind: "conditional"; condition: EslExpr; thenExpr: EslExpr; elseExpr: EslExpr; span: EslSourceSpan };

export type EslStatement =
  | {
      kind: "assign";
      target: string;
      isDerivative: boolean;
      derivativeOrder: number;
      operator: "=" | ":=";
      value: EslExpr;
      span: EslSourceSpan;
    }
  | {
      kind: "when";
      condition: EslExpr;
      body: EslStatement[];
      elseBody: EslStatement[];
      span: EslSourceSpan;
    }
  | {
      kind: "if";
      condition: EslExpr;
      thenBody: EslStatement[];
      elseBody: EslStatement[];
      span: EslSourceSpan;
    }
  | {
      kind: "submodel_call";
      callee: string;
      args: EslExpr[];
      span: EslSourceSpan;
    }
  | {
      kind: "terminate";
      condition: EslExpr;
      span: EslSourceSpan;
    }
  | {
      kind: "prepare" | "plot" | "print";
      variables: string[];
      span: EslSourceSpan;
    };

export interface EslDeclaration {
  name: string;
  dataType: EslDataType;
  isConstant: boolean;
  initialValue?: EslExpr | undefined;
  span: EslSourceSpan;
}

export interface EslParameter {
  name: string;
  direction?: "IN" | "OUT" | "INOUT" | undefined;
  dataType?: EslDataType | undefined;
  span: EslSourceSpan;
}

export interface EslBlock {
  kind: EslBlockKind;
  name: string;
  endName?: string | undefined;
  endKeyword?: string | undefined;
  hasEnd: boolean;
  parameters: EslParameter[];
  declarations: EslDeclaration[];
  initialStatements: EslStatement[];
  dynamicStatements: EslStatement[];
  stepStatements: EslStatement[];
  terminalStatements: EslStatement[];
  children: EslBlock[];
  span: EslSourceSpan;
}

export interface EslSyntaxError {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface EslProgram {
  name: string;
  blocks: EslBlock[];
  models: Map<string, EslBlock>;
  submodels: Map<string, EslBlock>;
  packages: Map<string, EslBlock>;
  segments: Map<string, EslBlock>;
  studies: EslBlock[];
  syntaxErrors: EslSyntaxError[];
  source: string;
}
