// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DaeBuilder,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  ExprKind,
  EqKind,
} from "../dae/builder";
import { evalExpr, evalEquationResidual } from "../dae/eval";
import { luFactor, luSolve, vectorNormInf } from "./matrix";
import { atomicChunkAlloc } from "../arena";
import { UnmanagedFloat64Array, UnmanagedUint32Array, DenseMatrixView } from "../core/array";

/**
 * Returns BDF alpha0 coefficients for orders 1..5.
 */
@inline
export function getBdfAlpha0(order: u32): f64 {
  if (order == 1) return 1.0;
  if (order == 2) return 1.5;
  if (order == 3) return 1.8333333333333333; // 11/6
  if (order == 4) return 2.0833333333333335; // 25/12
  if (order == 5) return 2.283333333333333; // 137/60
  return 1.0;
}

/**
 * Returns BDF error constants for orders 1..5.
 */
@inline
export function getBdfErrorConst(order: u32): f64 {
  if (order == 1) return 0.5;
  if (order == 2) return 0.2222222222222222; // 2/9
  if (order == 3) return 0.13636363636363635; // 3/22
  if (order == 4) return 0.096; // 12/125
  if (order == 5) return 0.072992700729927; // 10/137
  return 0.5;
}

/**
 * Variable-Order Multi-Step BDF (Orders 1-5) Solver in WASM Linear Memory
 */
@unmanaged
export class BdfSolver {
  daePtr: u32;
  nStates: u32;
  order: u32; // Current order (1..5)
  maxOrder: u32;
  atol: f64;
  rtol: f64;
  stepCount: u32;

  // Nordsieck History Array: z[order+1][nStates]
  // Row 0: y_n
  // Row 1: h * y_n'
  // Row 2: (h^2 / 2) * y_n'' ...
  historyPtr: usize;
  stateIndicesPtr: usize; // u32[nStates]
  derivIndicesPtr: usize; // u32[nStates]

  // Scratch memory for Newton iterations and LU
  scratchPtr: usize;

  @inline get history(): UnmanagedFloat64Array { return changetype<UnmanagedFloat64Array>(this.historyPtr); }
  @inline get stateIndices(): UnmanagedUint32Array { return changetype<UnmanagedUint32Array>(this.stateIndicesPtr); }
  @inline get derivIndices(): UnmanagedUint32Array { return changetype<UnmanagedUint32Array>(this.derivIndicesPtr); }

  init(daePtr: u32, nStates: u32, atol: f64, rtol: f64, maxOrder: u32): void {
    this.daePtr = daePtr;
    this.nStates = nStates;
    this.order = 1;
    this.maxOrder = maxOrder > 5 ? 5 : maxOrder < 1 ? 1 : maxOrder;
    this.atol = atol;
    this.rtol = rtol;
    this.stepCount = 0;

    let maxRows: u32 = 6;
    let n = nStates > 0 ? nStates : 1;
    this.historyPtr = atomicChunkAlloc(maxRows * n * 8);
    this.stateIndicesPtr = atomicChunkAlloc(n * 4);
    this.derivIndicesPtr = atomicChunkAlloc(n * 4);

    let scratchSize = (n * 8) + (n * 8) + (n * n * 8) + ((n * 4 + 7) & ~7) + (n * 8) + (n * 8) + (n * 8) + 128;
    this.scratchPtr = atomicChunkAlloc(scratchSize);
  }
}

/**
 * Evaluates explicit ODE/DAE equations in the DAE arena to update derivative and algebraic values in varValues.
 */
