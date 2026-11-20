// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder, SymbolId } from "@modelscript/runtime";

export interface SourceSpan {
  startOffset: number;
  endOffset: number;
  startPosition?: unknown;
  endPosition?: unknown;
}

export interface FlatteningState {
  innerOuterComponents: Set<string>;
  innerComponents?: Set<string> | undefined;
  activeLoopVars: Set<string>;
  scopeDeclaredNames?: Map<string, Set<string>> | undefined;
  outerToInner?: Map<string, string> | undefined;
  constantAliases?: Map<string, string> | undefined;
  evaluatedParams?: Set<string> | undefined;
  stateOutputVars?: Set<string> | undefined;
  isInsidePrevious?: boolean | undefined;
  isInsideClock?: boolean | undefined;
  currentCompClauseRange?: SourceSpan | any;
  outerNonConstantAccess?: any[] | undefined;
  currentPrefix?: string | undefined;
  tmpVarMap?: Map<string, string> | undefined;
  tmpVarCounter?: number | undefined;
  linspaceCounter?: number | undefined;
  exprArrayShapes?: Map<number, number[]> | undefined;
  namedArrayShapes?: Map<string, number[]> | undefined;
  namedArrayTypes?: Map<string, number> | undefined;
  recordVarFieldExprs?: Map<string, Map<string, number>> | undefined;
  formalFunctionParams?: Map<string, { targetSymId: SymbolId; targetName: string }> | undefined;
  functionParameterNames?: Set<string> | undefined;
  hasAlgorithmSection?: boolean | undefined;
  inAlgorithmSection?: boolean | undefined;
  stmtRanges: Map<number, SourceSpan>;
  lastLoweredShape?: number[] | undefined;
  deducedOutputShapes: Map<string, number[]>;
  ignoredEqIndices?: Set<number> | undefined;
  wasmFlattener?: number | undefined;
  emptyWasmEnv?: any;
  wasmErrorCode?: number | undefined;
  wasmBail?: any;
  db?: any;
  flattener?: any;
  currentClassId?: SymbolId | undefined;
  currentRootClassId?: SymbolId | undefined;
  modelName?: string | undefined;
  isRealNameCache: Map<number | string, boolean>;
  varPrefixSet?: Set<string> | undefined;
  varPrefixCount?: number | undefined;
  overconstrainedConnections?: any;
  overconstrainedEquationIds?: Set<number> | undefined;
  pendingFinalParamNames?: Set<string> | undefined;
}

interface FlattenerHostLike {
  innerOuterComponents?: Set<string>;
  activeLoopVars?: Set<string>;
  currentPrefix?: string;
  db?: unknown;
  currentClassId?: SymbolId;
  currentRootClassId?: SymbolId;
  pushLoopVar?: (name: string) => void;
  popLoopVar?: (name: string) => void;
}

const flatteningStateStore = new WeakMap<DAEBuilder, FlatteningState>();

