// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Multi-Problem DAEBuilder Types, Enums, and Bitmask Constants.
 *
 * Mirrors the canonical WebAssembly linear-memory layout in
 * `packages/runtime/src/wasm/dae/types.ts`.
 */

import type { WasmRuntimeExports } from "./wasm_loader.js";

// ── Additional Variable & Equation Flags ──

/** Variable hidden from standard result output (`HideResult` or internal helper) (`1 << 11`). */
export const FLAG_VAR_HIDDEN = 1 << 11;
/** Binary decision variable restricted to `{0, 1}` for MILP/MINLP (`1 << 12`). */
export const FLAG_VAR_BINARY = 1 << 12;
/** Equation is a two-point or multi-point boundary condition for a BVP (`1 << 5`). */
export const FLAG_EQ_BOUNDARY = 1 << 5;

// ── Problem Class Bitmask Flags ──

export const PROBLEM_ODE = 1 << 0;
export const PROBLEM_DAE = 1 << 1;
export const PROBLEM_OPTIMIZATION = 1 << 2;
export const PROBLEM_SDE = 1 << 3;
export const PROBLEM_DDE = 1 << 4;
export const PROBLEM_BVP = 1 << 5;
export const PROBLEM_JUMP = 1 << 6;
export const PROBLEM_UNCERTAIN = 1 << 7;
export const PROBLEM_REACHABILITY = 1 << 8;
export const PROBLEM_HYBRID = 1 << 9;

// ── 1. Optimization Enums & Interfaces ──

export enum DaeObjectiveSense {
  Minimize = 0,
  Maximize = 1,
}

export const FLAG_OBJ_MAYER = 1 << 0;
export const FLAG_OBJ_LAGRANGE = 1 << 1;

export enum ConstraintKind {
  Algebraic = 0,
  Path = 1,
  Initial = 2,
  Terminal = 3,
  Complementarity = 4,
  SOC = 5,
  PSD = 6,
}

export interface ObjectiveSpec {
  index: number;
  mayerExprId: number;
  lagrangeExprId: number;
  sense: DaeObjectiveSense;
  flags: number;
}

export interface ConstraintSpec {
  index: number;
  exprId: number;
  lb: number;
  ub: number;
  kind: ConstraintKind;
}

export interface ConeConstraintSpec {
  index: number;
  kind: ConstraintKind;
  dim: number;
  memberExprIds: number[];
}

// ── 2. SDE Enums & Interfaces ──

export enum SdeNoiseType {
  Diagonal = 0,
  Scalar = 1,
  Matrix = 2,
}

export enum SdeCalculus {
  Ito = 0,
  Stratonovich = 1,
}

export interface DiffusionSpec {
  index: number;
  stateVarId: number;
  noiseChannelId: number;
  exprId: number;
  flags: number;
}

export interface SdeConfig {
  noiseType: SdeNoiseType;
  calculus: SdeCalculus;
  brownianDim: number;
  seed: number;
  ensemblePaths: number;
}

export interface WasmSdeTrajectoryResult {
  times: number[];
  states: number[][];
}

// ── 3. BVP Enums & Interfaces ──

export enum BvpMethod {
  Collocation = 0,
  Shooting = 1,
}

export interface BvpConfig {
  method: BvpMethod;
  intervals: number;
  boundaryPoints: number[];
}

// ── 4. DDE Enums & Interfaces ──

export const FLAG_DELAY_CONSTANT = 1 << 0;
export const FLAG_DELAY_TIME_DEP = 1 << 1;
export const FLAG_DELAY_STATE_DEP = 1 << 2;
export const FLAG_DELAY_NEUTRAL = 1 << 3;

export interface DelayChannelSpec {
  index: number;
  targetExprId: number;
  tauExprId: number;
  historyExprId: number;
  historyDerivExprId: number;
  flags: number;
}

// ── 5. Jump Process / SSA Enums & Interfaces ──

export enum JumpRateKind {
  ConstantRate = 0,
  VariableRate = 1,
  MassAction = 2,
}

export enum JumpAffectMode {
  Additive = 0,
  Assign = 1,
}

export interface JumpAffectSpec {
  targetVarId: number;
  deltaExprId: number;
  mode: JumpAffectMode;
}

export interface JumpSpec {
  index: number;
  propensityExprId: number;
  flags: number;
  affects: JumpAffectSpec[];
}

