// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core AST, type system, and IEEE 1164 value representations for `@modelscript/vhdl`.
 */

/** IEEE Std 1164 9-value logic state. */
export type StdLogic = "U" | "X" | "0" | "1" | "Z" | "W" | "L" | "H" | "-";

/** VHDL port mode / direction. */
export type VhdlPortDirection = "in" | "out" | "inout" | "buffer" | "linkage";

/** Source location span (1-indexed line/column, 0-indexed byte offsets). */
export interface VhdlSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

/** Range constraint such as `7 downto 0` or `0 to 3`. */
export interface VhdlRange {
  left: VhdlExpr;
  direction: "downto" | "to";
  right: VhdlExpr;
}

/** Type reference for ports, signals, variables, constants, and generics. */
export interface VhdlTypeRef {
  name: string;
  range?: VhdlRange | undefined;
  /** Resolved static bit width when statically determinable (1 for scalar std_logic/bit). */
  width?: number | undefined;
  /** Whether the type carries a resolution function (e.g. std_logic, std_logic_vector). */
  resolved?: boolean | undefined;
}

/** Expression AST nodes. */
export type VhdlExpr =
  | { kind: "ident"; name: string; span?: VhdlSpan | undefined }
  | { kind: "intLiteral"; value: number; raw: string; span?: VhdlSpan | undefined }
  | { kind: "realLiteral"; value: number; raw: string; span?: VhdlSpan | undefined }
  | { kind: "charLiteral"; value: string; span?: VhdlSpan | undefined }
  | { kind: "bitString"; value: string; base?: "B" | "O" | "X" | undefined; span?: VhdlSpan | undefined }
  | { kind: "stringLiteral"; value: string; span?: VhdlSpan | undefined }
  | { kind: "boolLiteral"; value: boolean; span?: VhdlSpan | undefined }
  | { kind: "unary"; op: "not" | "-" | "+" | "abs"; operand: VhdlExpr; span?: VhdlSpan | undefined }
  | {
      kind: "binary";
      op:
        | "and"
        | "or"
        | "nand"
        | "nor"
        | "xor"
        | "xnor"
        | "="
        | "/="
        | "<"
        | "<="
        | ">"
        | ">="
        | "+"
        | "-"
        | "&"
        | "*"
        | "/"
        | "mod"
        | "rem"
        | "**"
        | "sll"
        | "srl";
      left: VhdlExpr;
      right: VhdlExpr;
      span?: VhdlSpan | undefined;
    }
  | { kind: "index"; target: string; index: VhdlExpr; span?: VhdlSpan | undefined }
  | { kind: "slice"; target: string; range: VhdlRange; span?: VhdlSpan | undefined }
  | { kind: "attribute"; target: string; attr: string; span?: VhdlSpan | undefined }
  | { kind: "call"; name: string; args: VhdlExpr[]; span?: VhdlSpan | undefined }
  | { kind: "others"; value: VhdlExpr; span?: VhdlSpan | undefined }
  | {
      kind: "aggregate";
      elements: Array<{ choice?: string | undefined; value: VhdlExpr }>;
      span?: VhdlSpan | undefined;
    };

export interface VhdlGenericDecl {
  name: string;
  type: VhdlTypeRef;
  defaultValue?: VhdlExpr | undefined;
  span: VhdlSpan;
}

export interface VhdlPortDecl {
  name: string;
  direction: VhdlPortDirection;
  type: VhdlTypeRef;
  defaultValue?: VhdlExpr | undefined;
  span: VhdlSpan;
}

export interface VhdlSignalDecl {
  name: string;
  type: VhdlTypeRef;
  defaultValue?: VhdlExpr | undefined;
  span: VhdlSpan;
}

export interface VhdlVariableDecl {
  name: string;
  type: VhdlTypeRef;
  defaultValue?: VhdlExpr | undefined;
  span: VhdlSpan;
}

export interface VhdlConstantDecl {
  name: string;
  type: VhdlTypeRef;
  value: VhdlExpr;
  span: VhdlSpan;
}

export interface VhdlTypeDecl {
  name: string;
  kind: "enum" | "array" | "range" | "subtype";
  enumLiterals?: string[] | undefined;
  baseType?: VhdlTypeRef | undefined;
  span: VhdlSpan;
}

