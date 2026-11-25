// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DAEBuilder,
  evaluateArenaFunctionCall,
  type DaeDiagnosticRange,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { type SyntaxNode } from "../../../../src-gen/bindings.js";
import { type DiagnosticRange } from "../../support/range-utils.js";
import { getFlatteningState, type FlatteningState, type SourceSpan } from "../../support/state.js";
import { type ModelicaModificationEnv } from "../../support/wasm-bridge.js";
import {
  type ComponentModArgData,
  type FlattenerCstNode,
  type FlattenOptions,
  type ParentModsLike,
} from "../../types.js";

export type ResolveSimpleNameFn = (
  name: string,
  encapsulated?: boolean,
  skipInherited?: boolean,
  memberOnly?: boolean,
) => SymbolEntry | null;

export type ResolveNameFn = (
  qualifiedName: string,
  skipInherited?: boolean,
  allowMemberImports?: boolean,
) => SymbolEntry | null;

export type ParsedArrayArgValue = number | string | boolean | ParsedArrayArgValue[];
export type ArenaEvalArg = Parameters<typeof evaluateArenaFunctionCall>[2][number];
export type ArenaEvalResult = ReturnType<typeof evaluateArenaFunctionCall>;
export type EvaluateArenaFunctionCallWithNamed = (
  dae: DAEBuilder,
  funcNameId: number,
  argValues: ArenaEvalArg[],
  db?: QueryDB,
  scopeId?: SymbolId,
  namedArgs?: { name: string; value: number | boolean | string }[],
) => ArenaEvalResult;

export type EnumLiteralEntry = Parameters<DAEBuilder["setVarEnumerationLiterals"]>[1][number];

export interface EffectiveBindingData {
  expression?: unknown;
  text?: string | undefined;
  cstBytes?: readonly [number, number] | undefined;
  evaluationScopeId?: SymbolId | null | undefined;
}

export interface SymbolMetadataLike {
  typeSpecifier?: string | undefined;
  isReplaceable?: boolean | undefined;
  isFinal?: boolean | undefined;
  isPredefined?: boolean | undefined;
  isEnum?: boolean | undefined;
  isEnumeration?: boolean | undefined;
  isType?: boolean | undefined;
  baseType?: string | undefined;
  classKind?: string | undefined;
  classPrefixes?: string | string[] | undefined;
  flowPrefix?: string | undefined;
  variability?: string | number | undefined;
  causality?: string | number | undefined;
  varType?: number | undefined;
  type?: string | undefined;
  enumLiterals?: readonly EnumLiteralEntry[] | undefined;
  arrayDimensions?: number[] | undefined;
  [key: string]: unknown;
}

export interface ArrayDimRawEntry {
  kind: string;
  value?: number | undefined;
  size?: number | undefined;
  cstBytes?: readonly [number, number] | undefined;
  text?: string | undefined;
  evaluationScopeId?: SymbolId | null | undefined;
}

export interface ModValueData {
  kind?: string | undefined;
  value?: unknown;
  text?: string | undefined;
  cstBytes?: readonly [number, number] | undefined;
  cst?: FlattenerCstNode | SyntaxNode | null | undefined;
  node?: FlattenerCstNode | SyntaxNode | null | undefined;
  evaluationScopeId?: SymbolId | null | undefined;
  origArrayCompText?: string | undefined;
}