export interface WasmJumpTrajectoryResult {
  times: number[];
  states: number[][];
  jumpIds: number[];
}

// ── 6. Uncertainty, Reachability & STL Enums & Interfaces ──

export enum UncertaintyDistKind {
  Interval = 0,
  Uniform = 1,
  Normal = 2,
  LogNormal = 3,
  TruncNormal = 4,
  Discrete = 5,
}

export interface VarUncertaintySpec {
  index: number;
  varId: number;
  distKind: UncertaintyDistKind;
  p1: number;
  p2: number;
}

export enum StlOp {
  Atomic = 0,
  Not = 1,
  And = 2,
  Or = 3,
  Always = 4,
  Eventually = 5,
  Until = 6,
}

export interface StlNodeSpec {
  index: number;
  op: StlOp;
  leftId: number;
  rightId: number;
  tLo: number;
  tHi: number;
  flags: number;
}

export interface StateInvariantSpec {
  index: number;
  stateId: number;
  varId: number;
  lo: number;
  hi: number;
}

/**
 * Typed WebAssembly export surface for the linear-memory `DaeBuilder` runtime
 * and its domain facets (optimization, SDE, BVP, delays, jumps, uncertainty, STL, invariants).
 */
export interface DaeWasmExports extends WasmRuntimeExports {
  alloc: (size: number) => number;
  free: (ptr: number) => void;
  dae_free: (ptr: number) => void;
  atomicChunkAlloc: (size: number) => number;
  atomicChunkFree: (ptr: number) => void;

  // Core DAE Builder lifecycle & arena queries
  dae_createBuilder: () => number;
  dae_getStringPool: (ptr: number) => number;
  dae_clone: (ptr: number) => number;
  dae_snapshot: (ptr: number) => void;
  dae_rollback: (ptr: number) => void;
  dae_getVarCount: (ptr: number) => number;
  dae_getEqCount: (ptr: number) => number;
  dae_getExprCount: (ptr: number) => number;
  dae_getStmtCount: (ptr: number) => number;

  // Variables
  dae_addVariable: (
    ptr: number,
    nameId: number,
    type: number,
    variability: number,
    causality: number,
    startVal: number,
    flags: number,
  ) => number;
  dae_lookupVariable: (ptr: number, nameId: number) => number;
  dae_getVarNameId: (ptr: number, varId: number) => number;
  dae_getVarType: (ptr: number, varId: number) => number;
  dae_getVarVariability: (ptr: number, varId: number) => number;
  dae_getVarCausality: (ptr: number, varId: number) => number;
  dae_getVarFlags: (ptr: number, varId: number) => number;
  dae_setVarFlags: (ptr: number, varId: number, flags: number) => void;
  dae_getVarStartValue: (ptr: number, varId: number) => number;
  dae_setVarStartValue: (ptr: number, varId: number, val: number) => void;
  dae_getVarShapeDim: (ptr: number, varIdx: number, dimIdx: number) => number;
  dae_setVarShapeDim: (ptr: number, varIdx: number, dimIdx: number, size: number) => void;
  dae_getVarAttrExpr: (ptr: number, varIdx: number, attrKind: number) => number;
  dae_setVarAttrExpr: (ptr: number, varIdx: number, attrKind: number, exprId: number) => void;
  dae_getVarClock: (ptr: number, varIdx: number) => number;
  dae_setVarClock: (ptr: number, varIdx: number, clockId: number) => void;
  dae_addAlias: (ptr: number, varIdx: number, targetNameId: number) => void;
  dae_getAlias: (ptr: number, varIdx: number) => number;

  // Equations
  dae_addEquation: (ptr: number, kind: number, lhsId: number, rhsId: number, auxId: number) => number;
  dae_getEqKind: (ptr: number, eqId: number) => number;
  dae_getEqLhs: (ptr: number, eqId: number) => number;
  dae_getEqRhs: (ptr: number, eqId: number) => number;
  dae_getEqAux: (ptr: number, eqId: number) => number;
  dae_setEqLhs: (ptr: number, eqId: number, lhs: number) => void;
  dae_setEqRhs: (ptr: number, eqId: number, rhs: number) => void;
  dae_setEqKind: (ptr: number, eqId: number, kind: number) => void;
  dae_setEqRemoved: (ptr: number, eqIdx: number, removed: boolean) => void;
  dae_getEqClock: (ptr: number, eqIdx: number) => number;
  dae_setEqClock: (ptr: number, eqIdx: number, clockId: number) => void;

