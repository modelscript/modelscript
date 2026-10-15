// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder, SymbolId } from "@modelscript/runtime";

export interface FlatteningState {
  innerOuterComponents: Set<string>;
  innerComponents?: Set<string>;
  activeLoopVars: Set<string>;
  scopeDeclaredNames?: Map<string, Set<string>>;
  outerToInner?: Map<string, string>;
  constantAliases?: Map<string, string>;
  stateOutputVars?: Set<string>;
  isInsidePrevious?: boolean;
  currentCompClauseRange?: { startByte: number; endByte: number; startPosition?: any; endPosition?: any } | any;
  outerNonConstantAccess?: any[];
  currentPrefix?: string;
  tmpVarMap?: Map<string, string>;
  tmpVarCounter?: number;
  linspaceCounter?: number;
  exprArrayShapes?: Map<number, number[]>;
  namedArrayShapes?: Map<string, number[]>;
  namedArrayTypes?: Map<string, number>;
  recordVarFieldExprs?: Map<string, Map<string, number>>;
  formalFunctionParams?: Map<string, { targetSymId: SymbolId; targetName: string }>;
  functionParameterNames?: Set<string>;
  hasAlgorithmSection?: boolean;
  inAlgorithmSection?: boolean;
  stmtRanges: Map<number, { startByte: number; endByte: number; startPosition?: any; endPosition?: any }>;
  lastLoweredShape?: number[];
  deducedOutputShapes: Map<string, number[]>;
  ignoredEqIndices?: Set<number>;
  wasmFlattener?: number;
  emptyWasmEnv?: any;
  wasmErrorCode?: number;
  wasmBail?: any;
  db?: any;
  flattener?: any;
  currentClassId?: SymbolId;
  currentRootClassId?: SymbolId;
  modelName?: string;
  isRealNameCache: Map<number | string, boolean>;
  varPrefixSet?: Set<string>;
  varPrefixCount?: number;
  overconstrainedConnections?: any;
  overconstrainedEquationIds?: Set<number>;
}