@inline
function evalBdfEquations(solver: BdfSolver, dae: DaeBuilder, varValuesPtr: u32): void {
  let eqCount = dae.eqCount;
  if (eqCount == 0) return;

  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr);
  let n = solver.nStates;
  let stateIndices = solver.stateIndices;
  let derivIndices = solver.derivIndices;

  for (let eqIdx: u32 = 0; eqIdx < eqCount; eqIdx++) {
    let eqOffset = eqIdx * EQ_STRIDE;
    let eqKind = dae.getEqData().get(eqOffset + EQ_KIND);
    if (eqKind != EqKind.Simple) continue;

    let lhs = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
    let rhs = dae.getEqData().get(eqOffset + EQ_RHS) as u32;
    if (lhs >= dae.exprCount || rhs >= dae.exprCount) continue;

    let lhsOffset = lhs * EXPR_STRIDE;
    let lhsKind = dae.getExprData().get(lhsOffset + EXPR_KIND);

    if (lhsKind == ExprKind.Der) {
      let inner = dae.getExprData().get(lhsOffset + EXPR_DATA1) as u32;
      let targetStateVar: u32 = inner;
      if (inner < dae.exprCount && dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
        targetStateVar = dae.getExprData().get(inner * EXPR_STRIDE + EXPR_DATA1) as u32;
      }
      let rhsVal = evalExpr(rhs, dae, varValuesPtr);
      for (let i: u32 = 0; i < n; i++) {
        if (stateIndices[i] == targetStateVar) {
          varValues[derivIndices[i]] = rhsVal;
          break;
        }
      }
    } else if (lhsKind == ExprKind.Name) {
      let targetVar = dae.getExprData().get(lhsOffset + EXPR_DATA1) as u32;
      if (targetVar < dae.varCount) {
        let isState = false;
        for (let i: u32 = 0; i < n; i++) {
          if (stateIndices[i] == targetVar) {
            isState = true;
            break;
          }
        }
        if (!isState) {
          varValues[targetVar] = evalExpr(rhs, dae, varValuesPtr);
        }
      }
    }
  }
}

/**
 * Predicts next state step using Pascal triangle polynomial extrapolation across Nordsieck history.
 */
@inline
function bdfPredict(solver: BdfSolver): void {
  let q = solver.order;
  let n = solver.nStates;
  let hist = solver.history;

  for (let k: i32 = (q as i32); k >= 1; k--) {
    for (let j: i32 = k; j <= (q as i32); j++) {
      let srcRow = (j as u32) * n;
      let dstRow = ((j - 1) as u32) * n;

      for (let i: u32 = 0; i < n; i++) {
        let src = hist[srcRow + i];
        let dst = hist[dstRow + i];
        hist[dstRow + i] = dst + src;
      }
    }
  }
}

/**
 * Executes a single adaptive variable-order BDF integration step.
 */