  // Expressions
  dae_addExpression: (ptr: number, kind: number, data1: number, left: number, right: number) => number;
  dae_addBinaryExpr: (ptr: number, op: number, left: number, right: number) => number;
  dae_addRealLiteral: (ptr: number, value: number) => number;
  dae_addIntLiteral: (ptr: number, value: number) => number;
  dae_addDer: (ptr: number, varId: number) => number;
  dae_addName: (ptr: number, varId: number) => number;
  dae_addIfElse: (ptr: number, condExpr: number, trueExpr: number, falseExpr: number) => number;
  dae_addCall: (ptr: number, funcId: number, firstArg: number, argCount: number) => number;
  dae_getExprKind: (ptr: number, exprId: number) => number;
  dae_getExprData1: (ptr: number, exprId: number) => number;
  dae_getExprLeft: (ptr: number, exprId: number) => number;
  dae_getExprRight: (ptr: number, exprId: number) => number;
  dae_getExprRealValue: (ptr: number, exprId: number) => number;
  dae_setExprData1: (ptr: number, exprId: number, data1: number) => void;

  // Statements
  dae_addStatement: (ptr: number, kind: number, data1: number, left: number, right: number) => number;
  dae_getStmtKind: (ptr: number, stmtId: number) => number;
  dae_getStmtData1: (ptr: number, stmtId: number) => number;
  dae_getStmtLeft: (ptr: number, stmtId: number) => number;
  dae_getStmtRight: (ptr: number, stmtId: number) => number;
  dae_setStmtData1: (ptr: number, stmtId: number, data1: number) => void;
  dae_setStmtLeft: (ptr: number, stmtId: number, left: number) => void;

  // Clocks, structured equations, state machines, events, problem flags
  dae_addClock: (ptr: number, intervalExprId: number, resolutionExprId: number, shiftExprId: number) => number;
  dae_addWhenBodyEquation: (ptr: number, whenIdx: number, kind: number, lhsId: number, rhsId: number) => void;
  dae_addForEquation: (ptr: number, indexNameId: number, rangeExprId: number) => void;
  dae_addForBodyEquation: (ptr: number, forIdx: number, kind: number, lhsId: number, rhsId: number) => void;
  dae_addIfEquation: (ptr: number, conditionExprId: number) => void;
  dae_addIfThenEquation: (ptr: number, ifIdx: number, kind: number, lhsId: number, rhsId: number) => void;
  dae_addStateMachine: (ptr: number, nameId: number, initialStateId: number) => number;
  dae_addState: (ptr: number, smId: number, nameId: number) => number;
  dae_addStateEquation: (
    ptr: number,
    smId: number,
    stateId: number,
    targetNameId: number,
    exprId: number,
    isDerivative: boolean,
  ) => number;
  dae_addTransition: (
    ptr: number,
    smId: number,
    fromStateId: number,
    toStateId: number,
    conditionExprId: number,
    flags: number,
    priority: number,
  ) => number;
  dae_addEventIndicator: (ptr: number, exprId: number) => number;
  dae_getEventIndicatorCount: (ptr: number) => number;
  dae_getEventIndicatorExprId: (ptr: number, idx: number) => number;
  dae_setOptimizationObjective: (
    ptr: number,
    objExpr: number,
    integrandExpr: number,
    startExpr: number,
    finalExpr: number,
  ) => void;
  dae_getProblemFlags: (ptr: number) => number;
  dae_setProblemFlag: (ptr: number, flag: number) => void;
  dae_clearProblemFlag: (ptr: number, flag: number) => void;