export function getFlatteningState(dae: DAEBuilder, flattener?: FlattenerHostLike): FlatteningState {
  const existing = flatteningStateStore.get(dae);
  if (existing) {
    if (flattener && !existing.flattener) {
      existing.flattener = flattener;
    }
    return existing;
  }

  let activeFlattener: FlattenerHostLike | undefined = flattener;
  let innerOuterComponentsStore: Set<string> | undefined;
  let activeLoopVarsStore: Set<string> | undefined;
  let currentPrefixStore: string | undefined;
  let stmtRangesStore: Map<number, SourceSpan> | undefined;
  let deducedOutputShapesStore: Map<string, number[]> | undefined;
  let dbStore: unknown;
  let currentClassIdStore: SymbolId | undefined;
  let currentRootClassIdStore: SymbolId | undefined;
  let isRealNameCacheStore: Map<number | string, boolean> | undefined;

  const getF = (): FlattenerHostLike | undefined => activeFlattener ?? flattener;

  const state: FlatteningState = {
    get innerOuterComponents(): Set<string> {
      const f = getF();
      if (!innerOuterComponentsStore && f?.innerOuterComponents) {
        innerOuterComponentsStore = f.innerOuterComponents;
      }
      return innerOuterComponentsStore ?? f?.innerOuterComponents ?? (innerOuterComponentsStore = new Set<string>());
    },
    set innerOuterComponents(val: Set<string>) {
      const f = getF();
      innerOuterComponentsStore = val;
      if (f) f.innerOuterComponents = val;
    },
    innerComponents: undefined,
    get activeLoopVars(): Set<string> {
      const f = getF();
      if (!activeLoopVarsStore && f?.activeLoopVars) {
        activeLoopVarsStore = f.activeLoopVars;
      }
      return activeLoopVarsStore ?? f?.activeLoopVars ?? (activeLoopVarsStore = new Set<string>());
    },
    set activeLoopVars(val: Set<string>) {
      const f = getF();
      activeLoopVarsStore = val;
      if (f) f.activeLoopVars = val;
    },
    scopeDeclaredNames: undefined,
    outerToInner: undefined,
    constantAliases: undefined,
    evaluatedParams: undefined,
    stateOutputVars: undefined,
    isInsidePrevious: undefined,
    currentCompClauseRange: undefined,
    outerNonConstantAccess: undefined,
    get currentPrefix(): string | undefined {
      return currentPrefixStore ?? getF()?.currentPrefix;
    },
    set currentPrefix(val: string | undefined) {
      currentPrefixStore = val;
    },
    tmpVarMap: undefined,
    tmpVarCounter: undefined,
    linspaceCounter: undefined,
    exprArrayShapes: undefined,
    namedArrayShapes: undefined,
    namedArrayTypes: undefined,
    recordVarFieldExprs: undefined,
    formalFunctionParams: undefined,
    functionParameterNames: undefined,
    hasAlgorithmSection: undefined,
    inAlgorithmSection: undefined,
    get stmtRanges(): Map<number, SourceSpan> {
      return (stmtRangesStore ??= new Map());
    },
    set stmtRanges(val: Map<number, SourceSpan>) {
      stmtRangesStore = val;
    },
    lastLoweredShape: undefined,
    get deducedOutputShapes(): Map<string, number[]> {
      return (deducedOutputShapesStore ??= new Map());
    },
    set deducedOutputShapes(val: Map<string, number[]>) {
      deducedOutputShapesStore = val;
    },
    ignoredEqIndices: undefined,
    wasmFlattener: undefined,
    emptyWasmEnv: undefined,
    wasmErrorCode: undefined,
    wasmBail: undefined,
    get db(): unknown {
      return dbStore ?? getF()?.db;
    },
    set db(val: unknown) {
      dbStore = val;
    },
    get flattener(): FlattenerHostLike | undefined {
      return activeFlattener ?? flattener;
    },
    set flattener(val: FlattenerHostLike | undefined) {
      activeFlattener = val;
    },
    get currentClassId(): SymbolId | undefined {
      return currentClassIdStore ?? getF()?.currentClassId ?? getF()?.currentRootClassId;
    },
    set currentClassId(val: SymbolId | undefined) {
      currentClassIdStore = val;
    },
    get currentRootClassId(): SymbolId | undefined {
      return currentRootClassIdStore ?? getF()?.currentRootClassId ?? currentClassIdStore;
    },
    set currentRootClassId(val: SymbolId | undefined) {
      currentRootClassIdStore = val;
    },
    modelName: undefined,
    get isRealNameCache(): Map<number | string, boolean> {
      return (isRealNameCacheStore ??= new Map());
    },
    set isRealNameCache(val: Map<number | string, boolean>) {
      isRealNameCacheStore = val;
    },
    varPrefixSet: undefined,
    varPrefixCount: undefined,
    overconstrainedConnections: undefined,
    overconstrainedEquationIds: undefined,
    pendingFinalParamNames: undefined,
  };

  flatteningStateStore.set(dae, state);
  return state;
}

export function getExprArrayShape(dae: DAEBuilder, exprId: number): number[] | undefined {
  return getFlatteningState(dae).exprArrayShapes?.get(exprId);
}

export function setExprArrayShape(dae: DAEBuilder, exprId: number, shape: number[]): void {
  const state = getFlatteningState(dae);
  let shapes = state.exprArrayShapes;
  if (!shapes) {
    shapes = new Map<number, number[]>();
    state.exprArrayShapes = shapes;
  }
  shapes.set(exprId, shape);
}

export function getNamedArrayShape(dae: DAEBuilder, name: string): number[] | undefined {
  return dae.getNamedArrayShape?.(name) ?? getFlatteningState(dae).namedArrayShapes?.get(name);
}

export function setNamedArrayShape(dae: DAEBuilder, name: string, shape: number[]): void {
  if (typeof dae.setNamedArrayShape === "function") {
    dae.setNamedArrayShape(name, shape);
  } else {
    const state = getFlatteningState(dae);
    let shapes = state.namedArrayShapes;
    if (!shapes) {
      shapes = new Map<string, number[]>();
      state.namedArrayShapes = shapes;
    }
    shapes.set(name, shape);
  }
}

export function pushLoopVar(flattener: FlattenerHostLike | null | undefined, name: string): void {
  if (!flattener) return;
  if (typeof flattener.pushLoopVar === "function") {
    flattener.pushLoopVar(name);
  } else if (flattener.activeLoopVars) {
    flattener.activeLoopVars.add(name);
  }
}

export function popLoopVar(flattener: FlattenerHostLike | null | undefined, name: string): void {
  if (!flattener) return;
  if (typeof flattener.popLoopVar === "function") {
    flattener.popLoopVar(name);
  } else if (flattener.activeLoopVars) {
    flattener.activeLoopVars.delete(name);
  }
}
