// SPDX-License-Identifier: AGPL-3.0-or-later

import { DaeBuilder } from "../dae/builder";
import { evalExpr } from "../dae/eval";
import { UnmanagedFloat64Array, UnmanagedUint8Array } from "../core/array";

export const VERIFY_OP_LT: u32 = 0;   // <
export const VERIFY_OP_LTE: u32 = 1;  // <=
export const VERIFY_OP_EQ: u32 = 2;   // ==
export const VERIFY_OP_GTE: u32 = 3;  // >=
export const VERIFY_OP_GT: u32 = 4;   // >
export const VERIFY_OP_NEQ: u32 = 5;  // !=

/**
 * Trajectory & Requirement Verification Engine in WASM linear memory.
 * Evaluates dynamic requirements and constraints against multi-variable simulation time series.
 */
@unmanaged
export class TrajectoryVerifier {
  dae: DaeBuilder;

  constructor(dae: DaeBuilder) {
    this.dae = dae;
  }

  /**
   * Evaluates a single comparison between two expressions or values at a given state.
   */
  @inline
  checkComparison(lhsVal: f64, rhsVal: f64, op: u32, tol: f64 = 1e-6): bool {
    if (op == VERIFY_OP_LTE) return lhsVal <= rhsVal + tol;
    if (op == VERIFY_OP_GTE) return lhsVal >= rhsVal - tol;
    if (op == VERIFY_OP_LT) return lhsVal < rhsVal;
    if (op == VERIFY_OP_GT) return lhsVal > rhsVal;
    if (op == VERIFY_OP_EQ) return Math.abs(lhsVal - rhsVal) <= tol;
    if (op == VERIFY_OP_NEQ) return Math.abs(lhsVal - rhsVal) > tol;
    return true;
  }