  // Evaluation, folding, simplification, analysis, autodiff
  dae_evalExpr: (ptr: number, exprId: number, valsPtr: number) => number;
  dae_evalConstantScalar?: (ptr: number, id: number, onlyConst: boolean) => number;
  dae_getLastEvalType?: () => number;
  dae_evalDualJacobianColumn?: (
    ptr: number,
    nEqs: number,
    eqPtr: number,
    valPtr: number,
    seedVarId: number,
    outPtr: number,
  ) => void;
  dae_evalExpressionAsReal?: (ptr: number, exprId: number) => number;
  dae_executeStatements?: (ptr: number, startStmtIdx: number, stmtCount: number, valPtr: number) => void;
  dae_foldConstantsEx: (ptr: number, maxIterations: number, omcCompatibility: boolean) => number;
  dae_simplifyAlgebraicExpr?: (ptr: number, exprId: number, onlyConst: boolean) => number;
  dae_relaxAllEquations?: (ptr: number, k: number, flags: number) => void;
  dae_relaxExpression?: (ptr: number, exprId: number, k: number, flags: number) => number;
  dae_isolateEquation?: (ptr: number, eqIdx: number, targetVarIdx: number) => number;
  dae_batchIsolate1x1Blocks?: (
    ptr: number,
    eqIndicesPtr: number,
    varIndicesPtr: number,
    count: number,
    outExprIdsPtr: number,
  ) => number;
  dae_checkVarBounds?: (varId: number, lo: number, hi: number, minVal: number, maxVal: number) => number;
  dae_checkPantelidesIndex1?: (ptr: number, maskPtr: number) => number;
  computeBltFromArena?: (ptr: number, maskPtr: number, hasParams: number, hasStates: number) => number;
  cas_export_simplify?: (ptr: number, exprId: number) => number;
  dae_setActiveDelayValues: (delayBufPtr: number, count: number) => void;

  // Optimization facet
  dae_opt_getObjectiveCount: (ptr: number) => number;
  dae_opt_getConstraintCount: (ptr: number) => number;
  dae_opt_getConeCount: (ptr: number) => number;
  dae_opt_addObjective: (ptr: number, mayerId: number, lagrangeId: number, sense: number, flags: number) => number;
  dae_opt_addConstraint: (ptr: number, exprId: number, lb: number, ub: number, kind: number) => number;
  dae_opt_addCone: (ptr: number, kind: number, dim: number) => number;
  dae_opt_addConeMember: (ptr: number, coneIdx: number, memberExprId: number) => void;
  dae_opt_getObjectiveMayer: (ptr: number, idx: number) => number;
  dae_opt_getObjectiveLagrange: (ptr: number, idx: number) => number;
  dae_opt_getObjectiveSense: (ptr: number, idx: number) => number;
  dae_opt_getObjectiveFlags: (ptr: number, idx: number) => number;
  dae_opt_getConstraintExpr: (ptr: number, idx: number) => number;
  dae_opt_getConstraintLb: (ptr: number, idx: number) => number;
  dae_opt_getConstraintUb: (ptr: number, idx: number) => number;
  dae_opt_getConstraintKind: (ptr: number, idx: number) => number;
  dae_opt_getConeMemberStart: (ptr: number, idx: number) => number;
  dae_opt_getConeMemberCount: (ptr: number, idx: number) => number;
  dae_opt_getConeMember: (ptr: number, memberIdx: number) => number;
  dae_opt_getConeKind: (ptr: number, idx: number) => number;
  dae_opt_getConeDim: (ptr: number, idx: number) => number;
  dae_opt_evalObjectives: (ptr: number, valsPtr: number, outPtr: number, normalizeMinimize: number) => void;
  dae_opt_evalConstraints: (ptr: number, valsPtr: number, outPtr: number) => void;
  dae_opt_maxConstraintViolation: (ptr: number, valsPtr: number) => number;
  dae_opt_evalObjectiveGradient: (
    ptr: number,
    objIdx: number,
    valsPtr: number,
    idsPtr: number,
    nVars: number,
    gradPtr: number,
    normalizeMinimize: number,
  ) => number;
  dae_opt_evalConstraintJacobianDense: (
    ptr: number,
    valsPtr: number,
    idsPtr: number,
    nVars: number,
    jacPtr: number,
  ) => void;
  dae_opt_evalConstraintJacobianSparse: (
    ptr: number,
    valsPtr: number,
    idsPtr: number,
    nVars: number,
    tol: number,
    rowsPtr: number,
    colsPtr: number,
    outValsPtr: number,
    maxNnz: number,
  ) => number;

