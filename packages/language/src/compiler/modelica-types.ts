// SPDX-License-Identifier: AGPL-3.0-or-later

export enum ModelicaBinaryOperator {
  LOGICAL_OR = "or",
  LOGICAL_AND = "and",
  LESS_THAN = "<",
  LESS_THAN_OR_EQUAL = "<=",
  GREATER_THAN = ">",
  GREATER_THAN_OR_EQUAL = ">=",
  EQUALITY = "==",
  INEQUALITY = "<>",
  ADDITION = "+",
  SUBTRACTION = "-",
  ELEMENTWISE_ADDITION = ".+",
  ELEMENTWISE_SUBTRACTION = ".-",
  MULTIPLICATION = "*",
  DIVISION = "/",
  ELEMENTWISE_MULTIPLICATION = ".*",
  ELEMENTWISE_DIVISION = "./",
  EXPONENTIATION = "^",
  ELEMENTWISE_EXPONENTIATION = ".^",
}

export enum ModelicaCausality {
  INPUT = "input",
  OUTPUT = "output",
}

export enum ModelicaClassKind {
  BLOCK = "block",
  CLASS = "class",
  CONNECTOR = "connector",
  EXPANDABLE_CONNECTOR = "expandable connector",
  FUNCTION = "function",
  MODEL = "model",
  OPERATOR = "operator",
  OPTIMIZATION = "optimization",
  OPERATOR_FUNCTION = "operator function",
  OPERATOR_RECORD = "operator record",
  PACKAGE = "package",
  RECORD = "record",
  TYPE = "type",
}

export enum ModelicaFlow {
  FLOW = "flow",
  STREAM = "stream",
}

export enum ModelicaPurity {
  PURE = "pure",
  IMPURE = "impure",
}

export enum ModelicaUnaryOperator {
  ELEMENTWISE_UNARY_MINUS = ".-",
  ELEMENTWISE_UNARY_PLUS = ".+",
  LOGICAL_NEGATION = "not",
  UNARY_MINUS = "-",
  UNARY_PLUS = "+",
}

export enum ModelicaVariability {
  CONSTANT = "constant",
  DISCRETE = "discrete",
  PARAMETER = "parameter",
}

export enum ModelicaVisibility {
  PUBLIC = "public",
  PROTECTED = "protected",
}

// ── Structural Interfaces ──

export interface Diagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: { startPosition: { row: number; column: number }; endPosition: { row: number; column: number } } | null;
}

export interface IClassInstance {
  readonly instantiated: boolean;
  readonly instantiating: boolean;
  instantiate(): void;
  readonly name?: string | null;
  readonly hash?: string;
  readonly modification?: { expression?: any | null } | null;
  readonly abstractSyntaxNode?: unknown;
  readonly components: Iterable<IComponentInstance>;
  readonly classKind?: string;
  clone?(): IClassInstance;
}

export interface IComponentInstance {
  readonly name?: string | null;
  readonly instantiated: boolean;
  readonly instantiating: boolean;
  instantiate(): void;
  readonly classInstance?: IClassInstance | null;
  readonly modification?: { expression?: any | null } | null;
}

export interface IArrayClassInstance extends IClassInstance {
  readonly elements?: IClassInstance[];
  readonly shape: number[];
}

export interface IEnumerationClassInstance extends IClassInstance {
  readonly value: any;
}

export interface IPredefinedClassInstance extends IClassInstance {
  readonly expression: any;
}

export interface ClassHierarchyNode {
  name: string;
  kind?: string;
  description?: string | null;
  uri?: string;
  children: ClassHierarchyNode[];
}

export interface ComponentTreeNode {
  name: string;
  type?: string;
  typeName?: string;
  kind?: string;
  variability?: any;
  causality?: any;
  description?: string | null;
  children?: ComponentTreeNode[];
}

export interface TreeNodeInfo {
  name: string;
  id?: string;
  compositeName?: string;
  kind?: string;
  classKind?: string;
  hasChildren?: boolean;
  language?: string;
  description?: string | null;
  children?: TreeNodeInfo[];
}

export interface SourceLocation {
  filePath?: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}
