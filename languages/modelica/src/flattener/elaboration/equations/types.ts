// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder, EqKind, QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";
import type { SyntaxNode } from "../../../../src-gen/bindings.js";
import type { ModelicaFlattener } from "../../class-flattener.js";
import type { ComponentModArgData, FlattenOptions, ParentModsLike } from "../../types.js";

export interface EquationCstNode extends SyntaxNode {
  isTerminal?: boolean;
  _cachedEqAlgSections?: EquationCstNode[];
  _cachedShortSpec?: EquationCstNode | null;
  _classAsCompId?: SymbolId;
  _classAsComp?: { name: string; node: EquationCstNode } | null;
  _eqStaticMeta?: { diffVal: unknown; description: string };
}

export interface SymbolMetaLike {
  classKind?: string;
  classPrefixes?: string;
  typeSpecifier?: string;
  type_specifier?: string;
  isPredefined?: boolean;
  isEnum?: boolean;
  isProtected?: boolean;
  flowPrefix?: string;
}

export interface ModArgLike extends ComponentModArgData {
  isRedeclaration?: boolean;
}

export interface EffectiveModLike {
  args?: ModArgLike[];
}

export interface EquationParentMods extends ParentModsLike {
  args?: ModArgLike[] | undefined;
  specializedPkgInstPrefix?: string | undefined;
}

export type NameResolverFn = (name: string) => SymbolEntry | null | undefined;
export type NameOrIdResolverFn = (name: string) => SymbolEntry | SymbolId | null | undefined;

export interface LoweredBodyEquation {
  kind: EqKind;
  lhsExprId: number;
  rhsExprId: number;
  bodyEquations?: LoweredBodyEquation[];
  thenEquations?: LoweredBodyEquation[];
  elseIfClauses?: {
    conditionExprId: number;
    bodyEquations: LoweredBodyEquation[];
    equations: { kind: EqKind; lhs: number; rhs: number }[];
  }[];
  elseEquations?: LoweredBodyEquation[];
}

export interface DiffusionAnnotationVal {
  coefficient?: unknown;
  value?: unknown;
}

export type DaeWithConnectorCache = DAEBuilder & {
  _expandConnectorRefCache?: Map<string, string[]>;
};

export type FlattenOptionsWithNonStd = FlattenOptions & {
  allowNonStandardModelica?: string | string[];
};

export interface BreakContext {
  brokenComponents: Set<string>;
  brokenConnections: Set<string>;
}

export type WalkEquationFn = (
  node: EquationCstNode | null | undefined,
  substitutions?: Map<string, number | string>,
  isInitial?: boolean,
) => void;

export interface EquationWalkContext {
  flattener: ModelicaFlattener;
  db: QueryDB;
  classId: SymbolId;
  classEntry: SymbolEntry | null | undefined;
  prefix: string;
  dae: DAEBuilder;
  curBreakContext: BreakContext;
  parentMods: EquationParentMods | undefined;
  cst: EquationCstNode;
  walk: WalkEquationFn;
}

export type ExtractClassEquationsFn = (
  flattener: ModelicaFlattener,
  classId: SymbolId,
  prefix: string,
  dae: DAEBuilder,
  breakContext?: BreakContext,
  parentMods?: EquationParentMods,
  visitedClasses?: Set<SymbolId>,
) => void;
