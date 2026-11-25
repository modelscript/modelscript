// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DAEBuilder, QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";

export interface FlattenerCstNode {
  type?: string | undefined;
  typeId?: number | undefined;
  text?: string | undefined;
  isNamed?: boolean | undefined;
  isMissing?: boolean | undefined;
  hasError?: boolean | undefined;
  children?: readonly FlattenerCstNode[] | null | undefined;
  namedChildren?: readonly FlattenerCstNode[] | null | undefined;
  childCount?: number | undefined;
  namedChildCount?: number | undefined;
  parent?: FlattenerCstNode | null | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  tree?: { rootNode?: FlattenerCstNode | null | undefined } | null | undefined;
  child?(index: number): FlattenerCstNode | null;
  namedChild?(index: number): FlattenerCstNode | null;
  childForFieldName?(name: string): FlattenerCstNode | null;
}

export interface ParentModsLike {
  isEach?: boolean | undefined;
  isFinal?: boolean | undefined;
  isRedeclare?: boolean | undefined;
  bindingExpression?: { text: string; node?: FlattenerCstNode | null | undefined } | undefined;
  args?: ComponentModArgData[] | undefined;
  specializedPkgPrefix?: string | undefined;
  ownerClassId?: SymbolId | undefined;
  currentClassId?: SymbolId | undefined;
  packageScopeId?: SymbolId | undefined;
  redeclaredTypeSpecifier?: string | undefined;
  wasmEnv?: unknown;
  [key: string]: unknown;
}

export interface FlattenerHostLike {
  db?: QueryDB | undefined;
  options?: FlattenOptions | undefined;
  explicitArrayMode?: "scalarize" | "preserve" | undefined;
  currentRootClassId?: SymbolId | undefined;
  currentRootClassName?: string | undefined;
  currentRootDae?: DAEBuilder | null | undefined;
  currentClassId?: SymbolId | undefined;
  currentPrefix?: string | undefined;
  currentImports?: Map<string, string> | undefined;
  currentParentMods?: ParentModsLike | null | undefined;
  currentBindingCompName?: string | undefined;
  currentFlatteningFunctionId?: SymbolId | null | undefined;
  activeFlatteningFunctionIds?: Set<SymbolId> | undefined;
  currentFunctionEnclosingScope?: SymbolId | null | undefined;
  innerOuterComponents?: Set<string> | undefined;
  innerDeclarations?: Map<string, Map<string, string>> | undefined;
  implicitInnerElem?: SymbolId | null | undefined;
  disabledComponents?: Set<string> | undefined;
  expandableBuses?: Map<string, SymbolId> | undefined;
  fmuComponents?: Map<string, SymbolId> | undefined;
  usedExternalObjects?: Set<SymbolId> | undefined;
  usedRecordSymIds?: Set<SymbolId> | undefined;
  usedRecordNames?: Set<string> | undefined;
  failedFunctionIds?: Set<SymbolId> | undefined;
  invalidInterfaceFunctionIds?: Set<SymbolId> | undefined;
  calledFunctionSymIds?: Set<SymbolId> | undefined;
  activeLoopVars?: Set<string> | undefined;
  usedOperatorFunctions?: Map<string, SymbolId> | undefined;
  evaluatedConstantArrays?: Map<string, unknown> | undefined;
  varConditionDeps?: Map<string, string[]> | undefined;
  enumTypeMap?: Map<string, string[]> | undefined;
  useLocalDirection?: boolean | undefined;
  isOldFrontend?: boolean | undefined;
  pushLoopVar?(name: string): void;
  popLoopVar?(name: string): void;
  isClassPartial?(classId?: SymbolId | null): boolean;
  isExternalObject?(classId: SymbolId | null | undefined, visited?: Set<SymbolId>): boolean;
  isFmuClass?(classId: SymbolId): boolean;
  isFunctionSym?(sym: SymbolEntry | null | undefined): boolean;
  isRecordSym?(sym: SymbolEntry | null | undefined): boolean;
  isOperatorRecordSym?(sym: SymbolEntry | null | undefined): boolean;
  hasOperatorRecords?(rootId: SymbolId): boolean;
  lowerExpr?(
    node: unknown,
    dae: DAEBuilder,
    prefix?: string,
    substitutions?: Map<string, number | string>,
    tupleContext?: boolean,
    isAssignmentLhs?: boolean,
  ): number;
  generateRecordConstructorFor?(sym: SymbolEntry, dae: DAEBuilder, rootClassId?: SymbolId): DAEBuilder | null;
  flattenFunction?(
    fnSymId: SymbolId,
    fnName: string,
    modifiers?: unknown[],
    parentDae?: DAEBuilder,
    enclosingScopeId?: SymbolId,
  ): DAEBuilder;
}

