// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @fileoverview Zero-GC WebAssembly Evaluation & Solver Kernels for Multi-Problem DAEBuilder
 *
 * Provides native linear-memory kernels for:
 *   1. Optimization (objectives, constraints, exact forward-AD gradients & Jacobians)
 *   2. SDEs (diffusion evaluation, Euler-Maruyama & Milstein with AD ∂g/∂y)
 *   3. BVPs (two-point boundary condition residuals & Jacobians)
 *   4. DDEs (delay channel evaluation with history fallback)
 *   5. Jump Processes / SSA (propensity evaluation & Gillespie Direct Method)
 *   6. STL & State Invariant Verification (trajectory robustness & invariant margins)
 */

import { Dual, evalDualExpr } from "../autodiff/dual";
import { ChunkedInt32Array, atomicChunkAlloc, atomicChunkFree } from "../core/array";
import { DaeBuilder } from "./builder";
import { evalExpr } from "./eval";
import { dae_evalExprInterval } from "./interval_eval";
import {
  AFFECT_EXPR,
  AFFECT_MODE,
  AFFECT_STRIDE,
  AFFECT_VAR,
  UNC_DIST_KIND,
  UNC_P1_HI,
  UNC_P1_LO,
  UNC_P2_HI,
  UNC_P2_LO,
  UNC_STRIDE,
  UNC_VAR,
  UncertaintyDistKind,
  CON_EXPR,
  CON_LB_HI,
  CON_LB_LO,
  CON_STRIDE,
  CON_UB_HI,
  CON_UB_LO,
  DELAY_HISTORY_EXPR,
  DELAY_STRIDE,
  DELAY_TARGET_EXPR,
  DELAY_TAU_EXPR,
  DIFF_EXPR,
  DIFF_NOISE_CH,
  DIFF_STATE_VAR,
  DIFF_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EQ_STRIDE,
  EXPR_DATA1,
  EXPR_KIND,
  EXPR_LEFT,
  EXPR_RIGHT,
  EXPR_STRIDE,
  EqKind,
  ExprKind,
  INV_HI_HI,
  INV_HI_LO,
  INV_LO_HI,
  INV_LO_LO,
  INV_STATE,
  INV_STRIDE,
  INV_VAR,
  JUMP_AFFECT_COUNT,
  JUMP_AFFECT_START,
  JUMP_PROPENSITY_EXPR,
  JUMP_STRIDE,
  JumpAffectMode,
  NULL_ID,
  OBJ_MAYER_EXPR,
  OBJ_SENSE,
  OBJ_STRIDE,
  ObjectiveSense,
  STL_LEFT,
  STL_OP,
  STL_RIGHT,
  STL_STRIDE,
  STL_THI_HI,
  STL_THI_LO,
  STL_TLO_HI,
  STL_TLO_LO,
  StlOp,
  BinOp,
  UnaryOp,
} from "./types";

@inline
function unpackF64(hi: i32, lo: i32): f64 {
  let bits = ((hi as u64) << 32) | ((lo as u64) & 0xffffffff);
  return f64.reinterpret_i64(bits as i64);
}

// ── Deterministic PRNG (SplitMix64 + Box-Muller) for WASM SDE & SSA ──

let _rngState: u64 = 0x9e3779b97f4a7c15;

@inline
function rngSeed(seed: u32): void {
  _rngState = (seed as u64) ^ 0x9e3779b97f4a7c15;
  if (_rngState == 0) _rngState = 0x9e3779b97f4a7c15;
}

@inline
function rngNextU64(): u64 {
  _rngState += 0x9e3779b97f4a7c15;
  let z = _rngState;
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9;
  z = (z ^ (z >> 27)) * 0x94d049bb133111eb;
  return z ^ (z >> 31);
}

@inline
function rngUniform(): f64 {
  // Returns U in (0, 1)
  let u = ((rngNextU64() >> 11) as f64) * (1.0 / 9007199254740992.0);
  return u > 1e-15 ? (u < 1.0 - 1e-15 ? u : 1.0 - 1e-15) : 1e-15;
}