  // SDE facet
  dae_sde_getDiffusionCount: (ptr: number) => number;
  dae_sde_addDiffusion: (ptr: number, stateVarId: number, ch: number, exprId: number, flags: number) => number;
  dae_sde_setConfig: (
    ptr: number,
    noiseType: number,
    calculus: number,
    brownianDim: number,
    seed: number,
    ensemblePaths: number,
  ) => void;
  dae_sde_getNoiseType: (ptr: number) => number;
  dae_sde_getCalculus: (ptr: number) => number;
  dae_sde_getBrownianDim: (ptr: number) => number;
  dae_sde_getSeed: (ptr: number) => number;
  dae_sde_getEnsemblePaths: (ptr: number) => number;
  dae_sde_getDiffusionExpr: (ptr: number, idx: number) => number;
  dae_sde_getDiffusionStateVar: (ptr: number, idx: number) => number;
  dae_sde_getDiffusionNoiseChannel: (ptr: number, idx: number) => number;
  dae_sde_getDiffusionFlags: (ptr: number, idx: number) => number;
  dae_sde_evalDiffusions: (ptr: number, valsPtr: number, outPtr: number) => void;
  dae_sde_runEulerMaruyama: (
    ptr: number,
    stIdsPtr: number,
    driftPtr: number,
    nStates: number,
    t0: number,
    tEnd: number,
    steps: number,
    seed: number,
    valsPtr: number,
    outTimesPtr: number,
    outStatesPtr: number,
  ) => number;
  dae_sde_runMilstein: (
    ptr: number,
    stIdsPtr: number,
    driftPtr: number,
    nStates: number,
    t0: number,
    tEnd: number,
    steps: number,
    seed: number,
    valsPtr: number,
    outTimesPtr: number,
    outStatesPtr: number,
  ) => number;
  dae_sde_runSRIW1: (
    ptr: number,
    stIdsPtr: number,
    driftPtr: number,
    nStates: number,
    t0: number,
    tEnd: number,
    steps: number,
    seed: number,
    valsPtr: number,
    outTimesPtr: number,
    outStatesPtr: number,
  ) => number;
  dae_sde_runEnsemble: (
    ptr: number,
    stIdsPtr: number,
    driftPtr: number,
    nStates: number,
    t0: number,
    tEnd: number,
    steps: number,
    numPaths: number,
    seed: number,
    useMilstein: number,
    valsPtr: number,
    outTimesPtr: number,
    outMeanPtr: number,
    outVarPtr: number,
  ) => number;

  // BVP facet
  dae_bvp_addBoundaryEquation: (ptr: number, lhsExprId: number, rhsExprId: number, flags: number) => number;
  dae_bvp_addAtBoundaryExpr: (ptr: number, varId: number, boundaryPointIdx: number) => number;
  dae_bvp_setConfig: (ptr: number, method: number, intervals: number) => void;
  dae_bvp_addBoundaryPoint: (ptr: number, tVal: number) => number;
  dae_bvp_getBoundaryPointCount: (ptr: number) => number;
  dae_bvp_getBoundaryPoint: (ptr: number, idx: number) => number;
  dae_bvp_getMethod: (ptr: number) => number;
  dae_bvp_getIntervals: (ptr: number) => number;
  dae_bvp_evalBoundaryResiduals: (ptr: number, yaPtr: number, ybPtr: number, valsPtr: number, outPtr: number) => number;

  // Delay facet
  dae_delay_getCount: (ptr: number) => number;
  dae_delay_addChannel: (
    ptr: number,
    targetExprId: number,
    tauExprId: number,
    historyExprId: number,
    historyDerivExprId: number,
    flags: number,
  ) => number;
  dae_delay_addExpr: (ptr: number, channelIdx: number, targetExprId: number, tauExprId: number) => number;
  dae_delay_getHistoryExpr: (ptr: number, idx: number) => number;
  dae_delay_getHistoryDerivExpr: (ptr: number, idx: number) => number;
  dae_delay_getTargetExpr: (ptr: number, idx: number) => number;
  dae_delay_getTauExpr: (ptr: number, idx: number) => number;
  dae_delay_getFlags: (ptr: number, idx: number) => number;
  dae_delay_evalTau: (ptr: number, channelIdx: number, valsPtr: number) => number;
  dae_delay_evalHistory: (ptr: number, channelIdx: number, valsPtr: number) => number;

