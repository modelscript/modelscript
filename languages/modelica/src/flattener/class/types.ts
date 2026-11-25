// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared internal types for the Modelica class flattener submodules.
 */

import type { DAEBuilder, QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";
import type { FlatteningState } from "../support/state.js";
import type { WasmBailInfo } from "../support/wasm-bail-reasons.js";
import type {
  ComponentInstanceData,
  ComponentModArgData,
  FlattenerBackend,
  FlattenerCstNode,
  FlattenOptions,
  ParentModsLike,
} from "../types.js";

export interface CstNodeLike extends FlattenerCstNode {
  ptr?: number | undefined;
  id?: number | undefined;
  _startOffset?: number | undefined;
  _cachedPad?: number | undefined;
  facade?: { exports?: WasmKernelExports } | undefined;
  tree?:
    | {
        rootNode?: CstNodeLike | null | undefined;
        rootPtr?: number | undefined;
        facade?: { exports?: WasmKernelExports } | undefined;
        sourceCode?: string | undefined;
      }
    | null
    | undefined;
  children?: readonly CstNodeLike[] | null | undefined;
  parent?: CstNodeLike | null | undefined;
}

export interface SymbolMetaLike {
  isPredefined?: boolean;
  classKind?: string;
  classPrefixes?: string;
  variability?: string;
  isEnumeration?: boolean;
  typeSpecifier?: string;
}

export type SymbolEntryWithCaches = SymbolEntry & {
  _isOperatorRecord?: boolean;
  _isRecord?: boolean;
  _cachedCondParamInfo?: { leaves: string[]; baseClassIds: SymbolId[]; childClassIds: SymbolId[] };
};

export interface ModArgLike extends ComponentModArgData {
  isRedeclaration?: boolean;
  bindingExpression?: unknown;
  nameRange?: readonly [number, number];
}

export interface EffectiveModLike {
  args?: ModArgLike[];
}

export interface ComponentInstanceQueryData extends Omit<ComponentInstanceData, "modification"> {
  typeName?: string;
  classTargetId?: SymbolId | null;
  modification?: {
    isEach?: boolean;
    bindingExpression?: { text?: string };
    value?: { text?: string };
    args?: ModArgLike[];
  };
}

export type NameResolverFn = (name: string) => SymbolEntry | null | undefined;

export type QueryDBWithCaches = QueryDB & {
  _fileSymbolsCache?: Map<string, SymbolEntry[]>;
  _hasOperatorRecordsCache?: Map<SymbolId, boolean>;
  _classImportsCache?: Map<SymbolId, Map<string, string>>;
  _redeclareCache?: Map<SymbolId, boolean>;
  _unsupportedWasmCache?: Map<SymbolId, boolean>;
  _globalHasOperatorRecords?: boolean;
  rootNode?: { ptr?: number };
  allEntries?: () => SymbolEntry[];
  source?: (resourceId: string) => string | undefined;
};

export type FlattenOptionsExtended = FlattenOptions & {
  flattenerBackend?: FlattenerBackend;
  useLocalDirection?: boolean;
  allowNonStandardModelica?: string | string[];
};

export type ResolvedFlattenOptions = Omit<Required<FlattenOptions>, "flowThreshold"> & {
  flowThreshold?: number | undefined;
};

export interface WasmDiffStats {
  varCount: number;
  eqCount: number;
  bail?: WasmBailInfo | undefined;
  error?: string | undefined;
}

export interface WasmSourceFileEntry {
  key: string;
  text: string;
  utf8Bytes?: Uint8Array | undefined;
  baseUnitOffset: number;
  unitLen: number;
  isUtf16: boolean;
}

export type FlatteningStateWithWasm = FlatteningState & {
  wasmSourceFiles?: WasmSourceFileEntry[];
};

export type DaeDiagnosticWithOrigin = DAEBuilder["diagnostics"][number] & { fromFunction?: boolean };

export type DaeWithExtras = DAEBuilder & {
  wasmBail?: WasmBailInfo;
  diffReport?: WasmDiffStats;
  flattener?: ClassFlattenerContext;
  symId?: SymbolId;
  wasCalled?: boolean;
  foldedRecordTypes?: Map<string, string>;
  clone?: () => DAEBuilder;
};

export interface WasmKernelExports {
  flattener_create?: (daePtr: number) => number;
  flattener_destroy?: (wf: number) => void;
  flattener_setOmcCompatibility?: (wf: number, flags: number) => void;
  flattener_flatten?: (wf: number, classNodePtr: number, rootProgramPtr: number) => number;
  flattener_getErrorCode?: (wf: number) => number;
  flattener_getErrorStartByte?: (wf: number) => number;
  flattener_getErrorEndByte?: (wf: number) => number;
  flattener_getDisabledCount?: (wf: number) => number;
  flattener_getDisabledNameId?: (wf: number, idx: number) => number;
  flattener_getAlgorithmSectionCount?: (wf: number) => number;
  flattener_getAlgorithmSectionStart?: (wf: number, idx: number) => number;
  flattener_getAlgorithmSectionLength?: (wf: number, idx: number) => number;
  flattener_getAlgorithmSectionIsInitial?: (wf: number, idx: number) => number;
  flattener_getWhenRecordCount?: (wf: number) => number;
  flattener_getIfRecordCount?: (wf: number) => number;
  flattener_getExpandableBusCount?: (wf: number) => number;
  flattener_getExpandableBus?: (wf: number, idx: number) => number;
  flattener_getArrayCount?: (wf: number) => number;
  flattener_getArrayName?: (wf: number, idx: number) => number;
  flattener_getArrayNDims?: (wf: number, idx: number) => number;
  flattener_getArrayDim1?: (wf: number, idx: number) => number;
  flattener_getArrayDim2?: (wf: number, idx: number) => number;
  flattener_getArrayDim3?: (wf: number, idx: number) => number;
  flattener_getArrayDim4?: (wf: number, idx: number) => number;
  flattener_getInnerCount?: (wf: number) => number;
  flattener_getInnerFullPath?: (wf: number, idx: number) => number;
  flattener_getOuterMapCount?: (wf: number) => number;
  flattener_getOuterPath?: (wf: number, idx: number) => number;
  flattener_getTargetInnerPath?: (wf: number, idx: number) => number;
  flattener_getOcRootCount?: (wf: number) => number;
  flattener_getOcRoot?: (wf: number, idx: number) => number;
  flattener_getOcPotentialRootCount?: (wf: number) => number;
  flattener_getOcPotentialRoot?: (wf: number, idx: number) => number;
  flattener_getOcPotentialRootPrio?: (wf: number, idx: number) => number;
  flattener_getOcBranchCount?: (wf: number) => number;
  flattener_getOcBranchA?: (wf: number, idx: number) => number;
  flattener_getOcBranchB?: (wf: number, idx: number) => number;
  flattener_getOcQueriedRootCount?: (wf: number) => number;
  flattener_getOcQueriedRoot?: (wf: number, idx: number) => number;
  flattener_setExprLeft?: (daePtr: number, exprId: number, leftId: number) => void;
  dae_setExprData1?: (daePtr: number, exprId: number, data1: number) => void;
  lsp_isCharOffsetKernel?: () => number | boolean;
  lsp_getInputEncoding?: () => number;
}

export interface EvalFieldContainer {
  __kind?: string;
  fields?: Map<string, unknown>;
  __fields?: Map<string, unknown>;
  [key: string]: unknown;
}

/**
 * Host context satisfied by `ModelicaFlattener`, used by `flattener/class/*` submodules
 * to keep the module dependency graph strictly acyclic.
 */
export interface ClassFlattenerContext {
  db: QueryDB;
  options: ResolvedFlattenOptions;
  explicitArrayMode?: "scalarize" | "preserve" | undefined;
  currentRootClassId: SymbolId;
  currentClassId: SymbolId;
  useLocalDirection: boolean;
  state: FlatteningStateWithWasm;
  currentRootDae?: DAEBuilder | null | undefined;
  innerOuterComponents: Set<string>;
  innerDeclarations: Map<string, Map<string, string>>;
  disabledComponents: Set<string>;
  usedExternalObjects: Set<SymbolId>;
  usedRecordSymIds: Set<SymbolId>;
  usedRecordNames: Set<string>;
  implicitInners: { name: string; classId: SymbolId }[];
  fmuComponents: Map<string, SymbolId>;
  failedFunctionIds: Set<SymbolId>;
  invalidInterfaceFunctionIds: Set<SymbolId>;
  calledFunctionSymIds: Set<SymbolId>;
  activeLoopVars: Set<string>;
  expandableBuses: Map<string, SymbolId>;
  evaluatedConstantArrays: Map<string, unknown>;
  varConditionDeps: Map<string, string[]>;
  enumTypeMap: Map<string, string[]>;

  getFileSymbols(resourceId?: string): SymbolEntry[];
  isExternalObject(classId: SymbolId | null | undefined, visited?: Set<SymbolId>): boolean;
  isOperatorRecordSym(sym: SymbolEntry | null | undefined): boolean;
  isClassPartial(classId?: SymbolId | null, visited?: Set<SymbolId>): boolean;
  hasOperatorRecords(rootClassId?: SymbolId | null): boolean;
  isRecordSym(sym: SymbolEntry | null | undefined): boolean;
  collectClassImports(classId: SymbolId, visited?: Set<SymbolId>): Map<string, string>;
  validateOperatorRecords(dae: DAEBuilder, rootClassId: SymbolId): void;
  validateClassSpecializationRestrictions(dae: DAEBuilder, rootClassId: SymbolId): void;
  classHasRedeclare(classId?: SymbolId | null, visited?: Set<SymbolId>): boolean;
  classHasConnect(classId?: SymbolId | null, visited?: Set<SymbolId>): boolean;
  classHasUnsupportedWasmFeatures(classId?: SymbolId | null, visited?: Set<SymbolId>): boolean;
  getUnsupportedWasmReasons(classId?: SymbolId | null, visited?: Set<SymbolId>): string[];
  isClassType(classId: SymbolId, visited?: Set<SymbolId>): boolean;
  generateRecordConstructors(rootClassId: SymbolId, dae: DAEBuilder): void;
  flattenFunction(
    fnSymId: SymbolId,
    fnName: string,
    modifiers?: unknown[],
    parentDae?: DAEBuilder,
    enclosingScopeId?: SymbolId,
  ): DAEBuilder;
  extractClassEquations(
    classId: SymbolId,
    prefix: string,
    dae: DAEBuilder,
    breakContext?: {
      brokenComponents: Set<string>;
      brokenConnections: Set<string>;
    },
    parentMods?: ParentModsLike | null,
    visitedClasses?: Set<SymbolId>,
  ): void;
  classFindMember(classId: SymbolId, name: string, visited?: Set<SymbolId>): SymbolEntry | null;
  instantiateElements(elements: SymbolId[], prefix: string, dae: DAEBuilder): void;
  checkBalance(dae: DAEBuilder, rootClassId?: SymbolId): void;
}
