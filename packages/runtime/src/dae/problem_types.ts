// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Multi-Problem DAEBuilder Types, Enums, and Bitmask Constants.
 *
 * Mirrors the canonical WebAssembly linear-memory layout in
 * `packages/runtime/src/wasm/dae/types.ts`.
 */

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

/** Minimal host interface required by all typed DAEBuilder problem facets. */
export interface FacetHost {
  readonly exports: any;
  readonly ptr: number;
  readonly varCount: number;
  getVarStartValue(varIdx: number): number;
}

export const WASM_NULL_ID = 0xffffffff;