export interface ModArgData {
  name: string;
  kind?: string | undefined;
  each?: boolean | undefined;
  final?: boolean | undefined;
  isEach?: boolean | undefined;
  isFinal?: boolean | undefined;
  isBreak?: boolean | undefined;
  isRedeclare?: boolean | undefined;
  isRedeclaration?: boolean | undefined;
  isReplaceable?: boolean | undefined;
  isExtendsMod?: boolean | undefined;
  isFromParentExtends?: boolean | undefined;
  isRecordCtorArg?: boolean | undefined;
  isRecordCtorDefault?: boolean | undefined;
  fromParentMod?: boolean | undefined;
  fromExtends?: boolean | undefined;
  fromClassMod?: boolean | undefined;
  extendsTargetClassId?: SymbolId | undefined;
  redeclaredTypeSpecifier?: string | undefined;
  redeclaredClassId?: SymbolId | undefined;
  redeclaredClassPrefixes?: string | undefined;
  redeclaredKind?: "component" | "class" | undefined;
  redeclaredPrefix?: string | undefined;
  redeclaredArrayDimensionsRaw?: readonly ArrayDimRawEntry[] | undefined;
  originPrefix?: string | undefined;
  evaluationScopeId?: SymbolId | null | undefined;
  ownerClassId?: SymbolId | undefined;
  value?: ModValueData | null | undefined;
  bindingExpression?: ModValueData | string | null | undefined;
  modification?: ParentModData | null | undefined;
  nestedArgs?: readonly ModArgData[] | undefined;
  args?: readonly ModArgData[] | undefined;
  nameRange?: readonly [number, number] | undefined;
  modRange?: readonly [number, number] | undefined;
  modText?: string | undefined;
  modPosition?:
    | {
        startPosition?: { row: number; column: number } | undefined;
        endPosition?: { row: number; column: number } | undefined;
      }
    | undefined;
  cstNode?: FlattenerCstNode | SyntaxNode | null | undefined;
}

export interface ParentModData {
  isEach?: boolean | undefined;
  isFinal?: boolean | undefined;
  isRedeclare?: boolean | undefined;
  isRedeclaration?: boolean | undefined;
  isProtected?: boolean | undefined;
  isRecord?: boolean | undefined;
  isConnector?: boolean | undefined;
  hasNonConnectorParent?: boolean | undefined;
  parentVariability?: number | undefined;
  parentCausality?: number | undefined;
  parentFlowPrefix?: string | undefined;
  outerArrayDims?: number[] | undefined;
  bindingExpression?: ModValueData | null | undefined;
  value?: ModValueData | null | undefined;
  args?: readonly ModArgData[] | undefined;
  specializedPkgPrefix?: string | undefined;
  ownerClassId?: SymbolId | undefined;
  currentClassId?: SymbolId | undefined;
  packageScopeId?: SymbolId | undefined;
  evaluationScopeId?: SymbolId | null | undefined;
  redeclaredTypeSpecifier?: string | undefined;
  redeclaredPrefix?: string | undefined;
  redeclaredArrayDimensionsRaw?: readonly ArrayDimRawEntry[] | undefined;
  preserveOrigOuterDims?: number[] | undefined;
  wasmEnv?: ModelicaModificationEnv | null | undefined;
  protectedNames?: Set<string> | undefined;
  instantiatingClassIds?: Set<SymbolId> | undefined;
  bindingScope?: string | undefined;
  forceFixedFalse?: boolean | undefined;
  suppressDefaultBindings?: boolean | undefined;
  flowPrefix?: string | undefined;
  componentClauseRange?: DiagnosticRange | undefined;
  [key: string]: unknown;
}

export interface ComponentInstanceInfo {
  id?: SymbolId | undefined;
  parentId?: SymbolId | null | undefined;
  name: string;
  typeSpecifier: string | null;
  classInstance?: SymbolId | null | undefined;
  variability?: string | null | undefined;
  causality?: string | null | undefined;
  arrayDimensions?: number[] | null | undefined;
  flowPrefix?: string | null | undefined;
  isFinal?: boolean | undefined;
  isRedeclare?: boolean | undefined;
  isInner?: boolean | undefined;
  isOuter?: boolean | undefined;
  isReplaceable?: boolean | undefined;
  isProtected?: boolean | undefined;
  isConnectorType?: boolean | undefined;
  modification?: ParentModData | null | undefined;
}

export interface DaeExtensionMetadataLike {
  isOldFrontend?: boolean | undefined;
  hasOldInstOption?: boolean | undefined;
  outputVars?: Set<string> | undefined;
  evaluatedParams?: Set<string> | undefined;
  [key: string]: unknown;
}

export type ExtendedFlatteningState = FlatteningState & {
  loopVars?: Set<string> | undefined;
  loopVarValues?: Map<string, unknown> | undefined;
  packageRedeclares?: Set<string> | undefined;
  classRedeclares?: Set<string> | undefined;
  ElementRedeclares?: Set<string> | undefined;
  pendingSizeCallVars?: number[] | undefined;
  pendingSizeScannedCount?: number | undefined;
  namedArrayEnumInfo?: Map<string, { qual: string; literals: string[] }> | undefined;
};