export interface VhdlComponentDecl {
  name: string;
  generics: VhdlGenericDecl[];
  ports: VhdlPortDecl[];
  span: VhdlSpan;
}

export interface VhdlTarget {
  name: string;
  index?: VhdlExpr | undefined;
  slice?: VhdlRange | undefined;
  span?: VhdlSpan | undefined;
}

/** Sequential statements inside processes or subprograms. */
export type VhdlSeqStmt =
  | {
      kind: "signalAssign";
      target: VhdlTarget;
      value: VhdlExpr;
      afterNs?: number | undefined;
      span: VhdlSpan;
    }
  | {
      kind: "varAssign";
      target: VhdlTarget;
      value: VhdlExpr;
      span: VhdlSpan;
    }
  | {
      kind: "if";
      condition: VhdlExpr;
      thenBranch: VhdlSeqStmt[];
      elsifs: Array<{ condition: VhdlExpr; body: VhdlSeqStmt[] }>;
      elseBranch?: VhdlSeqStmt[] | undefined;
      span: VhdlSpan;
    }
  | {
      kind: "case";
      expr: VhdlExpr;
      alternatives: Array<{ choices: string[]; body: VhdlSeqStmt[] }>;
      span: VhdlSpan;
    }
  | {
      kind: "forLoop";
      label?: string | undefined;
      iterator: string;
      range: VhdlRange;
      body: VhdlSeqStmt[];
      span: VhdlSpan;
    }
  | { kind: "wait"; sensitivity?: string[] | undefined; forNs?: number | undefined; span: VhdlSpan }
  | { kind: "null"; span: VhdlSpan };

/** Concurrent statements inside architecture body. */
export type VhdlConcStmt =
  | {
      kind: "process";
      label?: string | undefined;
      sensitivity: string[];
      variables: VhdlVariableDecl[];
      constants: VhdlConstantDecl[];
      body: VhdlSeqStmt[];
      span: VhdlSpan;
    }
  | {
      kind: "condSignalAssign";
      label?: string | undefined;
      target: VhdlTarget;
      branches: Array<{ value: VhdlExpr; condition?: VhdlExpr | undefined }>;
      span: VhdlSpan;
    }
  | {
      kind: "selectedSignalAssign";
      label?: string | undefined;
      selector: VhdlExpr;
      target: VhdlTarget;
      alternatives: Array<{ value: VhdlExpr; choice: string }>;
      span: VhdlSpan;
    }
  | {
      kind: "componentInst";
      label: string;
      componentName: string;
      genericMap: Array<{ formal?: string | undefined; actual: VhdlExpr }>;
      portMap: Array<{ formal?: string | undefined; actual: VhdlExpr }>;
      span: VhdlSpan;
    };

export interface VhdlLibraryClause {
  libraries: string[];
  span: VhdlSpan;
}

export interface VhdlUseClause {
  items: string[];
  span: VhdlSpan;
}

export interface VhdlEntity {
  name: string;
  endName?: string | undefined;
  generics: VhdlGenericDecl[];
  ports: VhdlPortDecl[];
  span: VhdlSpan;
}

export interface VhdlArchitecture {
  name: string;
  entityName: string;
  endName?: string | undefined;
  signals: VhdlSignalDecl[];
  constants: VhdlConstantDecl[];
  types: VhdlTypeDecl[];
  components: VhdlComponentDecl[];
  statements: VhdlConcStmt[];
  span: VhdlSpan;
}

export interface VhdlPackage {
  name: string;
  endName?: string | undefined;
  constants: VhdlConstantDecl[];
  types: VhdlTypeDecl[];
  components: VhdlComponentDecl[];
  span: VhdlSpan;
}

export interface VhdlPackageBody {
  name: string;
  endName?: string | undefined;
  constants: VhdlConstantDecl[];
  types: VhdlTypeDecl[];
  span: VhdlSpan;
}

export interface VhdlParseError {
  message: string;
  span: VhdlSpan;
}

/** Root parsed representation of a VHDL design file (.vhd / .vhdl). */
export interface VhdlDesignFile {
  libraries: VhdlLibraryClause[];
  uses: VhdlUseClause[];
  entities: VhdlEntity[];
  architectures: VhdlArchitecture[];
  packages: VhdlPackage[];
  packageBodies: VhdlPackageBody[];
  parseErrors: VhdlParseError[];
}