export function stepMultiOrderBDF(
  solver: BdfSolver,
  varValuesPtr: u32,
  t: f64,
  dt: f64
): f64 {
  let n = solver.nStates;
  let dae = changetype<DaeBuilder>(solver.daePtr);
  let q = solver.order;
  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr);
  let hist = solver.history;
  let stateIndices = solver.stateIndices;
  let derivIndices = solver.derivIndices;

  // Initialize Nordsieck history from initial state values on first step
  if (solver.stepCount == 0) {
    evalBdfEquations(solver, dae, varValuesPtr);
    for (let i: u32 = 0; i < n; i++) {
      let sIdx = stateIndices[i];
      let dIdx = derivIndices[i];
      if (hist[i] == 0.0 && (varValues[sIdx] != 0.0 || varValues[dIdx] != 0.0)) {
        hist[i] = varValues[sIdx];
        hist[n + i] = dt * varValues[dIdx];
      }
    }
  }

  // 1. Predictor: Extrapolate Nordsieck history
  bdfPredict(solver);

  // Copy predicted state into active variable values buffer
  for (let i: u32 = 0; i < n; i++) {
    let sIdx = stateIndices[i];
    let predVal = hist[i];
    varValues[sIdx] = predVal;
  }

  // 2. Newton-Raphson Corrector Loop for Stiff DAE:
  // G(y) = (y_n - y_pred) - (h * f(t, y) - h * y_pred') / alpha0 = 0
  let alpha0 = getBdfAlpha0(q);
  let h_alpha0 = dt / alpha0;

  let rPtr = solver.scratchPtr;
  let dyPtr = rPtr + n * 8;
  let jPtr = dyPtr + n * 8;
  let pivPtr = jPtr + n * n * 8;
  let pivSize = (n * 4 + 7) & ~7;
  let scalePtr = pivPtr + pivSize;
  let luScratchPtr = scalePtr + n * 8;
  let fBasePtr = luScratchPtr + n * 8;

  let r = changetype<UnmanagedFloat64Array>(rPtr);
  let dy = changetype<UnmanagedFloat64Array>(dyPtr);
  let negR = changetype<UnmanagedFloat64Array>(luScratchPtr);
  let fBaseArr = changetype<UnmanagedFloat64Array>(fBasePtr);
  let jMat = DenseMatrixView.at(jPtr, n, n);

  let tol: f64 = solver.atol;
  let maxIter: u32 = 15;
  let iter: u32 = 0;
  let eps: f64 = 1e-7;

  while (iter < maxIter) {
    iter++;

    evalBdfEquations(solver, dae, varValuesPtr);

    // Evaluate residual vector G(y)
    let maxRes: f64 = 0.0;
    for (let i: u32 = 0; i < n; i++) {
      let sIdx = stateIndices[i];
      let dIdx = derivIndices[i];

      let currY = varValues[sIdx];
      let predY = hist[i];
      let predScaledDeriv = hist[n + i];
      let fVal = varValues[dIdx];
      fBaseArr[i] = fVal;

      let gVal = (currY - predY) - (dt * fVal - predScaledDeriv) / alpha0;
      r[i] = gVal;
      if (Math.abs(gVal) > maxRes) maxRes = Math.abs(gVal);
    }

    if (maxRes < tol) break;

    // Assemble Jacobian J = I - h_alpha0 * (df/dy)
    for (let c: u32 = 0; c < n; c++) {
      let sIdx = stateIndices[c];
      let origVal = varValues[sIdx];

      varValues[sIdx] = origVal + eps;
      evalBdfEquations(solver, dae, varValuesPtr);

      for (let row: u32 = 0; row < n; row++) {
        let dIdx = derivIndices[row];
        let fPert = varValues[dIdx];
        let fBase = fBaseArr[row];
        let df_dy = (fPert - fBase) / eps;

        let jVal: f64 = (row == c ? 1.0 : 0.0) - h_alpha0 * df_dy;
        jMat.set(row, c, jVal);
      }

      varValues[sIdx] = origVal;
    }

    // Restore unperturbed derivative values
    for (let i: u32 = 0; i < n; i++) {
      varValues[derivIndices[i]] = fBaseArr[i];
    }

    // Solve J * dy = -r
    for (let i: u32 = 0; i < n; i++) {
      negR[i] = -r[i];
    }

    if (luFactor(jPtr as u32, pivPtr as u32, scalePtr as u32, n)) {
      luSolve(jPtr as u32, pivPtr as u32, scalePtr as u32, luScratchPtr as u32, dyPtr as u32, n);
      for (let i: u32 = 0; i < n; i++) {
        let delta = negR[i];
        if (!isNaN(delta)) {
          let sIdx = stateIndices[i];
          varValues[sIdx] = varValues[sIdx] + delta;
        }
      }
    } else {
      break;
    }
  }

  evalBdfEquations(solver, dae, varValuesPtr);

  // 3. Update Nordsieck History with Difference Correction
  for (let i: u32 = 0; i < n; i++) {
    let sIdx = stateIndices[i];
    let yFinal = varValues[sIdx];
    let yPred = hist[i];
    let delta = yFinal - yPred;

    hist[i] = yFinal;
    hist[1 * n + i] = dt * varValues[derivIndices[i]];

    if (q >= 2) {
      let row2 = hist[2 * n + i];
      hist[2 * n + i] = row2 + delta * (1.0 / alpha0);
    }
  }

  // 4. Adaptive Order Control: Increase order if error is small
  solver.stepCount++;
  if (solver.stepCount > 5 && solver.order < solver.maxOrder) {
    solver.order++;
  }

  return t + dt;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_createBdfSolver(
  daePtr: u32,
  nStates: u32,
  atol: f64,
  rtol: f64,
  maxOrder: u32
): u32 {
  if (daePtr == 0) return 0;
  let ptr = atomicChunkAlloc(256);
  let solver = changetype<BdfSolver>(ptr);
  solver.init(daePtr, nStates, atol, rtol, maxOrder);
  return ptr as u32;
}

export function dae_setBdfStateMapping(
  solverPtr: u32,
  idx: u32,
  stateVarIdx: u32,
  derivVarIdx: u32
): void {
  if (solverPtr == 0) return;
  let solver = changetype<BdfSolver>(solverPtr);
  if (idx >= solver.nStates) return;
  solver.stateIndices[idx] = stateVarIdx;
  solver.derivIndices[idx] = derivVarIdx;
}

export function dae_stepBdfSolver(
  solverPtr: u32,
  varValuesPtr: u32,
  t: f64,
  dt: f64
): f64 {
  if (solverPtr == 0) return t;
  let solver = changetype<BdfSolver>(solverPtr);
  return stepMultiOrderBDF(solver, varValuesPtr, t, dt);
}