export type ExtendedDaeBuilder = DAEBuilder & {
  hasVariablesWithPrefix?: (prefix: string) => boolean;
  pendingModValues?: Map<string, number | boolean> | undefined;
  pendingModExprs?: Map<string, string> | undefined;
  specializedPrefix?: string | undefined;
  enclosingScopeId?: SymbolId | undefined;
  wasCalled?: boolean | undefined;
  symId?: SymbolId | undefined;
  recordVarFieldExprs?: Map<string, Map<string, number>> | undefined;
};

export interface FlattenerWithPendingArrayBindings {
  pendingArrayBindings: Map<string, { lhsExprId: number; rhsExprId: number }[]>;
}

export function getExtState(dae: DAEBuilder, flattener?: ComponentFlattener): ExtendedFlatteningState {
  return getFlatteningState(dae, flattener) as ExtendedFlatteningState;
}

export function asExtDae(dae: DAEBuilder): ExtendedDaeBuilder {
  return dae as ExtendedDaeBuilder;
}

export function getDaeExtMeta(dae: DAEBuilder | null | undefined): DaeExtensionMetadataLike | undefined {
  return dae?.extensionMetadata as DaeExtensionMetadataLike | undefined;
}

export function getSymMeta(sym: SymbolEntry | null | undefined): SymbolMetadataLike {
  return (sym?.metadata as SymbolMetadataLike | undefined) ?? {};
}

export function getCstNode(db: QueryDB, id: SymbolId): SyntaxNode | null {
  return db.cstNode(id) as SyntaxNode | null;
}

export function getCstNodeRange(
  db: QueryDB,
  startOffset: number,
  endOffset: number,
  entry?: SymbolEntry | string,
): SyntaxNode | null {
  return db.cstNodeRange(startOffset, endOffset, entry) as SyntaxNode | null;
}

export function getPendingArrayBindings(
  flattener: ComponentFlattener,
): Map<string, { lhsExprId: number; rhsExprId: number }[]> {
  return (flattener as unknown as FlattenerWithPendingArrayBindings).pendingArrayBindings;
}

export function toDiagnosticRange(span: SourceSpan | DiagnosticRange | undefined): DaeDiagnosticRange | undefined {
  if (!span) return undefined;
  return {
    startOffset: span.startOffset,
    endOffset: span.endOffset,
    startPosition: span.startPosition as { row: number; column: number } | undefined,
    endPosition: span.endPosition as { row: number; column: number } | undefined,
  };
}

export function modArgDiagRange(arg: Pick<ModArgData, "modRange" | "modPosition">): DaeDiagnosticRange {
  return {
    startOffset: arg.modRange?.[0],
    endOffset: arg.modRange?.[1],
    startPosition: arg.modPosition?.startPosition,
    endPosition: arg.modPosition?.endPosition,
  };
}

export function getEnumLiteralName(lit: EnumLiteralEntry | string): string {
  return typeof lit === "string" ? lit : (lit.stringValue ?? lit.name ?? String(lit));
}

/**
 * Host flattener interface required by the component elaboration kernel.
 *
 * Exposes the Salsa {@link QueryDB}, active class/import scopes, `inner`/`outer` and
 * expandable connector registries, and callbacks for lowering CST expressions and
 * flattening nested functions or record constructors.
 */