export interface LoweringContext {
  prefix?: string | undefined;
  substitutions?: Map<string, number | string> | undefined;
  imports?: Map<string, string> | undefined;
  db?: QueryDB | undefined;
  flattener?: FlattenerHostLike | undefined;
  tupleContext?: boolean | undefined;
  noArrayExpand?: boolean | undefined;
  isAssignmentLhs?: boolean | undefined;
}

export type FlattenerBackend = "ts" | "wasm" | "hybrid" | "diff";

export interface FlattenOptions {
  backend?: FlattenerBackend | undefined;
  arrayMode?: ("scalarize" | "preserve") | undefined;
  functionInlining?: boolean | undefined;
  omcCompatibility?: boolean | undefined;
  eliminateAliases?: boolean | undefined;
  useWasmKernel?: boolean | undefined;
  scalarizeBindings?: boolean | undefined;
  scalarizeMinMax?: boolean | undefined;
  flowThreshold?: number | undefined;
  intEnumConversion?: boolean | undefined;
  isOldFrontend?: boolean | undefined;
}

export interface ExtractedCompilerOptions {
  isOldFrontend: boolean;
  hasOldInstAnnotation?: boolean | undefined;
  isGen: boolean;
  ignoreCycles: boolean;
  ignoreReplaceable?: boolean | undefined;
  scalarizeBindings: boolean;
  scalarizeMinMax: boolean;
  flowThreshold?: number | undefined;
}

export interface ComponentModArgValueData {
  kind: string;
  value?: unknown;
  text?: string | undefined;
  cstBytes?: readonly [number, number] | undefined;
}

export interface ComponentModArgData {
  name: string;
  isBreak?: boolean | undefined;
  isEach?: boolean | undefined;
  isFinal?: boolean | undefined;
  isRedeclare?: boolean | undefined;
  isReplaceable?: boolean | undefined;
  redeclaredTypeSpecifier?: string | undefined;
  redeclaredClassId?: SymbolId | undefined;
  originPrefix?: string | undefined;
  evaluationScopeId?: SymbolId | undefined;
  ownerClassId?: SymbolId | undefined;
  value?: ComponentModArgValueData | null | undefined;
  nestedArgs?: readonly ComponentModArgData[] | undefined;
  args?: readonly ComponentModArgData[] | undefined;
}

export interface ComponentInstanceData {
  name: string;
  typeSpecifier: string;
  classInstance?: SymbolId | null | undefined;
  variability?: string | undefined;
  causality?: string | undefined;
  arrayDimensions?: number[] | undefined;
  flowPrefix?: string | undefined;
  isFinal?: boolean | undefined;
  isRedeclare?: boolean | undefined;
  isInner?: boolean | undefined;
  isOuter?: boolean | undefined;
  isReplaceable?: boolean | undefined;
  isProtected?: boolean | undefined;
  isConnectorType?: boolean | undefined;
  modification?:
    | {
        isEach?: boolean | undefined;
        bindingExpression?: { text: string } | undefined;
        args?: ComponentModArgData[] | undefined;
      }
    | undefined;
}
