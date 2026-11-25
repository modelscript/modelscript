// SPDX-License-Identifier: AGPL-3.0-or-later

import { type DAEBuilder, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";

export const PRIMITIVE_BUILTIN_TYPES = new Set(["Real", "Integer", "Boolean", "String", "Clock"]);
export const NUMERIC_BUILTIN_TYPES = new Set(["Real", "Integer"]);
export const NON_REAL_BUILTIN_TYPES = new Set(["Integer", "Boolean", "String"]);
export const CLASS_SPEC_KEYWORDS = new Set([
  "package",
  "model",
  "block",
  "connector",
  "record",
  "type",
  "function",
  "class",
  "operator",
]);
export const BUILTIN_MODELICA_FUNCTIONS = new Set([
  "array",
  "assert",
  "cardinality",
  "reinit",
  "der",
  "pre",
  "size",
  "sum",
  "product",
  "min",
  "max",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "exp",
  "log",
  "log10",
  "sqrt",
  "abs",
  "sign",
  "ceil",
  "floor",
  "integer",
  "mod",
  "rem",
  "div",
  "ceil",
  "floor",
  "noEvent",
  "smooth",
  "sample",
  "initial",
  "terminal",
  "edge",
  "change",
  "delay",
  "spatialDistribution",
  "fill",
  "zeros",
  "ones",
  "identity",
  "diagonal",
  "linspace",
  "transpose",
  "cross",
  "skew",
  "outerProduct",
  "symmetric",
  "cat",
  "ndims",
  "scalar",
  "vector",
  "matrix",
  "String",
]);

export interface CompInfo {
  sym: SymbolEntry;
  ownerClassId: SymbolId;
  typeName: string;
  variability: string;
  causality: "" | "input" | "output";
  isProtected: boolean;
  isFinal: boolean;
  isFlow: boolean;
  isStream: boolean;
  isOuter: boolean;
  isReplaceable: boolean;
  isInput: boolean;
  ndims: number;
  cst: SyntaxNode | null;
}

export interface ModItem {
  name: string;
  text: string;
  node: SyntaxNode;
  nested: SyntaxNode | null;
  classModNode: SyntaxNode | null;
  isFinal: boolean;
  isRedeclare: boolean;
  isRedeclareClass: boolean;
  isClassAssignEq: boolean;
}

export interface ClassValidationContext {
  db: QueryDB;
  dae: DAEBuilder;
  classId: SymbolId;
  sym: SymbolEntry;
  classCst: SyntaxNode;
  isTopLevelRoot: boolean;
  spec: string;
  classPartial: boolean;
  children: SymbolEntry[];
  comps: Map<string, CompInfo>;
  isOldFrontend: boolean;
  visitedClasses: Set<SymbolId>;
  failedFunctionIds?: Set<SymbolId> | undefined;
  invalidInterfaceFunctionIds?: Set<SymbolId> | undefined;
  firstRedeclares: Map<string, SyntaxNode>;
  invalidOrConflictingImports: Set<string>;
  pushErrorOnce: (code: number, rule: string, message: string, node?: SyntaxNode | null) => void;
  recordRedeclare: (name: string, node: SyntaxNode) => void;
  validateSubtree: (targetClassId: SymbolId) => void;
}

export interface WalkCstState {
  emittedDelayError: boolean;
}