export function getFlatteningState(dae: DAEBuilder, flattener?: any): FlatteningState {
  const d = dae as any;
  if (flattener && !d.flattener) {
    d.flattener = flattener;
  }
  if (d.flatteningState) return d.flatteningState;
  const getF = () => d.flattener ?? flattener;
  const state: FlatteningState = {
    get innerOuterComponents(): Set<string> {
      const f = getF();
      if (!d.innerOuterComponents && f?.innerOuterComponents) {
        d.innerOuterComponents = f.innerOuterComponents;
      }
      return d.innerOuterComponents ?? f?.innerOuterComponents ?? (d.innerOuterComponents = new Set<string>());
    },
    set innerOuterComponents(val: Set<string>) {
      const f = getF();
      d.innerOuterComponents = val;
      if (f) f.innerOuterComponents = val;
    },
    get innerComponents(): Set<string> | undefined {
      return d.innerComponents;
    },
    set innerComponents(val: Set<string> | undefined) {
      d.innerComponents = val;
    },
    get activeLoopVars(): Set<string> {
      const f = getF();
      if (!d.activeLoopVars && f?.activeLoopVars) {
        d.activeLoopVars = f.activeLoopVars;
      }
      return d.activeLoopVars ?? f?.activeLoopVars ?? (d.activeLoopVars = new Set<string>());
    },
    set activeLoopVars(val: Set<string>) {
      const f = getF();
      d.activeLoopVars = val;
      if (f) f.activeLoopVars = val;
    },
    get scopeDeclaredNames(): Map<string, Set<string>> | undefined {
      return d.scopeDeclaredNames;
    },
    set scopeDeclaredNames(val: Map<string, Set<string>> | undefined) {
      d.scopeDeclaredNames = val;
    },
    get outerToInner(): Map<string, string> | undefined {
      return d.outerToInner;
    },
    set outerToInner(val: Map<string, string> | undefined) {
      d.outerToInner = val;
    },
    get constantAliases(): Map<string, string> | undefined {
      return d.constantAliases;
    },
    set constantAliases(val: Map<string, string> | undefined) {
      d.constantAliases = val;
    },
    get stateOutputVars(): Set<string> | undefined {
      return d.stateOutputVars;
    },
    set stateOutputVars(val: Set<string> | undefined) {
      d.stateOutputVars = val;
    },
    get isInsidePrevious(): boolean | undefined {
      return d.isInsidePrevious;
    },
    set isInsidePrevious(val: boolean | undefined) {
      d.isInsidePrevious = val;
    },
    get currentCompClauseRange(): { startByte: number; endByte: number; startPosition?: any; endPosition?: any } | any {
      return d.currentCompClauseRange;
    },
    set currentCompClauseRange(
      val: { startByte: number; endByte: number; startPosition?: any; endPosition?: any } | any,
    ) {
      d.currentCompClauseRange = val;
    },
    get outerNonConstantAccess(): any[] | undefined {
      return d.outerNonConstantAccess;
    },
    set outerNonConstantAccess(val: any[] | undefined) {
      d.outerNonConstantAccess = val;
    },
    get currentPrefix(): string | undefined {
      return d.currentPrefix ?? getF()?.currentPrefix;
    },
    set currentPrefix(val: string | undefined) {
      d.currentPrefix = val;
    },
    get tmpVarMap(): Map<string, string> | undefined {
      return d._tmpVarMap;
    },
    set tmpVarMap(val: Map<string, string> | undefined) {
      d._tmpVarMap = val;
    },
    get tmpVarCounter(): number | undefined {
      return d._tmpVarCounter;
    },
    set tmpVarCounter(val: number | undefined) {
      d._tmpVarCounter = val;
    },
    get linspaceCounter(): number | undefined {
      return d._linspaceCounter;
    },
    set linspaceCounter(val: number | undefined) {
      d._linspaceCounter = val;
    },
    get exprArrayShapes(): Map<number, number[]> | undefined {
      return d.exprArrayShapes;
    },
    set exprArrayShapes(val: Map<number, number[]> | undefined) {
      d.exprArrayShapes = val;
    },
    get namedArrayShapes(): Map<string, number[]> | undefined {
      return d.namedArrayShapes;
    },
    set namedArrayShapes(val: Map<string, number[]> | undefined) {
      d.namedArrayShapes = val;
    },
    get namedArrayTypes(): Map<string, number> | undefined {
      return d.namedArrayTypes;
    },
    set namedArrayTypes(val: Map<string, number> | undefined) {
      d.namedArrayTypes = val;
    },
    get recordVarFieldExprs(): Map<string, Map<string, number>> | undefined {
      return d.recordVarFieldExprs;
    },
    set recordVarFieldExprs(val: Map<string, Map<string, number>> | undefined) {
      d.recordVarFieldExprs = val;
    },
    get formalFunctionParams(): Map<string, { targetSymId: SymbolId; targetName: string }> | undefined {
      return d.formalFunctionParams;
    },
    set formalFunctionParams(val: Map<string, { targetSymId: SymbolId; targetName: string }> | undefined) {
      d.formalFunctionParams = val;
    },
    get functionParameterNames(): Set<string> | undefined {
      return d.functionParameterNames;
    },
    set functionParameterNames(val: Set<string> | undefined) {
      d.functionParameterNames = val;
    },
    get hasAlgorithmSection(): boolean | undefined {
      return d.hasAlgorithmSection;
    },
    set hasAlgorithmSection(val: boolean | undefined) {
      d.hasAlgorithmSection = val;
    },
    get inAlgorithmSection(): boolean | undefined {
      return d.inAlgorithmSection;
    },
    set inAlgorithmSection(val: boolean | undefined) {
      d.inAlgorithmSection = val;
    },
    get stmtRanges(): Map<number, { startByte: number; endByte: number; startPosition?: any; endPosition?: any }> {
      return (d.stmtRanges ??= new Map());
    },
    set stmtRanges(val: Map<number, { startByte: number; endByte: number; startPosition?: any; endPosition?: any }>) {
      d.stmtRanges = val;
    },
    get lastLoweredShape(): number[] | undefined {
      return d.lastLoweredShape;
    },
    set lastLoweredShape(val: number[] | undefined) {
      d.lastLoweredShape = val;
    },
    get deducedOutputShapes(): Map<string, number[]> {
      return (d.deducedOutputShapes ??= new Map());
    },
    set deducedOutputShapes(val: Map<string, number[]>) {
      d.deducedOutputShapes = val;
    },
    get ignoredEqIndices(): Set<number> | undefined {
      return d.ignoredEqIndices;
    },
    set ignoredEqIndices(val: Set<number> | undefined) {
      d.ignoredEqIndices = val;
    },
    get wasmFlattener(): number | undefined {
      return d._wasmFlattener;
    },
    set wasmFlattener(val: number | undefined) {
      d._wasmFlattener = val;
    },
    get emptyWasmEnv(): any {
      return d._emptyWasmEnv;
    },
    set emptyWasmEnv(val: any) {
      d._emptyWasmEnv = val;
    },
    get wasmErrorCode(): number | undefined {
      return d.wasmErrorCode;
    },
    set wasmErrorCode(val: number | undefined) {
      d.wasmErrorCode = val;
    },
    get wasmBail(): any {
      return d.wasmBail;
    },
    set wasmBail(val: any) {
      d.wasmBail = val;
    },
    get db(): any {
      return d.db ?? getF()?.db;
    },
    set db(val: any) {
      d.db = val;
    },
    get flattener(): any {
      return d.flattener ?? flattener;
    },
    set flattener(val: any) {
      d.flattener = val;
    },
    get currentClassId(): SymbolId | undefined {
      return d.currentClassId ?? getF()?.currentClassId ?? getF()?.currentRootClassId;
    },
    set currentClassId(val: SymbolId | undefined) {
      d.currentClassId = val;
    },
    get currentRootClassId(): SymbolId | undefined {
      return d.currentRootClassId ?? getF()?.currentRootClassId ?? d.currentClassId;
    },
    set currentRootClassId(val: SymbolId | undefined) {
      d.currentRootClassId = val;
    },
    get modelName(): string | undefined {
      return d.modelName;
    },
    set modelName(val: string | undefined) {
      d.modelName = val;
    },
    get isRealNameCache(): Map<number | string, boolean> {
      return (d._isRealNameCache ??= new Map());
    },
    set isRealNameCache(val: Map<number | string, boolean>) {
      d._isRealNameCache = val;
    },
    get varPrefixSet(): Set<string> | undefined {
      return d._varPrefixSet;
    },
    set varPrefixSet(val: Set<string> | undefined) {
      d._varPrefixSet = val;
    },
    get varPrefixCount(): number | undefined {
      return d._varPrefixCount;
    },
    set varPrefixCount(val: number | undefined) {
      d._varPrefixCount = val;
    },
    get overconstrainedConnections(): any {
      return d.overconstrainedConnections;
    },
    set overconstrainedConnections(val: any) {
      d.overconstrainedConnections = val;
    },
    get overconstrainedEquationIds(): Set<number> | undefined {
      return d.overconstrainedEquationIds;
    },
    set overconstrainedEquationIds(val: Set<number> | undefined) {
      d.overconstrainedEquationIds = val;
    },
  };
  d.flatteningState = state;
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

export function pushLoopVar(flattener: any, name: string): void {
  if (!flattener) return;
  if (typeof flattener.pushLoopVar === "function") {
    flattener.pushLoopVar(name);
  } else if (flattener.activeLoopVars) {
    flattener.activeLoopVars.add(name);
  }
}

export function popLoopVar(flattener: any, name: string): void {
  if (!flattener) return;
  if (typeof flattener.popLoopVar === "function") {
    flattener.popLoopVar(name);
  } else if (flattener.activeLoopVars) {
    flattener.activeLoopVars.delete(name);
  }
}