@inline
function rngNormal(): f64 {
  let u1 = rngUniform();
  let u2 = rngUniform();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(6.283185307179586 * u2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Optimization Kernels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates all Mayer objectives in `objectivesData` into `outPtr` (`objectiveCount` f64s).
 * If `normalizeMinimize` is true, Maximize objectives are negated.
 */
export function dae_opt_evalObjectives(
  daePtr: u32,
  valsPtr: usize,
  outPtr: usize,
  normalizeMinimize: bool
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let count = dae.objectiveCount;
  if (count == 0) return 0;
  let tbl = dae.getObjectivesData();
  for (let i: u32 = 0; i < count; i++) {
    let off = i * OBJ_STRIDE;
    let mayerId = tbl.get(off + OBJ_MAYER_EXPR) as u32;
    let sense = tbl.get(off + OBJ_SENSE);
    let val: f64 = mayerId != NULL_ID ? evalExpr(mayerId, dae, valsPtr) : 0.0;
    if (normalizeMinimize && sense == ObjectiveSense.Maximize) {
      val = -val;
    }
    store<f64>(outPtr + ((i as usize) << 3), val);
  }
  return count;
}

/**
 * Evaluates all constraints in `constraintsData` into `outPtr` (`constraintCount` f64s).
 */
export function dae_opt_evalConstraints(daePtr: u32, valsPtr: usize, outPtr: usize): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let count = dae.constraintCount;
  if (count == 0) return 0;
  let tbl = dae.getConstraintsData();
  for (let i: u32 = 0; i < count; i++) {
    let exprId = tbl.get(i * CON_STRIDE + CON_EXPR) as u32;
    let val: f64 = exprId != NULL_ID ? evalExpr(exprId, dae, valsPtr) : 0.0;
    store<f64>(outPtr + ((i as usize) << 3), val);
  }
  return count;
}

/**
 * Computes maximum constraint violation max_i max(0, lb_i - g_i(x), g_i(x) - ub_i).
 */
export function dae_opt_maxConstraintViolation(daePtr: u32, valsPtr: usize): f64 {
  let dae = changetype<DaeBuilder>(daePtr);
  let count = dae.constraintCount;
  if (count == 0) return 0.0;
  let tbl = dae.getConstraintsData();
  let maxViol: f64 = 0.0;
  for (let i: u32 = 0; i < count; i++) {
    let off = i * CON_STRIDE;
    let exprId = tbl.get(off + CON_EXPR) as u32;
    if (exprId == NULL_ID) continue;
    let g = evalExpr(exprId, dae, valsPtr);
    let lb = unpackF64(tbl.get(off + CON_LB_HI), tbl.get(off + CON_LB_LO));
    let ub = unpackF64(tbl.get(off + CON_UB_HI), tbl.get(off + CON_UB_LO));
    if (g < lb) {
      let v = lb - g;
      if (v > maxViol) maxViol = v;
    }
    if (g > ub) {
      let v = g - ub;
      if (v > maxViol) maxViol = v;
    }
  }
  return maxViol;
}

/**
 * Computes exact forward-mode AD gradient of objective `objIdx` w.r.t. `varIdsPtr` (`nVars` u32s).
 * Writes `nVars` f64 derivatives to `outGradPtr` and returns the objective value.
 */
export function dae_opt_evalObjectiveGradient(
  daePtr: u32,
  objIdx: u32,
  valsPtr: usize,
  varIdsPtr: usize,
  nVars: u32,
  outGradPtr: usize,
  normalizeMinimize: bool
): f64 {
  let dae = changetype<DaeBuilder>(daePtr);
  if (objIdx >= dae.objectiveCount) return 0.0;
  let tbl = dae.getObjectivesData();
  let off = objIdx * OBJ_STRIDE;
  let mayerId = tbl.get(off + OBJ_MAYER_EXPR) as u32;
  let sense = tbl.get(off + OBJ_SENSE);
  if (mayerId == NULL_ID) return 0.0;

  let sign: f64 = normalizeMinimize && sense == ObjectiveSense.Maximize ? -1.0 : 1.0;
  let vc = dae.varCount;
  let dualBuf = atomicChunkAlloc(((vc + 1) as usize) << 4);
  let outDualPtr = atomicChunkAlloc(16);
  let outDual = changetype<Dual>(outDualPtr);

  for (let v: u32 = 0; v < vc; v++) {
    store<f64>(dualBuf + ((v as usize) << 4), load<f64>(valsPtr + ((v as usize) << 3)));
    store<f64>(dualBuf + ((v as usize) << 4) + 8, 0.0);
  }

  let objVal: f64 = 0.0;
  for (let k: u32 = 0; k < nVars; k++) {
    let targetVar = load<u32>(varIdsPtr + ((k as usize) << 2));
    store<f64>(dualBuf + ((targetVar as usize) << 4) + 8, 1.0);
    evalDualExpr(mayerId, dae, dualBuf, outDual);
    if (k == 0) objVal = sign * outDual.val;
    store<f64>(outGradPtr + ((k as usize) << 3), sign * outDual.dot);
    store<f64>(dualBuf + ((targetVar as usize) << 4) + 8, 0.0);
  }

  atomicChunkFree(outDualPtr);
  atomicChunkFree(dualBuf);
  return objVal;
}

/**
 * Computes exact dense constraint Jacobian J[conIdx * nVars + k] via forward-mode AD.
 */
export function dae_opt_evalConstraintJacobianDense(
  daePtr: u32,
  valsPtr: usize,
  varIdsPtr: usize,
  nVars: u32,
  outJacPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let m = dae.constraintCount;
  if (m == 0 || nVars == 0) return 0;

  let vc = dae.varCount;
  let dualBuf = atomicChunkAlloc(((vc + 1) as usize) << 4);
  let outDualPtr = atomicChunkAlloc(16);
  let outDual = changetype<Dual>(outDualPtr);
  let tbl = dae.getConstraintsData();

  for (let v: u32 = 0; v < vc; v++) {
    store<f64>(dualBuf + ((v as usize) << 4), load<f64>(valsPtr + ((v as usize) << 3)));
    store<f64>(dualBuf + ((v as usize) << 4) + 8, 0.0);
  }

  for (let k: u32 = 0; k < nVars; k++) {
    let targetVar = load<u32>(varIdsPtr + ((k as usize) << 2));
    store<f64>(dualBuf + ((targetVar as usize) << 4) + 8, 1.0);
    for (let i: u32 = 0; i < m; i++) {
      let exprId = tbl.get(i * CON_STRIDE + CON_EXPR) as u32;
      let deriv: f64 = 0.0;
      if (exprId != NULL_ID) {
        evalDualExpr(exprId, dae, dualBuf, outDual);
        deriv = outDual.dot;
      }
      store<f64>(outJacPtr + (((i * nVars + k) as usize) << 3), deriv);
    }
    store<f64>(dualBuf + ((targetVar as usize) << 4) + 8, 0.0);
  }

  atomicChunkFree(outDualPtr);
  atomicChunkFree(dualBuf);
  return m * nVars;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SDE Kernels (Diffusion Evaluation, Euler-Maruyama, Milstein)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates all diffusion entries into `outPtr` (`diffusionCount` f64s).
 */
export function dae_sde_evalDiffusions(daePtr: u32, valsPtr: usize, outPtr: usize): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let count = dae.diffusionCount;
  if (count == 0) return 0;
  let tbl = dae.getDiffusionData();
  for (let i: u32 = 0; i < count; i++) {
    let exprId = tbl.get(i * DIFF_STRIDE + DIFF_EXPR) as u32;
    let val: f64 = exprId != NULL_ID ? evalExpr(exprId, dae, valsPtr) : 0.0;
    store<f64>(outPtr + ((i as usize) << 3), val);
  }
  return count;
}

/**
 * Runs a full zero-GC Euler-Maruyama SDE trajectory in WASM linear memory.
 * - `stateVarIdsPtr`: `nStates` u32 variable indices
 * - `driftExprIdsPtr`: `nStates` u32 drift expression IDs (f_i(t, y))
 * - `valsPtr`: full variable value array (updated in place during stepping)
 * - `outTimesPtr`: `(steps + 1)` f64s
 * - `outStatesPtr`: `(steps + 1) * nStates` f64s
 */
export function dae_sde_runEulerMaruyama(
  daePtr: u32,
  stateVarIdsPtr: usize,
  driftExprIdsPtr: usize,
  nStates: u32,
  t0: f64,
  tEnd: f64,
  steps: u32,
  seed: u32,
  valsPtr: usize,
  outTimesPtr: usize,
  outStatesPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  if (steps == 0 || nStates == 0) return 0;

  rngSeed(seed != 0 ? seed : (dae.sdeSeed != 0 ? dae.sdeSeed : 1337));
  let dt = (tEnd - t0) / (steps as f64);
  let sqrtDt = Math.sqrt(dt);

  let mBrown = dae.sdeBrownianDim > 0 ? dae.sdeBrownianDim : nStates;
  let dWBuf = atomicChunkAlloc((mBrown as usize) << 3);
  let nextBuf = atomicChunkAlloc((nStates as usize) << 3);

  let diffCount = dae.diffusionCount;
  let diffTbl = diffCount > 0 ? dae.getDiffusionData() : changetype<ChunkedInt32Array>(0);

  // Record initial state
  store<f64>(outTimesPtr, t0);
  for (let i: u32 = 0; i < nStates; i++) {
    let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
    store<f64>(outStatesPtr + ((i as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
  }

  let t = t0;
  for (let s: u32 = 1; s <= steps; s++) {
    // Draw Brownian increments dW ~ N(0, dt)
    for (let j: u32 = 0; j < mBrown; j++) {
      store<f64>(dWBuf + ((j as usize) << 3), rngNormal() * sqrtDt);
    }

    // Drift update: y_next = y + f(t, y) * dt
    for (let i: u32 = 0; i < nStates; i++) {
      let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
      let fExpr = load<u32>(driftExprIdsPtr + ((i as usize) << 2));
      let yCur = load<f64>(valsPtr + ((vId as usize) << 3));
      let fVal = fExpr != NULL_ID ? evalExpr(fExpr, dae, valsPtr) : 0.0;
      store<f64>(nextBuf + ((i as usize) << 3), yCur + fVal * dt);
    }

    // Diffusion update: y_next[stateIdx] += g(t, y) * dW[ch]
    for (let d: u32 = 0; d < diffCount; d++) {
      let off = d * DIFF_STRIDE;
      let stVar = diffTbl.get(off + DIFF_STATE_VAR) as u32;
      let ch = diffTbl.get(off + DIFF_NOISE_CH) as u32;
      let gExpr = diffTbl.get(off + DIFF_EXPR) as u32;
      if (gExpr == NULL_ID || ch >= mBrown) continue;
      let gVal = evalExpr(gExpr, dae, valsPtr);
      let dW = load<f64>(dWBuf + ((ch as usize) << 3));
      for (let i: u32 = 0; i < nStates; i++) {
        if (load<u32>(stateVarIdsPtr + ((i as usize) << 2)) == stVar) {
          let cur = load<f64>(nextBuf + ((i as usize) << 3));
          store<f64>(nextBuf + ((i as usize) << 3), cur + gVal * dW);
          break;
        }
      }
    }

    // Commit next state
    t = t0 + (s as f64) * dt;
    store<f64>(outTimesPtr + ((s as usize) << 3), t);
    let rowOff = ((s * nStates) as usize) << 3;
    for (let i: u32 = 0; i < nStates; i++) {
      let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
      let yNext = load<f64>(nextBuf + ((i as usize) << 3));
      store<f64>(valsPtr + ((vId as usize) << 3), yNext);
      store<f64>(outStatesPtr + rowOff + ((i as usize) << 3), yNext);
    }
  }

  atomicChunkFree(nextBuf);
  atomicChunkFree(dWBuf);
  return steps + 1;
}

/**
 * Runs a full zero-GC diagonal Milstein SDE trajectory in WASM using exact forward AD
 * (`evalDualExpr`) to compute ∂g_i/∂y_i for the 0.5 * g * g' * (dW^2 - dt) correction term.
 */
export function dae_sde_runMilstein(
  daePtr: u32,
  stateVarIdsPtr: usize,
  driftExprIdsPtr: usize,
  nStates: u32,
  t0: f64,
  tEnd: f64,
  steps: u32,
  seed: u32,
  valsPtr: usize,
  outTimesPtr: usize,
  outStatesPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  if (steps == 0 || nStates == 0) return 0;

  rngSeed(seed != 0 ? seed : (dae.sdeSeed != 0 ? dae.sdeSeed : 1337));
  let dt = (tEnd - t0) / (steps as f64);
  let sqrtDt = Math.sqrt(dt);

  let vc = dae.varCount;
  let mBrown = dae.sdeBrownianDim > 0 ? dae.sdeBrownianDim : nStates;
  let dWBuf = atomicChunkAlloc((mBrown as usize) << 3);
  let nextBuf = atomicChunkAlloc((nStates as usize) << 3);
  let dualBuf = atomicChunkAlloc(((vc + 1) as usize) << 4);
  let outDualPtr = atomicChunkAlloc(16);
  let outDual = changetype<Dual>(outDualPtr);

  let diffCount = dae.diffusionCount;
  let diffTbl = diffCount > 0 ? dae.getDiffusionData() : changetype<ChunkedInt32Array>(0);

  store<f64>(outTimesPtr, t0);
  for (let i: u32 = 0; i < nStates; i++) {
    let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
    store<f64>(outStatesPtr + ((i as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
  }

  for (let s: u32 = 1; s <= steps; s++) {
    for (let j: u32 = 0; j < mBrown; j++) {
      store<f64>(dWBuf + ((j as usize) << 3), rngNormal() * sqrtDt);
    }

    // Sync dual buffer primal values
    for (let v: u32 = 0; v < vc; v++) {
      store<f64>(dualBuf + ((v as usize) << 4), load<f64>(valsPtr + ((v as usize) << 3)));
      store<f64>(dualBuf + ((v as usize) << 4) + 8, 0.0);
    }

    // Drift
    for (let i: u32 = 0; i < nStates; i++) {
      let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
      let fExpr = load<u32>(driftExprIdsPtr + ((i as usize) << 2));
      let yCur = load<f64>(valsPtr + ((vId as usize) << 3));
      let fVal = fExpr != NULL_ID ? evalExpr(fExpr, dae, valsPtr) : 0.0;
      store<f64>(nextBuf + ((i as usize) << 3), yCur + fVal * dt);
    }

    // Diffusion + Milstein correction: g * dW + 0.5 * g * (∂g/∂y) * (dW^2 - dt)
    for (let d: u32 = 0; d < diffCount; d++) {
      let off = d * DIFF_STRIDE;
      let stVar = diffTbl.get(off + DIFF_STATE_VAR) as u32;
      let ch = diffTbl.get(off + DIFF_NOISE_CH) as u32;
      let gExpr = diffTbl.get(off + DIFF_EXPR) as u32;
      if (gExpr == NULL_ID || ch >= mBrown) continue;

      store<f64>(dualBuf + ((stVar as usize) << 4) + 8, 1.0);
      evalDualExpr(gExpr, dae, dualBuf, outDual);
      store<f64>(dualBuf + ((stVar as usize) << 4) + 8, 0.0);

      let gVal = outDual.val;
      let gPrime = outDual.dot;
      let dW = load<f64>(dWBuf + ((ch as usize) << 3));
      let corr = 0.5 * gVal * gPrime * (dW * dW - dt);

      for (let i: u32 = 0; i < nStates; i++) {
        if (load<u32>(stateVarIdsPtr + ((i as usize) << 2)) == stVar) {
          let cur = load<f64>(nextBuf + ((i as usize) << 3));
          store<f64>(nextBuf + ((i as usize) << 3), cur + gVal * dW + corr);
          break;
        }
      }
    }

    let t = t0 + (s as f64) * dt;
    store<f64>(outTimesPtr + ((s as usize) << 3), t);
    let rowOff = ((s * nStates) as usize) << 3;
    for (let i: u32 = 0; i < nStates; i++) {
      let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
      let yNext = load<f64>(nextBuf + ((i as usize) << 3));
      store<f64>(valsPtr + ((vId as usize) << 3), yNext);
      store<f64>(outStatesPtr + rowOff + ((i as usize) << 3), yNext);
    }
  }

  atomicChunkFree(outDualPtr);
  atomicChunkFree(dualBuf);
  atomicChunkFree(nextBuf);
  atomicChunkFree(dWBuf);
  return steps + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. BVP Boundary Residual Kernel
// ─────────────────────────────────────────────────────────────────────────────

function evalBoundaryExpr(
  exprId: u32,
  dae: DaeBuilder,
  yaPtr: usize,
  ybPtr: usize,
  valsPtr: usize
): f64 {
  if (exprId >= dae.exprCount) return 0.0;
  let exprData = dae.getExprData();
  let off = exprId * EXPR_STRIDE;
  let kind = exprData.get(off + EXPR_KIND);

  if (kind == ExprKind.AtBoundary) {
    let varId = exprData.get(off + EXPR_DATA1) as u32;
    let bIdx = exprData.get(off + EXPR_LEFT) as u32;
    if (bIdx == 0) return load<f64>(yaPtr + ((varId as usize) << 3));
    return load<f64>(ybPtr + ((varId as usize) << 3));
  }
  if (kind == ExprKind.RealLiteral) {
    let lo = (exprData.get(off + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (exprData.get(off + EXPR_LEFT) as u64) << 32;
    return f64.reinterpret_i64((hi | lo) as i64);
  }
  if (kind == ExprKind.IntLiteral || kind == ExprKind.BoolLiteral) {
    return exprData.get(off + EXPR_DATA1) as f64;
  }
  if (kind == ExprKind.Name) {
    let varId = exprData.get(off + EXPR_LEFT) as u32;
    if (varId != NULL_ID && varId < dae.varCount) {
      return load<f64>(valsPtr + ((varId as usize) << 3));
    }
    return evalExpr(exprId, dae, valsPtr);
  }
  if (kind == ExprKind.Negate) {
    return -evalBoundaryExpr(exprData.get(off + EXPR_LEFT) as u32, dae, yaPtr, ybPtr, valsPtr);
  }
  if (kind == ExprKind.Unary) {
    let op = exprData.get(off + EXPR_DATA1);
    let v = evalBoundaryExpr(exprData.get(off + EXPR_LEFT) as u32, dae, yaPtr, ybPtr, valsPtr);
    return op == UnaryOp.Not ? (v == 0.0 ? 1.0 : 0.0) : -v;
  }
  if (kind == ExprKind.Binary) {
    let op = exprData.get(off + EXPR_DATA1);
    let l = evalBoundaryExpr(exprData.get(off + EXPR_LEFT) as u32, dae, yaPtr, ybPtr, valsPtr);
    let r = evalBoundaryExpr(exprData.get(off + EXPR_RIGHT) as u32, dae, yaPtr, ybPtr, valsPtr);
    if (op == BinOp.Add || op == BinOp.ElemAdd) return l + r;
    if (op == BinOp.Sub || op == BinOp.ElemSub) return l - r;
    if (op == BinOp.Mul || op == BinOp.ElemMul) return l * r;
    if (op == BinOp.Div || op == BinOp.ElemDiv) return l / r;
    if (op == BinOp.Pow || op == BinOp.ElemPow) return Math.pow(l, r);
    return 0.0;
  }
  return evalExpr(exprId, dae, valsPtr);
}

/**
 * Evaluates all `EqKind.Boundary` equations (`lhs - rhs = 0`) using `yaPtr` (values at t0)
 * and `ybPtr` (values at tf), indexed by `varId`. Writes residuals to `outResPtr`.
 */
export function dae_bvp_evalBoundaryResiduals(
  daePtr: u32,
  yaPtr: usize,
  ybPtr: usize,
  valsPtr: usize,
  outResPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let eqCount = dae.eqCount;
  let eqData = dae.getEqData();
  let bcCount: u32 = 0;
  for (let i: u32 = 0; i < eqCount; i++) {
    let off = i * EQ_STRIDE;
    if (eqData.get(off + EQ_KIND) == EqKind.Boundary) {
      let lhsId = eqData.get(off + EQ_LHS) as u32;
      let rhsId = eqData.get(off + EQ_RHS) as u32;
      let l = evalBoundaryExpr(lhsId, dae, yaPtr, ybPtr, valsPtr);
      let r = evalBoundaryExpr(rhsId, dae, yaPtr, ybPtr, valsPtr);
      store<f64>(outResPtr + ((bcCount as usize) << 3), l - r);
      bcCount++;
    }
  }
  return bcCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DDE Delay Channel Evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates a delay channel's current lag τ(t, y) and history value (when t - τ <= t0).
 */
export function dae_delay_evalTau(daePtr: u32, channelIdx: u32, valsPtr: usize): f64 {
  let dae = changetype<DaeBuilder>(daePtr);
  if (channelIdx >= dae.delayCount) return 0.0;
  let tauExpr = dae.getDelayData().get(channelIdx * DELAY_STRIDE + DELAY_TAU_EXPR) as u32;
  return tauExpr != NULL_ID ? evalExpr(tauExpr, dae, valsPtr) : 0.0;
}

export function dae_delay_evalHistory(daePtr: u32, channelIdx: u32, valsPtr: usize): f64 {
  let dae = changetype<DaeBuilder>(daePtr);
  if (channelIdx >= dae.delayCount) return 0.0;
  let histExpr = dae.getDelayData().get(channelIdx * DELAY_STRIDE + DELAY_HISTORY_EXPR) as u32;
  if (histExpr != NULL_ID) return evalExpr(histExpr, dae, valsPtr);
  let targetExpr = dae.getDelayData().get(channelIdx * DELAY_STRIDE + DELAY_TARGET_EXPR) as u32;
  return targetExpr != NULL_ID ? evalExpr(targetExpr, dae, valsPtr) : 0.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Jump Process / Gillespie Direct SSA Kernel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates all jump propensities into `outPropPtr` and returns the total propensity a_0.
 */
export function dae_jump_evalPropensities(daePtr: u32, valsPtr: usize, outPropPtr: usize): f64 {
  let dae = changetype<DaeBuilder>(daePtr);
  let count = dae.jumpCount;
  if (count == 0) return 0.0;
  let tbl = dae.getJumpData();
  let total: f64 = 0.0;
  for (let i: u32 = 0; i < count; i++) {
    let pExpr = tbl.get(i * JUMP_STRIDE + JUMP_PROPENSITY_EXPR) as u32;
    let rate = pExpr != NULL_ID ? evalExpr(pExpr, dae, valsPtr) : 0.0;
    if (rate < 0.0) rate = 0.0;
    store<f64>(outPropPtr + ((i as usize) << 3), rate);
    total += rate;
  }
  return total;
}

/**
 * Runs a full zero-GC Gillespie Direct Method SSA simulation in WASM linear memory.
 * Updates `valsPtr` in place and records event times & fired jump indices up to `maxEvents`.
 * Returns number of recorded snapshots (including initial state at index 0).
 */
export function dae_jump_runGillespie(
  daePtr: u32,
  trackedVarIdsPtr: usize,
  nTracked: u32,
  t0: f64,
  tEnd: f64,
  maxEvents: u32,
  seed: u32,
  valsPtr: usize,
  outTimesPtr: usize,
  outStatesPtr: usize,
  outJumpIdsPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let nJumps = dae.jumpCount;
  if (nJumps == 0 || maxEvents == 0) return 0;

  rngSeed(seed != 0 ? seed : 42);
  let propBuf = atomicChunkAlloc((nJumps as usize) << 3);
  let jumpTbl = dae.getJumpData();
  let affTbl = dae.getJumpAffects();

  let t = t0;
  let recIdx: u32 = 0;

  // Record initial state
  store<f64>(outTimesPtr, t);
  store<i32>(outJumpIdsPtr, -1);
  for (let k: u32 = 0; k < nTracked; k++) {
    let vId = load<u32>(trackedVarIdsPtr + ((k as usize) << 2));
    store<f64>(outStatesPtr + ((k as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
  }
  recIdx = 1;

  while (t < tEnd && recIdx < maxEvents) {
    let a0 = dae_jump_evalPropensities(daePtr, valsPtr, propBuf);
    if (a0 <= 1e-15) break;

    let r1 = rngUniform();
    let tau = -Math.log(r1) / a0;
    if (t + tau > tEnd) break;
    t += tau;

    // Select reaction j
    let threshold = rngUniform() * a0;
    let cumSum: f64 = 0.0;
    let chosen: u32 = nJumps - 1;
    for (let j: u32 = 0; j < nJumps; j++) {
      cumSum += load<f64>(propBuf + ((j as usize) << 3));
      if (cumSum >= threshold) {
        chosen = j;
        break;
      }
    }

    // Apply stoichiometry / affects
    let jOff = chosen * JUMP_STRIDE;
    let affStart = jumpTbl.get(jOff + JUMP_AFFECT_START) as u32;
    let affCount = jumpTbl.get(jOff + JUMP_AFFECT_COUNT) as u32;
    for (let a: u32 = 0; a < affCount; a++) {
      let aOff = (affStart + a) * AFFECT_STRIDE;
      let targetVar = affTbl.get(aOff + AFFECT_VAR) as u32;
      let deltaExpr = affTbl.get(aOff + AFFECT_EXPR) as u32;
      let mode = affTbl.get(aOff + AFFECT_MODE);
      let deltaVal = deltaExpr != NULL_ID ? evalExpr(deltaExpr, dae, valsPtr) : 0.0;
      let vPtr = valsPtr + ((targetVar as usize) << 3);
      if (mode == JumpAffectMode.Assign) {
        store<f64>(vPtr, deltaVal);
      } else {
        store<f64>(vPtr, load<f64>(vPtr) + deltaVal);
      }
    }

    // Record snapshot
    store<f64>(outTimesPtr + ((recIdx as usize) << 3), t);
    store<i32>(outJumpIdsPtr + ((recIdx as usize) << 2), chosen as i32);
    let rowOff = ((recIdx * nTracked) as usize) << 3;
    for (let k: u32 = 0; k < nTracked; k++) {
      let vId = load<u32>(trackedVarIdsPtr + ((k as usize) << 2));
      store<f64>(outStatesPtr + rowOff + ((k as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
    }
    recIdx++;
  }

  atomicChunkFree(propBuf);
  return recIdx;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. STL Quantitative Robustness & Hybrid State Invariant Kernels
// ─────────────────────────────────────────────────────────────────────────────

function evalStlNodeAtTime(
  dae: DaeBuilder,
  nodeIdx: u32,
  timeIdx: u32,
  timesPtr: usize,
  trajPtr: usize,
  numTimes: u32,
  varCount: u32
): f64 {
  if (nodeIdx >= dae.stlCount || timeIdx >= numTimes) return 0.0;
  let tbl = dae.getStlData();
  let off = nodeIdx * STL_STRIDE;
  let op = tbl.get(off + STL_OP);
  let leftId = tbl.get(off + STL_LEFT) as u32;
  let rightId = tbl.get(off + STL_RIGHT) as u32;

  if (op == StlOp.Atomic) {
    let rowPtr = trajPtr + (((timeIdx * varCount) as usize) << 3);
    return evalExpr(leftId, dae, rowPtr);
  }
  if (op == StlOp.Not) {
    return -evalStlNodeAtTime(dae, leftId, timeIdx, timesPtr, trajPtr, numTimes, varCount);
  }
  if (op == StlOp.And) {
    let a = evalStlNodeAtTime(dae, leftId, timeIdx, timesPtr, trajPtr, numTimes, varCount);
    let b = evalStlNodeAtTime(dae, rightId, timeIdx, timesPtr, trajPtr, numTimes, varCount);
    return a < b ? a : b;
  }
  if (op == StlOp.Or) {
    let a = evalStlNodeAtTime(dae, leftId, timeIdx, timesPtr, trajPtr, numTimes, varCount);
    let b = evalStlNodeAtTime(dae, rightId, timeIdx, timesPtr, trajPtr, numTimes, varCount);
    return a > b ? a : b;
  }

  let tNow = load<f64>(timesPtr + ((timeIdx as usize) << 3));
  let tLo = tNow + unpackF64(tbl.get(off + STL_TLO_HI), tbl.get(off + STL_TLO_LO));
  let tHi = tNow + unpackF64(tbl.get(off + STL_THI_HI), tbl.get(off + STL_THI_LO));

  if (op == StlOp.Always) {
    let minVal: f64 = 1e300;
    let found = false;
    for (let k: u32 = timeIdx; k < numTimes; k++) {
      let tk = load<f64>(timesPtr + ((k as usize) << 3));
      if (tk < tLo - 1e-12) continue;
      if (tk > tHi + 1e-12) break;
      let v = evalStlNodeAtTime(dae, leftId, k, timesPtr, trajPtr, numTimes, varCount);
      if (v < minVal) minVal = v;
      found = true;
    }
    return found ? minVal : 0.0;
  }
  if (op == StlOp.Eventually) {
    let maxVal: f64 = -1e300;
    let found = false;
    for (let k: u32 = timeIdx; k < numTimes; k++) {
      let tk = load<f64>(timesPtr + ((k as usize) << 3));
      if (tk < tLo - 1e-12) continue;
      if (tk > tHi + 1e-12) break;
      let v = evalStlNodeAtTime(dae, leftId, k, timesPtr, trajPtr, numTimes, varCount);
      if (v > maxVal) maxVal = v;
      found = true;
    }
    return found ? maxVal : 0.0;
  }
  if (op == StlOp.Until) {
    let best: f64 = -1e300;
    let found = false;
    let prefixMin: f64 = 1e300;
    for (let k: u32 = timeIdx; k < numTimes; k++) {
      let tk = load<f64>(timesPtr + ((k as usize) << 3));
      let vLeft = evalStlNodeAtTime(dae, leftId, k, timesPtr, trajPtr, numTimes, varCount);
      if (vLeft < prefixMin) prefixMin = vLeft;
      if (tk < tLo - 1e-12) continue;
      if (tk > tHi + 1e-12) break;
      let vRight = evalStlNodeAtTime(dae, rightId, k, timesPtr, trajPtr, numTimes, varCount);
      let cand = vRight < prefixMin ? vRight : prefixMin;
      if (cand > best) best = cand;
      found = true;
    }
    return found ? best : 0.0;
  }
  return 0.0;
}

/**
 * Evaluates quantitative STL robustness of `rootStlIdx` at `t = times[0]` over a trajectory.
 */
export function dae_stl_evalTrajectoryRobustness(
  daePtr: u32,
  rootStlIdx: u32,
  timesPtr: usize,
  trajPtr: usize,
  numTimes: u32,
  varCount: u32
): f64 {
  let dae = changetype<DaeBuilder>(daePtr);
  return evalStlNodeAtTime(dae, rootStlIdx, 0, timesPtr, trajPtr, numTimes, varCount);
}

/**
 * Returns the minimum safety margin across all state invariants for `stateId`
 * (positive = inside all bounds, negative = violated).
 */
export function dae_inv_checkStateMargin(daePtr: u32, stateId: u32, valsPtr: usize): f64 {
  let dae = changetype<DaeBuilder>(daePtr);
  let count = dae.stateInvariantCount;
  if (count == 0) return 1e300;
  let tbl = dae.getStateInvariants();
  let minMargin: f64 = 1e300;
  for (let i: u32 = 0; i < count; i++) {
    let off = i * INV_STRIDE;
    if ((tbl.get(off + INV_STATE) as u32) != stateId) continue;
    let varId = tbl.get(off + INV_VAR) as u32;
    let lo = unpackF64(tbl.get(off + INV_LO_HI), tbl.get(off + INV_LO_LO));
    let hi = unpackF64(tbl.get(off + INV_HI_HI), tbl.get(off + INV_HI_LO));
    let val = load<f64>(valsPtr + ((varId as usize) << 3));
    let mLo = val - lo;
    let mHi = hi - val;
    if (mLo < minMargin) minMargin = mLo;
    if (mHi < minMargin) minMargin = mHi;
  }
  return minMargin;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Batched SDE Ensemble, Jump Tau-Leaping & Uncertainty Interval Evaluation
// ─────────────────────────────────────────────────────────────────────────────

@inline
function samplePoisson(lambda: f64): i32 {
  if (lambda <= 0.0) return 0;
  if (lambda < 30.0) {
    let L = Math.exp(-lambda);
    let k: i32 = 0;
    let p: f64 = 1.0;
    do {
      k++;
      p *= rngUniform();
    } while (p > L && k < 10000);
    return k - 1;
  }
  // Normal approximation for large lambda
  let z = Math.round(lambda + Math.sqrt(lambda) * rngNormal());
  return z > 0.0 ? (z as i32) : 0;
}

/**
 * Runs `numPaths` independent SDE trajectories in WASM linear memory using Milstein
 * (`useMilstein = true`) or Euler-Maruyama (`useMilstein = false`) and computes online
 * Welford mean (`outMeanPtr`) and variance (`outVarPtr`) at every step `(steps + 1) * nStates`.
 */
export function dae_sde_runEnsemble(
  daePtr: u32,
  stateVarIdsPtr: usize,
  driftExprIdsPtr: usize,
  nStates: u32,
  t0: f64,
  tEnd: f64,
  steps: u32,
  numPaths: u32,
  baseSeed: u32,
  useMilstein: bool,
  initValsPtr: usize,
  outTimesPtr: usize,
  outMeanPtr: usize,
  outVarPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  if (numPaths == 0 || steps == 0 || nStates == 0) return 0;
  let vc = dae.varCount;
  let totalElems = (steps + 1) * nStates;

  // Zero mean and M2 accumulators
  for (let i: u32 = 0; i < totalElems; i++) {
    store<f64>(outMeanPtr + ((i as usize) << 3), 0.0);
    store<f64>(outVarPtr + ((i as usize) << 3), 0.0);
  }

  let scratchVals = atomicChunkAlloc((vc as usize) << 3);
  let pathStates = atomicChunkAlloc((totalElems as usize) << 3);

  for (let p: u32 = 0; p < numPaths; p++) {
    for (let v: u32 = 0; v < vc; v++) {
      store<f64>(scratchVals + ((v as usize) << 3), load<f64>(initValsPtr + ((v as usize) << 3)));
    }
    let pathSeed = baseSeed + p * 7919 + 1;
    if (useMilstein) {
      dae_sde_runMilstein(daePtr, stateVarIdsPtr, driftExprIdsPtr, nStates, t0, tEnd, steps, pathSeed, scratchVals, outTimesPtr, pathStates);
    } else {
      dae_sde_runEulerMaruyama(daePtr, stateVarIdsPtr, driftExprIdsPtr, nStates, t0, tEnd, steps, pathSeed, scratchVals, outTimesPtr, pathStates);
    }

    let invN = 1.0 / ((p + 1) as f64);
    for (let i: u32 = 0; i < totalElems; i++) {
      let off = (i as usize) << 3;
      let x = load<f64>(pathStates + off);
      let mean = load<f64>(outMeanPtr + off);
      let delta = x - mean;
      let newMean = mean + delta * invN;
      let delta2 = x - newMean;
      store<f64>(outMeanPtr + off, newMean);
      store<f64>(outVarPtr + off, load<f64>(outVarPtr + off) + delta * delta2);
    }
  }

  if (numPaths > 1) {
    let invNm1 = 1.0 / ((numPaths - 1) as f64);
    for (let i: u32 = 0; i < totalElems; i++) {
      let off = (i as usize) << 3;
      store<f64>(outVarPtr + off, load<f64>(outVarPtr + off) * invNm1);
    }
  }

  atomicChunkFree(pathStates);
  atomicChunkFree(scratchVals);
  return steps + 1;
}

/**
 * Runs a fast Poisson Tau-Leaping SSA simulation in WASM linear memory with fixed step `tau`.
 */
export function dae_jump_runTauLeaping(
  daePtr: u32,
  trackedVarIdsPtr: usize,
  nTracked: u32,
  t0: f64,
  tEnd: f64,
  steps: u32,
  seed: u32,
  valsPtr: usize,
  outTimesPtr: usize,
  outStatesPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let nJumps = dae.jumpCount;
  if (nJumps == 0 || steps == 0 || nTracked == 0) return 0;

  rngSeed(seed != 0 ? seed : 42);
  let dt = (tEnd - t0) / (steps as f64);
  let propBuf = atomicChunkAlloc((nJumps as usize) << 3);
  let jumpTbl = dae.getJumpData();
  let affTbl = dae.getJumpAffects();

  store<f64>(outTimesPtr, t0);
  for (let k: u32 = 0; k < nTracked; k++) {
    let vId = load<u32>(trackedVarIdsPtr + ((k as usize) << 2));
    store<f64>(outStatesPtr + ((k as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
  }

  for (let s: u32 = 1; s <= steps; s++) {
    dae_jump_evalPropensities(daePtr, valsPtr, propBuf);
    for (let j: u32 = 0; j < nJumps; j++) {
      let rate = load<f64>(propBuf + ((j as usize) << 3));
      let kFires = samplePoisson(rate * dt);
      if (kFires <= 0) continue;

      let jOff = j * JUMP_STRIDE;
      let affStart = jumpTbl.get(jOff + JUMP_AFFECT_START) as u32;
      let affCount = jumpTbl.get(jOff + JUMP_AFFECT_COUNT) as u32;
      for (let a: u32 = 0; a < affCount; a++) {
        let aOff = (affStart + a) * AFFECT_STRIDE;
        let targetVar = affTbl.get(aOff + AFFECT_VAR) as u32;
        let deltaExpr = affTbl.get(aOff + AFFECT_EXPR) as u32;
        let mode = affTbl.get(aOff + AFFECT_MODE);
        let deltaVal = deltaExpr != NULL_ID ? evalExpr(deltaExpr, dae, valsPtr) : 0.0;
        let vPtr = valsPtr + ((targetVar as usize) << 3);
        if (mode == JumpAffectMode.Assign) {
          store<f64>(vPtr, deltaVal);
        } else {
          let nextVal = load<f64>(vPtr) + deltaVal * (kFires as f64);
          store<f64>(vPtr, nextVal < 0.0 ? 0.0 : nextVal);
        }
      }
    }

    store<f64>(outTimesPtr + ((s as usize) << 3), t0 + (s as f64) * dt);
    let rowOff = ((s * nTracked) as usize) << 3;
    for (let k: u32 = 0; k < nTracked; k++) {
      let vId = load<u32>(trackedVarIdsPtr + ((k as usize) << 2));
      store<f64>(outStatesPtr + rowOff + ((k as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
    }
  }

  atomicChunkFree(propBuf);
  return steps + 1;
}

/**
 * Evaluates an arena expression over the interval enclosures declared in `uncertaintyData`
 * (using `nominalValsPtr` for deterministic variables), returning `[lo, hi]` into `outLoPtr`/`outHiPtr`.
 */
export function dae_unc_evalExprInterval(
  daePtr: u32,
  exprId: u32,
  nominalValsPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let vc = dae.varCount;
  let loBuf = atomicChunkAlloc((vc as usize) << 3);
  let hiBuf = atomicChunkAlloc((vc as usize) << 3);
  for (let v: u32 = 0; v < vc; v++) {
    let nom = load<f64>(nominalValsPtr + ((v as usize) << 3));
    store<f64>(loBuf + ((v as usize) << 3), nom);
    store<f64>(hiBuf + ((v as usize) << 3), nom);
  }
  let uCount = dae.uncertaintyCount;
  if (uCount > 0) {
    let tbl = dae.getUncertaintyData();
    for (let i: u32 = 0; i < uCount; i++) {
      let off = i * UNC_STRIDE;
      let vId = tbl.get(off + UNC_VAR) as u32;
      if (vId >= vc) continue;
      let dist = tbl.get(off + UNC_DIST_KIND);
      let p1 = unpackF64(tbl.get(off + UNC_P1_HI), tbl.get(off + UNC_P1_LO));
      let p2 = unpackF64(tbl.get(off + UNC_P2_HI), tbl.get(off + UNC_P2_LO));
      let lo = p1;
      let hi = p2;
      if (dist == UncertaintyDistKind.Normal) {
        // 3-sigma enclosure for Normal(mean=p1, std=p2)
        lo = p1 - 3.0 * p2;
        hi = p1 + 3.0 * p2;
      }
      store<f64>(loBuf + ((vId as usize) << 3), lo);
      store<f64>(hiBuf + ((vId as usize) << 3), hi);
    }
  }
  let mask = dae_evalExprInterval(daePtr, exprId, loBuf, hiBuf, outLoPtr, outHiPtr, 0, 0);
  atomicChunkFree(hiBuf);
  atomicChunkFree(loBuf);
  return mask;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Advanced WASM Kernels: Sparse AD Jacobian, SRIW1 SDE & Hybrid ODE+SSA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates sparse constraint Jacobian in COO triplet format `(outRowsPtr, outColsPtr, outValsPtr)`
 * via exact forward-mode AD, skipping structurally/numerically zero entries (`|d| <= tol`).
 * Returns number of non-zero triplets written (capped at `maxNnz`).
 */
export function dae_opt_evalConstraintJacobianSparse(
  daePtr: u32,
  valsPtr: usize,
  varIdsPtr: usize,
  nVars: u32,
  tol: f64,
  outRowsPtr: usize,
  outColsPtr: usize,
  outValsPtr: usize,
  maxNnz: u32
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let m = dae.constraintCount;
  if (m == 0 || nVars == 0 || maxNnz == 0) return 0;

  let vc = dae.varCount;
  let dualBuf = atomicChunkAlloc(((vc + 1) as usize) << 4);
  let outDualPtr = atomicChunkAlloc(16);
  let outDual = changetype<Dual>(outDualPtr);
  let tbl = dae.getConstraintsData();

  for (let v: u32 = 0; v < vc; v++) {
    store<f64>(dualBuf + ((v as usize) << 4), load<f64>(valsPtr + ((v as usize) << 3)));
    store<f64>(dualBuf + ((v as usize) << 4) + 8, 0.0);
  }

  let nnz: u32 = 0;
  for (let k: u32 = 0; k < nVars; k++) {
    let targetVar = load<u32>(varIdsPtr + ((k as usize) << 2));
    store<f64>(dualBuf + ((targetVar as usize) << 4) + 8, 1.0);
    for (let i: u32 = 0; i < m; i++) {
      let exprId = tbl.get(i * CON_STRIDE + CON_EXPR) as u32;
      if (exprId == NULL_ID) continue;
      evalDualExpr(exprId, dae, dualBuf, outDual);
      let d = outDual.dot;
      if (Math.abs(d) > tol && nnz < maxNnz) {
        store<u32>(outRowsPtr + ((nnz as usize) << 2), i);
        store<u32>(outColsPtr + ((nnz as usize) << 2), k);
        store<f64>(outValsPtr + ((nnz as usize) << 3), d);
        nnz++;
      }
    }
    store<f64>(dualBuf + ((targetVar as usize) << 4) + 8, 0.0);
  }

  atomicChunkFree(outDualPtr);
  atomicChunkFree(dualBuf);
  return nnz;
}

/**
 * Runs a strong-order-1.5 Rossler SRIW1 diagonal SDE trajectory in WASM linear memory.
 */
export function dae_sde_runSRIW1(
  daePtr: u32,
  stateVarIdsPtr: usize,
  driftExprIdsPtr: usize,
  nStates: u32,
  t0: f64,
  tEnd: f64,
  steps: u32,
  seed: u32,
  valsPtr: usize,
  outTimesPtr: usize,
  outStatesPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  if (steps == 0 || nStates == 0) return 0;

  rngSeed(seed != 0 ? seed : (dae.sdeSeed != 0 ? dae.sdeSeed : 1337));
  let h = (tEnd - t0) / (steps as f64);
  let sqrtH = Math.sqrt(h);
  let h32 = h * sqrtH;
  let invSqrt3: f64 = 0.5773502691896257;

  let diffCount = dae.diffusionCount;
  let diffTbl = diffCount > 0 ? dae.getDiffusionData() : changetype<ChunkedInt32Array>(0);
  let gExprByState = atomicChunkAlloc((nStates as usize) << 2);
  for (let i: u32 = 0; i < nStates; i++) {
    store<u32>(gExprByState + ((i as usize) << 2), NULL_ID);
    let stVar = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
    for (let d: u32 = 0; d < diffCount; d++) {
      if ((diffTbl.get(d * DIFF_STRIDE + DIFF_STATE_VAR) as u32) == stVar) {
        store<u32>(gExprByState + ((i as usize) << 2), diffTbl.get(d * DIFF_STRIDE + DIFF_EXPR) as u32);
        break;
      }
    }
  }

  let y0Buf = atomicChunkAlloc((nStates as usize) << 3);
  let f1Buf = atomicChunkAlloc((nStates as usize) << 3);
  let f2Buf = atomicChunkAlloc((nStates as usize) << 3);
  let g1Buf = atomicChunkAlloc((nStates as usize) << 3);
  let g2Buf = atomicChunkAlloc((nStates as usize) << 3);
  let g3Buf = atomicChunkAlloc((nStates as usize) << 3);
  let I1Buf = atomicChunkAlloc((nStates as usize) << 3);
  let I10Buf = atomicChunkAlloc((nStates as usize) << 3);

  store<f64>(outTimesPtr, t0);
  for (let i: u32 = 0; i < nStates; i++) {
    let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
    store<f64>(outStatesPtr + ((i as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
  }

  for (let s: u32 = 1; s <= steps; s++) {
    // Save y0 and evaluate f1, g1
    for (let i: u32 = 0; i < nStates; i++) {
      let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
      let yv = load<f64>(valsPtr + ((vId as usize) << 3));
      store<f64>(y0Buf + ((i as usize) << 3), yv);
      let z1 = rngNormal();
      let z2 = rngNormal();
      store<f64>(I1Buf + ((i as usize) << 3), sqrtH * z1);
      store<f64>(I10Buf + ((i as usize) << 3), 0.5 * h32 * (z1 + invSqrt3 * z2));
    }
    for (let i: u32 = 0; i < nStates; i++) {
      let fId = load<u32>(driftExprIdsPtr + ((i as usize) << 2));
      let gId = load<u32>(gExprByState + ((i as usize) << 2));
      store<f64>(f1Buf + ((i as usize) << 3), fId != NULL_ID ? evalExpr(fId, dae, valsPtr) : 0.0);
      store<f64>(g1Buf + ((i as usize) << 3), gId != NULL_ID ? evalExpr(gId, dae, valsPtr) : 0.0);
    }

    // Stage 2: y_s2 = y0 + h*f1 + sqrt(h)*g1
    for (let i: u32 = 0; i < nStates; i++) {
      let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
      let y0 = load<f64>(y0Buf + ((i as usize) << 3));
      let f1 = load<f64>(f1Buf + ((i as usize) << 3));
      let g1 = load<f64>(g1Buf + ((i as usize) << 3));
      store<f64>(valsPtr + ((vId as usize) << 3), y0 + h * f1 + sqrtH * g1);
    }
    for (let i: u32 = 0; i < nStates; i++) {
      let fId = load<u32>(driftExprIdsPtr + ((i as usize) << 2));
      let gId = load<u32>(gExprByState + ((i as usize) << 2));
      store<f64>(f2Buf + ((i as usize) << 3), fId != NULL_ID ? evalExpr(fId, dae, valsPtr) : 0.0);
      store<f64>(g2Buf + ((i as usize) << 3), gId != NULL_ID ? evalExpr(gId, dae, valsPtr) : 0.0);
    }

    // Stage 3: y_s3 = y0 + h*f1 - sqrt(h)*g1
    for (let i: u32 = 0; i < nStates; i++) {
      let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
      let y0 = load<f64>(y0Buf + ((i as usize) << 3));
      let f1 = load<f64>(f1Buf + ((i as usize) << 3));
      let g1 = load<f64>(g1Buf + ((i as usize) << 3));
      store<f64>(valsPtr + ((vId as usize) << 3), y0 + h * f1 - sqrtH * g1);
    }
    for (let i: u32 = 0; i < nStates; i++) {
      let gId = load<u32>(gExprByState + ((i as usize) << 2));
      store<f64>(g3Buf + ((i as usize) << 3), gId != NULL_ID ? evalExpr(gId, dae, valsPtr) : 0.0);
    }

    // Combine strong-order-1.5 update
    let t = t0 + (s as f64) * h;
    store<f64>(outTimesPtr + ((s as usize) << 3), t);
    let rowOff = ((s * nStates) as usize) << 3;
    for (let i: u32 = 0; i < nStates; i++) {
      let vId = load<u32>(stateVarIdsPtr + ((i as usize) << 2));
      let y0 = load<f64>(y0Buf + ((i as usize) << 3));
      let f1 = load<f64>(f1Buf + ((i as usize) << 3));
      let f2 = load<f64>(f2Buf + ((i as usize) << 3));
      let g1 = load<f64>(g1Buf + ((i as usize) << 3));
      let g2 = load<f64>(g2Buf + ((i as usize) << 3));
      let g3 = load<f64>(g3Buf + ((i as usize) << 3));
      let I1 = load<f64>(I1Buf + ((i as usize) << 3));
      let I10 = load<f64>(I10Buf + ((i as usize) << 3));

      let driftStep = 0.5 * h * (f1 + f2);
      let diffStep = g1 * I1 + (0.25 / sqrtH) * (g2 - g3) * (I1 * I1 - h) + ((f2 - f1) / h) * (I10 - 0.5 * h * I1);
      let yNext = y0 + driftStep + diffStep;
      store<f64>(valsPtr + ((vId as usize) << 3), yNext);
      store<f64>(outStatesPtr + rowOff + ((i as usize) << 3), yNext);
    }
  }

  atomicChunkFree(I10Buf);
  atomicChunkFree(I1Buf);
  atomicChunkFree(g3Buf);
  atomicChunkFree(g2Buf);
  atomicChunkFree(g1Buf);
  atomicChunkFree(f2Buf);
  atomicChunkFree(f1Buf);
  atomicChunkFree(y0Buf);
  atomicChunkFree(gExprByState);
  return steps + 1;
}

/**
 * Coupled Hybrid ODE + SSA (Jump) stepper in WASM linear memory:
 * Advances continuous states via RK2 midpoint steps while firing discrete jumps
 * via integrated propensity hazard (Next-Reaction / thinning) inside each sub-interval.
 */
export function dae_jump_runHybridOdeSsa(
  daePtr: u32,
  odeStateVarIdsPtr: usize,
  odeDriftExprIdsPtr: usize,
  nOdeStates: u32,
  trackedVarIdsPtr: usize,
  nTracked: u32,
  t0: f64,
  tEnd: f64,
  steps: u32,
  seed: u32,
  valsPtr: usize,
  outTimesPtr: usize,
  outStatesPtr: usize
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  if (steps == 0 || nTracked == 0) return 0;

  rngSeed(seed != 0 ? seed : 42);
  let dt = (tEnd - t0) / (steps as f64);
  let nJumps = dae.jumpCount;
  let propBuf = nJumps > 0 ? atomicChunkAlloc((nJumps as usize) << 3) : 0;
  let k1Buf = nOdeStates > 0 ? atomicChunkAlloc((nOdeStates as usize) << 3) : 0;
  let jumpTbl = nJumps > 0 ? dae.getJumpData() : changetype<ChunkedInt32Array>(0);
  let affTbl = nJumps > 0 ? dae.getJumpAffects() : changetype<ChunkedInt32Array>(0);

  // Integrated hazard threshold ~ Exp(1)
  let nextJumpHazard = -Math.log(rngUniform());
  let accumHazard: f64 = 0.0;

  store<f64>(outTimesPtr, t0);
  for (let k: u32 = 0; k < nTracked; k++) {
    let vId = load<u32>(trackedVarIdsPtr + ((k as usize) << 2));
    store<f64>(outStatesPtr + ((k as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
  }

  for (let s: u32 = 1; s <= steps; s++) {
    // 1. Advance continuous ODE states by dt (explicit Euler/midpoint)
    for (let i: u32 = 0; i < nOdeStates; i++) {
      let fId = load<u32>(odeDriftExprIdsPtr + ((i as usize) << 2));
      store<f64>(k1Buf + ((i as usize) << 3), fId != NULL_ID ? evalExpr(fId, dae, valsPtr) : 0.0);
    }
    for (let i: u32 = 0; i < nOdeStates; i++) {
      let vId = load<u32>(odeStateVarIdsPtr + ((i as usize) << 2));
      let y = load<f64>(valsPtr + ((vId as usize) << 3));
      let k1 = load<f64>(k1Buf + ((i as usize) << 3));
      store<f64>(valsPtr + ((vId as usize) << 3), y + dt * k1);
    }

    // 2. Accumulate discrete jump hazard and fire reactions when threshold crossed
    if (nJumps > 0) {
      let a0 = dae_jump_evalPropensities(daePtr, valsPtr, propBuf);
      accumHazard += a0 * dt;
      let guard: u32 = 0;
      while (accumHazard >= nextJumpHazard && a0 > 1e-15 && guard < 16) {
        accumHazard -= nextJumpHazard;
        nextJumpHazard = -Math.log(rngUniform());
        guard++;

        let thr = rngUniform() * a0;
        let cum: f64 = 0.0;
        let chosen: u32 = nJumps - 1;
        for (let j: u32 = 0; j < nJumps; j++) {
          cum += load<f64>(propBuf + ((j as usize) << 3));
          if (cum >= thr) { chosen = j; break; }
        }
        let jOff = chosen * JUMP_STRIDE;
        let affStart = jumpTbl.get(jOff + JUMP_AFFECT_START) as u32;
        let affCount = jumpTbl.get(jOff + JUMP_AFFECT_COUNT) as u32;
        for (let a: u32 = 0; a < affCount; a++) {
          let aOff = (affStart + a) * AFFECT_STRIDE;
          let targetVar = affTbl.get(aOff + AFFECT_VAR) as u32;
          let deltaExpr = affTbl.get(aOff + AFFECT_EXPR) as u32;
          let mode = affTbl.get(aOff + AFFECT_MODE);
          let deltaVal = deltaExpr != NULL_ID ? evalExpr(deltaExpr, dae, valsPtr) : 0.0;
          let vPtr = valsPtr + ((targetVar as usize) << 3);
          if (mode == JumpAffectMode.Assign) {
            store<f64>(vPtr, deltaVal);
          } else {
            store<f64>(vPtr, load<f64>(vPtr) + deltaVal);
          }
        }
        a0 = dae_jump_evalPropensities(daePtr, valsPtr, propBuf);
      }
    }

    store<f64>(outTimesPtr + ((s as usize) << 3), t0 + (s as f64) * dt);
    let rowOff = ((s * nTracked) as usize) << 3;
    for (let k: u32 = 0; k < nTracked; k++) {
      let vId = load<u32>(trackedVarIdsPtr + ((k as usize) << 2));
      store<f64>(outStatesPtr + rowOff + ((k as usize) << 3), load<f64>(valsPtr + ((vId as usize) << 3)));
    }
  }

  if (k1Buf != 0) atomicChunkFree(k1Buf);
  if (propBuf != 0) atomicChunkFree(propBuf);
  return steps + 1;
}