export interface ComponentFlattener {
  db: QueryDB;
  options: Omit<Required<FlattenOptions>, "flowThreshold"> & {
    flowThreshold?: number | undefined;
    syncWasmEnv?: boolean | undefined;
  };
  currentRootClassId: SymbolId;
  currentClassId: SymbolId;
  currentRootDae?: DAEBuilder | null | undefined;
  currentImports: Map<string, string>;
  currentParentMods?: ParentModsLike | null | undefined;
  currentBindingCompName?: string | undefined;
  currentFunctionSpecializedPrefix?: string | undefined;
  currentFunctionComponentPrefix?: string | undefined;
  innerDeclarations: Map<string, Map<string, string>>;
  innerOuterComponents: Set<string>;
  implicitInners: { name: string; classId: SymbolId }[];
  implicitInnerElem: SymbolId | null;
  disabledComponents: Set<string>;
  expandableBuses: Map<string, SymbolId>;
  fmuComponents?: Map<string, SymbolId> | undefined;
  usedExternalObjects: Set<SymbolId>;
  usedRecordSymIds: Set<SymbolId>;
  usedRecordNames: Set<string>;
  failedFunctionIds: Set<SymbolId>;
  invalidInterfaceFunctionIds: Set<SymbolId>;
  calledFunctionSymIds: Set<SymbolId>;
  activeLoopVars: Set<string>;
  loopVarValues?: Map<string, unknown> | undefined;
  usedOperatorFunctions: Map<string, SymbolId>;
  evaluatedConstantArrays: Map<string, unknown>;
  varConditionDeps: Map<string, string[]>;
  instantiatedRecordComponents?: Map<string, Set<string>> | undefined;
  elaboratedPkgPrefixes?: Set<string> | undefined;
  noArrayExpand?: boolean | undefined;
  useLocalDirection?: boolean | undefined;
  isOldFrontend?: boolean | undefined;
  lowerExpr(
    node: SyntaxNode | FlattenerCstNode | null | undefined,
    dae: DAEBuilder,
    prefix?: string,
    substitutions?: Map<string, number | string>,
    tupleContext?: boolean,
    isAssignmentLhs?: boolean,
  ): number;
  pushLoopVar(name: string): void;
  popLoopVar(name: string): void;
  isClassPartial(classId?: SymbolId | null): boolean;
  isExternalObject(classId: SymbolId | null | undefined, visited?: Set<SymbolId>): boolean;
  isOperatorRecordSym(sym: SymbolEntry | null | undefined): boolean;
  isRecordSym(sym: SymbolEntry | null | undefined): boolean;
  isFunctionSym(sym: SymbolEntry | null | undefined): boolean;
  isCstNodeProtected(node: unknown): boolean;
  isExpandableConnectorClass(classId: SymbolId): boolean;
  isFmuClass?(classId: SymbolId): boolean;
  collectClassImports(classId: SymbolId, visited?: Set<SymbolId>): Map<string, string>;
  resolveTypeName?(typeName: string, scopeId: SymbolId): SymbolEntry | null;
  generateRecordConstructorFor(
    sym: SymbolEntry,
    dae: DAEBuilder,
    rootClassId?: SymbolId,
    overrideFnName?: string,
    overrideResType?: string,
  ): DAEBuilder | null;
  flattenFunction(
    fnSymId: SymbolId,
    fnName: string,
    modifiers?: ComponentModArgData[],
    parentDae?: DAEBuilder,
    enclosingScopeId?: SymbolId,
  ): DAEBuilder;
}

export type InstantiateElementsFn = (
  flattener: ComponentFlattener,
  elements: SymbolId[],
  prefix: string,
  dae: DAEBuilder,
  parentMods?: ParentModData | null,
) => void;

export type PhaseAction = "continue" | "break" | "return" | "proceed";

export interface PrePassResult {
  aborted: boolean;
  elements: SymbolId[];
  compInstMap: Map<SymbolId, ComponentInstanceInfo | undefined>;
  basePrefix: string;
  wasmEnv: ModelicaModificationEnv | null;
  wasmFlattener: number | undefined;
  prevCompClauseRange: SourceSpan | undefined;
  prevClassId: SymbolId;
}

export interface ResolvedComponentContext {
  isElemProtected: boolean;
  name: string;
  elemSym: SymbolEntry | undefined;
  meta: SymbolMetadataLike;
  classTargetId: SymbolId | null | undefined;
  redeclPkgId: SymbolId | null;
  redeclPkgPrefix: string | null;
  elemParent: SymbolId | null | undefined;
  matchingClassArg: ModArgData | undefined;
  effectiveParentArg: ModArgData | null | undefined;
  effectiveClassArg: ModArgData | undefined;
  redeclArg: ModArgData | null | undefined;
  classTarget: SymbolEntry | null | undefined;
  isType: boolean;
  effectiveType: string | null | undefined;
  isExtObj: boolean;
  compSpecPkgPrefix: string | null | undefined;
  isRecordTarget: boolean | null | undefined;
  isUserClass: boolean;
  targetMeta: SymbolMetadataLike | undefined;
  targetCst: SyntaxNode | null | undefined;
  isConnector: boolean;
}
