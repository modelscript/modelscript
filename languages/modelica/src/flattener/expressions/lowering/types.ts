// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder, DaeDiagnosticRange, QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";
import type { SyntaxNode } from "../../../../src-gen/bindings.js";
import type { FlatteningState } from "../../support/state.js";
import type { ComponentModArgData, FlattenerCstNode, FlattenerHostLike, LoweringContext } from "../../types.js";

export interface LowerExprFn {
  (node: SyntaxNode | null | undefined, dae: DAEBuilder, ctx: LoweringContext): number;
  (
    node: SyntaxNode | null | undefined,
    dae: DAEBuilder,
    prefix?: string,
    substitutions?: Map<string, number | string>,
    imports?: Map<string, string>,
    db?: QueryDB,
    flattener?: FlattenerHostLike,
    tupleContext?: boolean,
    noArrayExpand?: boolean,
    isAssignmentLhs?: boolean,
  ): number;
}

export interface BuiltinCallParams {
  node: SyntaxNode;
  fnName: string;
  cleanFnName: string;
  argsNode: SyntaxNode | null;
  argExprIds: number[];
  argNodes: SyntaxNode[];
  namedArgs: Map<string, number>;
  dae: DAEBuilder;
  ctx: LoweringContext;
  state: FlatteningState;
  lowerExpr: LowerExprFn;
}

export type NameResolver = (name: string) => SymbolEntry | null | undefined;

export interface OverconstrainedGraphExt {
  roots?: Set<string> | undefined;
  potentialRoots?: Map<string, number> | undefined;
  branches?: { a: string; b: string }[] | undefined;
  queriedRoots?: Set<string> | undefined;
  selectedRoots?: Set<string> | undefined;
  rootedMap?: Map<string, boolean> | undefined;
}

export interface DaeExtMetadataLike {
  hasOldInstOption?: boolean | undefined;
  isOldFrontend?: boolean | undefined;
  overconstrainedGraph?: OverconstrainedGraphExt | undefined;
  [key: string]: unknown;
}

export type LowererDaeExt = DAEBuilder & {
  className?: string | undefined;
  wasCalled?: boolean | undefined;
  wasInlined?: boolean | undefined;
  aliasTo?: string | undefined;
  symId?: SymbolId | undefined;
  componentPrefix?: string | undefined;
  specializedPrefix?: string | undefined;
  isShortFunc?: boolean | undefined;
  shortBaseFuncName?: string | undefined;
  enclosingScopeId?: SymbolId | undefined;
  isRecursive?: boolean | undefined;
  isBeingFlattened?: boolean | undefined;
  isExplicitImpure?: boolean | undefined;
  isEarlyInline?: boolean | undefined;
  isOperatorRecord?: boolean | undefined;
  parentDae?: LowererDaeExt | undefined;
  getExplicitVarExpression?: (vIdx: number) => number | undefined;
};

export type LowererFlattenerExt = Omit<FlattenerHostLike, "generateRecordConstructorFor"> & {
  currentFunctionComponentPrefix?: string | undefined;
  currentFunctionSpecializedPrefix?: string | undefined;
  _activeConstLowering?: Set<string> | undefined;
  generateRecordConstructorFor?: (
    sym: SymbolEntry,
    dae: DAEBuilder,
    rootClassId?: SymbolId,
    targetCtorName?: string,
  ) => DAEBuilder | null;
  lowerStandaloneText?: (
    text: string,
    dae: DAEBuilder,
    prefix?: string,
    substitutions?: Map<string, number | string>,
  ) => number;
};

export type LowererFlatteningState = FlatteningState & {
  realLoopVars?: Set<string> | undefined;
  namedArrayEnumInfo?: Map<string, { literals: string[]; qual: string; sym?: SymbolEntry }> | undefined;
  currentScopeId?: SymbolId | undefined;
};

export interface SymbolMetaLike {
  restriction?: string | undefined;
  isEnumeration?: boolean | undefined;
  typeSpecifier?: string | undefined;
  classKind?: string | undefined;
  classPrefixes?: string | undefined;
  variability?: string | undefined;
  isFinal?: boolean | undefined;
  literals?: string[] | undefined;
  [key: string]: unknown;
}

export interface OperatorFnParamData {
  name: string;
  typeSpec?: string | undefined;
  hasDefault?: boolean | undefined;
  defaultValue?: unknown;
  isArray?: boolean | undefined;
  dims?: unknown;
}

export interface OperatorFnData {
  funcSymId: SymbolId;
  qualifiedName: string;
  name?: string | undefined;
  isInline?: boolean | undefined;
  inputParams?: readonly OperatorFnParamData[] | undefined;
  [key: string]: unknown;
}

export type ModArgLike = ComponentModArgData & {
  isRedeclaration?: boolean | undefined;
  redeclare?: boolean | undefined;
  sourceSymbolId?: SymbolId | undefined;
  bindingExpression?: { text?: string | undefined; value?: unknown } | undefined;
};

export interface EffectiveModLike {
  isEach?: boolean | undefined;
  bindingExpression?: { text?: string | undefined; node?: FlattenerCstNode | null | undefined } | undefined;
  args?: readonly ModArgLike[] | undefined;
  [key: string]: unknown;
}

export interface ScopeDataLike {
  qualifiedImports?: Record<string, string> | undefined;
  unqualifiedImportPkgs?: readonly string[] | undefined;
  compoundImports?: readonly { names: readonly string[]; [key: string]: unknown }[] | undefined;
  [key: string]: unknown;
}

export interface CrefSubscriptEntry {
  node: SyntaxNode | null;
  text: string;
  isSlice?: boolean | undefined;
  values?: number[] | undefined;
  scalarText?: string | undefined;
  isRealSub?: boolean | undefined;
}

export interface EvalErrorLike {
  code?: number | undefined;
  message?: string | undefined;
  range?: DaeDiagnosticRange | undefined;
}