  // Jump / SSA facet
  dae_jump_getCount: (ptr: number) => number;
  dae_jump_add: (ptr: number, propensityExprId: number, flags: number) => number;
  dae_jump_addAffect: (ptr: number, jIdx: number, targetVarId: number, deltaExprId: number, mode: number) => void;
  dae_jump_getAffectStart: (ptr: number, idx: number) => number;
  dae_jump_getAffectCount: (ptr: number, idx: number) => number;
  dae_jump_getAffectVar: (ptr: number, idx: number) => number;
  dae_jump_getAffectExpr: (ptr: number, idx: number) => number;
  dae_jump_getAffectMode: (ptr: number, idx: number) => number;
  dae_jump_getPropensityExpr: (ptr: number, idx: number) => number;
  dae_jump_getFlags: (ptr: number, idx: number) => number;
  dae_jump_evalPropensities: (ptr: number, valsPtr: number, outPtr: number) => number;
  dae_jump_runGillespie: (
    ptr: number,
    trackedPtr: number,
    nTracked: number,
    t0: number,
    tEnd: number,
    maxEvents: number,
    seed: number,
    valsPtr: number,
    outTimesPtr: number,
    outStatesPtr: number,
    outJumpsPtr: number,
  ) => number;
  dae_jump_runTauLeaping: (
    ptr: number,
    trackedPtr: number,
    nTracked: number,
    t0: number,
    tEnd: number,
    steps: number,
    seed: number,
    valsPtr: number,
    outTimesPtr: number,
    outStatesPtr: number,
  ) => number;
  dae_jump_runHybridOdeSsa: (
    ptr: number,
    odeStPtr: number,
    odeDriftPtr: number,
    nOde: number,
    trackedPtr: number,
    nTracked: number,
    t0: number,
    tEnd: number,
    steps: number,
    seed: number,
    valsPtr: number,
    outTimesPtr: number,
    outStatesPtr: number,
  ) => number;

  // Uncertainty / STL / Invariant facet
  dae_unc_getCount: (ptr: number) => number;
  dae_unc_addVar: (ptr: number, varId: number, distKind: number, p1: number, p2: number) => number;
  dae_unc_getVarId: (ptr: number, idx: number) => number;
  dae_unc_getDistKind: (ptr: number, idx: number) => number;
  dae_unc_getP1: (ptr: number, idx: number) => number;
  dae_unc_getP2: (ptr: number, idx: number) => number;
  dae_unc_evalExprInterval: (ptr: number, exprId: number, nomPtr: number, outLoPtr: number, outHiPtr: number) => number;
  dae_stl_getCount: (ptr: number) => number;
  dae_stl_addNode: (
    ptr: number,
    op: number,
    leftId: number,
    rightId: number,
    tLo: number,
    tHi: number,
    flags: number,
  ) => number;
  dae_stl_getOp: (ptr: number, idx: number) => number;
  dae_stl_getLeft: (ptr: number, idx: number) => number;
  dae_stl_getRight: (ptr: number, idx: number) => number;
  dae_stl_getTLo: (ptr: number, idx: number) => number;
  dae_stl_getTHi: (ptr: number, idx: number) => number;
  dae_stl_getFlags: (ptr: number, idx: number) => number;
  dae_stl_evalTrajectoryRobustness: (
    ptr: number,
    rootStlIdx: number,
    timesPtr: number,
    trajPtr: number,
    numTimes: number,
    vc: number,
  ) => number;
  dae_inv_getCount: (ptr: number) => number;
  dae_inv_addStateInvariant: (ptr: number, stateId: number, varId: number, lo: number, hi: number) => number;
  dae_inv_getStateId: (ptr: number, idx: number) => number;
  dae_inv_getVarId: (ptr: number, idx: number) => number;
  dae_inv_getLo: (ptr: number, idx: number) => number;
  dae_inv_getHi: (ptr: number, idx: number) => number;
  dae_inv_checkStateMargin: (ptr: number, stateId: number, valsPtr: number) => number;

  // Optional flattener exports
  flattener_envCreate?: () => number;
  flattener_create?: (daePtr: number) => number;
  flattener_scopePush?: (
    flattenerPtr: number,
    classId: number,
    envPtr: number,
    prefixId: number,
    flags: number,
  ) => void;
  flattener_scopePop?: (flattenerPtr: number) => void;
  flattener_destroy?: (flattenerPtr: number) => void;
}

/** Minimal host interface required by all typed DAEBuilder problem facets. */
export interface FacetHost {
  readonly exports: DaeWasmExports;
  readonly ptr: number;
  readonly varCount: number;
  getVarStartValue(varIdx: number): number;
}

export const WASM_NULL_ID = 0xffffffff;