  /**
   * Verifies an invariant formula across all steps of an ODE/DAE trajectory.
   *
   * @param lhsExprId Expression ID for LHS, or 0xffffffff if referencing state variable directly
   * @param lhsStateIdx Index of state variable in state vector (used if lhsExprId == 0xffffffff)
   * @param rhsExprId Expression ID for RHS, or 0xffffffff if constant
   * @param rhsConstant Constant value for RHS (used if rhsExprId == 0xffffffff)
   * @param op Comparison operator (VERIFY_OP_*)
   * @param numSteps Total simulation steps in trajectory
   * @param numStates Number of continuous state variables
   * @param tPtr Pointer to f64 array of time values [numSteps]
   * @param yPtr Pointer to f64 array of state trajectories [numSteps * numStates] (row-major: step, state)
   * @param varValuesBuffer Temp buffer for DaeBuilder evaluation [varCount]
   * @param outTimeSeriesPtr Pointer to write u8 array of boolean results [numSteps] (can be 0 if not needed)
   * @param outStatsPtr Pointer to write summary statistics:
   *                    [0]: isSatisfied (1.0 or 0.0)
   *                    [1]: peakLhsValue (f64)
   *                    [2]: limitRhsValue (f64)
   *                    [3]: firstViolationTime (f64, or -1.0 if never violated)
   *                    [4]: firstViolationStep (f64, or -1.0 if never violated)
   */
  verifyTrajectory(
    lhsExprId: u32,
    lhsStateIdx: i32,
    rhsExprId: u32,
    rhsConstant: f64,
    op: u32,
    numSteps: u32,
    numStates: u32,
    tPtr: usize,
    yPtr: usize,
    varValuesBuffer: usize,
    outTimeSeriesPtr: usize,
    outStatsPtr: usize,
    tol: f64 = 1e-6,
  ): u32 {
    let allSatisfied: bool = true;
    let peakLhs: f64 = -1e308;
    let limitRhs: f64 = rhsConstant;
    let firstViolationTime: f64 = -1.0;
    let firstViolationStep: f64 = -1.0;

    let tArr = changetype<UnmanagedFloat64Array>(tPtr);
    let yArr = changetype<UnmanagedFloat64Array>(yPtr);
    let outSeries = changetype<UnmanagedUint8Array>(outTimeSeriesPtr);
    let outStats = changetype<UnmanagedFloat64Array>(outStatsPtr);

    for (let step: u32 = 0; step < numSteps; step++) {
      let t = tArr[step];
      let stepStateOffset = (step as usize) * (numStates as usize);

      // Copy state values into DaeBuilder varValuesBuffer if needed for expr evaluation
      if (varValuesBuffer != 0 && numStates > 0) {
        memory.copy(varValuesBuffer, yPtr + (stepStateOffset << 3), (numStates as usize) * 8);
      }

      // 1. Evaluate LHS value
      let lhsVal: f64 = 0.0;
      if (lhsExprId != 0xffffffff) {
        lhsVal = evalExpr(lhsExprId, this.dae, varValuesBuffer);
      } else if (lhsStateIdx >= 0 && (lhsStateIdx as u32) < numStates) {
        lhsVal = yArr[(stepStateOffset + (lhsStateIdx as u32)) as i32];
      }

      // Track peak LHS value
      if (lhsVal > peakLhs) {
        peakLhs = lhsVal;
      }

      // 2. Evaluate RHS value
      let rhsVal: f64 = rhsConstant;
      if (rhsExprId != 0xffffffff) {
        rhsVal = evalExpr(rhsExprId, this.dae, varValuesBuffer);
      }
      limitRhs = rhsVal;

      // 3. Evaluate comparison
      let isMet = this.checkComparison(lhsVal, rhsVal, op, tol);

      if (outTimeSeriesPtr != 0) {
        outSeries[step] = isMet ? 1 : 0;
      }

      if (!isMet) {
        if (allSatisfied) {
          allSatisfied = false;
          firstViolationTime = t;
          firstViolationStep = step as f64;
        }
      }
    }

    if (outStatsPtr != 0) {
      outStats[0] = allSatisfied ? 1.0 : 0.0;
      outStats[1] = peakLhs;
      outStats[2] = limitRhs;
      outStats[3] = firstViolationTime;
      outStats[4] = firstViolationStep;
    }

    return allSatisfied ? 1 : 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Entrypoints
// ─────────────────────────────────────────────────────────────────────────────

export function verifier_create(daePtr: usize): usize {
  return changetype<usize>(new TrajectoryVerifier(changetype<DaeBuilder>(daePtr)));
}

export function verifier_checkComparison(lhsVal: f64, rhsVal: f64, op: u32, tol: f64): u32 {
  if (op == VERIFY_OP_LTE) return (lhsVal <= rhsVal + tol) ? 1 : 0;
  if (op == VERIFY_OP_GTE) return (lhsVal >= rhsVal - tol) ? 1 : 0;
  if (op == VERIFY_OP_LT) return (lhsVal < rhsVal) ? 1 : 0;
  if (op == VERIFY_OP_GT) return (lhsVal > rhsVal) ? 1 : 0;
  if (op == VERIFY_OP_EQ) return (Math.abs(lhsVal - rhsVal) <= tol) ? 1 : 0;
  if (op == VERIFY_OP_NEQ) return (Math.abs(lhsVal - rhsVal) > tol) ? 1 : 0;
  return 1;
}

export function verifier_verifyTrajectory(
  verifierPtr: usize,
  lhsExprId: u32,
  lhsStateIdx: i32,
  rhsExprId: u32,
  rhsConstant: f64,
  op: u32,
  numSteps: u32,
  numStates: u32,
  tPtr: usize,
  yPtr: usize,
  varValuesBuffer: usize,
  outTimeSeriesPtr: usize,
  outStatsPtr: usize,
  tol: f64,
): u32 {
  let verifier = changetype<TrajectoryVerifier>(verifierPtr);
  return verifier.verifyTrajectory(
    lhsExprId,
    lhsStateIdx,
    rhsExprId,
    rhsConstant,
    op,
    numSteps,
    numStates,
    tPtr,
    yPtr,
    varValuesBuffer,
    outTimeSeriesPtr,
    outStatsPtr,
    tol,
  );
}
