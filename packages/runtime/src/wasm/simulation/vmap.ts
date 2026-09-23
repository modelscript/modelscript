import {
  DaeBuilder,
  VAR_STRIDE,
  VAR_VARIABILITY,
  Variability,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EqKind,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  ExprKind,
} from "../dae/builder";
import { evalExpr, evalEquationResidual } from "../dae/eval";
import { atomicChunkAlloc } from "../arena";
import { UnmanagedFloat64Array, UnmanagedUint32Array } from "../core/array";

/**
 * JAX-Grade Vectorized Batch Simulation Engine in WASM Linear Memory.
 * Evaluates M independent parameter trajectories simultaneously with zero GC overhead.
 */

export function simulateSingleInstance(
  dae: DaeBuilder,
  varValuesPtr: usize,
  derValuesPtr: usize,
  t0: f64,
  t1: f64,
  dt: f64,
  outTrajectoryPtr: usize
): u32 {
  let varCount = dae.varCount;
  let eqCount = dae.eqCount;

  let nSteps = u32(Math.ceil((t1 - t0) / dt)) + 1;
  let currentT = t0;

  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr);
  let derValues = changetype<UnmanagedFloat64Array>(derValuesPtr);
  let outTrajectory = changetype<UnmanagedFloat64Array>(outTrajectoryPtr);

  // Record initial step t0
  for (let v: u32 = 0; v < varCount; v++) {
    outTrajectory[v] = varValues[v];
  }

  let outOffset = varCount;

  let k1Ptr = atomicChunkAlloc(varCount * 8) as usize;
  let k1 = changetype<UnmanagedFloat64Array>(k1Ptr);

  for (let step: u32 = 1; step < nSteps; step++) {
    // 1. Evaluate k1 derivatives
    for (let eq: u32 = 0; eq < eqCount; eq++) {
      let offset = eq * EQ_STRIDE;
      if (dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;

      let lhs = dae.getEqData().get(offset + EQ_LHS) as u32;
      let rhs = dae.getEqData().get(offset + EQ_RHS) as u32;

      let lhsOffset = lhs * EXPR_STRIDE;
      let lhsKind = dae.getExprData().get(lhsOffset + EXPR_KIND);

      if (lhsKind == ExprKind.Der) {
        let inner = dae.getExprData().get(lhsOffset + EXPR_DATA1) as u32;
        if (inner < dae.exprCount && dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
          let varId = dae.getExprData().get(inner * EXPR_STRIDE + EXPR_DATA1) as u32;
          let rhsVal = evalExpr(rhs, dae, varValuesPtr as u32);
          derValues[varId] = rhsVal;
        }
      } else if (lhsKind == ExprKind.Name) {
        let varId = dae.getExprData().get(lhsOffset + EXPR_DATA1) as u32;
        let rhsVal = evalExpr(rhs, dae, varValuesPtr as u32);
        varValues[varId] = rhsVal;
      }
    }

    // 2. Predictor step: x_pred = x + dt * k1
    for (let v: u32 = 0; v < varCount; v++) {
      let variability = dae.getVarData().get(v * VAR_STRIDE + VAR_VARIABILITY);
      if (variability == Variability.Continuous) {
        let x = varValues[v];
        let dx = derValues[v];
        k1[v] = dx;
        varValues[v] = x + dt * dx;
      }
    }

    // 3. Evaluate k2 derivatives at x_pred
    for (let eq: u32 = 0; eq < eqCount; eq++) {
      let offset = eq * EQ_STRIDE;
      if (dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;

      let lhs = dae.getEqData().get(offset + EQ_LHS) as u32;
      let rhs = dae.getEqData().get(offset + EQ_RHS) as u32;

      let lhsOffset = lhs * EXPR_STRIDE;
      let lhsKind = dae.getExprData().get(lhsOffset + EXPR_KIND);

      if (lhsKind == ExprKind.Der) {
        let inner = dae.getExprData().get(lhsOffset + EXPR_DATA1) as u32;
        if (inner < dae.exprCount && dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
          let varId = dae.getExprData().get(inner * EXPR_STRIDE + EXPR_DATA1) as u32;
          let rhsVal = evalExpr(rhs, dae, varValuesPtr as u32);
          derValues[varId] = rhsVal;
        }
      }
    }

    // 4. Corrector step: x_{n+1} = x_n + 0.5 * dt * (k1 + k2)
    for (let v: u32 = 0; v < varCount; v++) {
      let variability = dae.getVarData().get(v * VAR_STRIDE + VAR_VARIABILITY);
      if (variability == Variability.Continuous) {
        let x_pred = varValues[v];
        let k1Val = k1[v];
        let k2 = derValues[v];
        let x_orig = x_pred - dt * k1Val;
        varValues[v] = x_orig + 0.5 * dt * (k1Val + k2);
      }
    }

    currentT += dt;

    // 5. Write out step trajectory
    for (let v: u32 = 0; v < varCount; v++) {
      outTrajectory[outOffset + v] = varValues[v];
    }
    outOffset += varCount;
  }

  return nSteps;
}

/**
 * Batched multi-instance simulation over range [instanceStart, instanceEnd).
 */
export function simulateBatchChunk(
  dae: DaeBuilder,
  instanceStart: u32,
  instanceEnd: u32,
  paramIndicesPtr: u32,
  nParams: u32,
  batchParamsPtr: u32,
  t0: f64,
  t1: f64,
  dt: f64,
  outResultsPtr: u32
): u32 {
  let varCount = dae.varCount;
  let nSteps = u32(Math.ceil((t1 - t0) / dt)) + 1;
  let trajectoryBytesPerInstance = (nSteps * varCount * 8) as usize;

  let localVarsPtr = atomicChunkAlloc(varCount * 8) as usize;
  let localDerPtr = atomicChunkAlloc(varCount * 8) as usize;
  let localVars = changetype<UnmanagedFloat64Array>(localVarsPtr);
  let localDer = changetype<UnmanagedFloat64Array>(localDerPtr);
  let paramIndices = changetype<UnmanagedUint32Array>(paramIndicesPtr);
  let batchParams = changetype<UnmanagedFloat64Array>(batchParamsPtr);

  for (let inst: u32 = instanceStart; inst < instanceEnd; inst++) {
    // 1. Initialize local variable buffer from DAE start values
    for (let v: u32 = 0; v < varCount; v++) {
      localVars[v] = dae.getVarStartValue(v);
      localDer[v] = 0.0;
    }

    // 2. Inject instance parameters
    for (let p: u32 = 0; p < nParams; p++) {
      let paramVarId = paramIndices[p];
      let paramVal = batchParams[inst * nParams + p];
      localVars[paramVarId] = paramVal;
    }

    // 3. Simulate this instance trajectory
    let destTrajectoryPtr = (outResultsPtr as usize) + (inst as usize) * trajectoryBytesPerInstance;
    simulateSingleInstance(dae, localVarsPtr, localDerPtr, t0, t1, dt, destTrajectoryPtr);
  }

  return instanceEnd - instanceStart;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Bridge Exports
// ─────────────────────────────────────────────────────────────────────────────

export function dae_simulateBatch(
  daePtr: u32,
  nInstances: u32,
  paramIndicesPtr: u32,
  nParams: u32,
  batchParamsPtr: u32,
  t0: f64,
  t1: f64,
  dt: f64,
  outResultsPtr: u32
): u32 {
  if (daePtr == 0 || nInstances == 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr);
  return simulateBatchChunk(dae, 0, nInstances, paramIndicesPtr, nParams, batchParamsPtr, t0, t1, dt, outResultsPtr);
}

export function dae_simulateBatchChunk(
  daePtr: u32,
  instanceStart: u32,
  instanceEnd: u32,
  paramIndicesPtr: u32,
  nParams: u32,
  batchParamsPtr: u32,
  t0: f64,
  t1: f64,
  dt: f64,
  outResultsPtr: u32
): u32 {
  if (daePtr == 0 || instanceEnd <= instanceStart) return 0;
  let dae = changetype<DaeBuilder>(daePtr);
  return simulateBatchChunk(dae, instanceStart, instanceEnd, paramIndicesPtr, nParams, batchParamsPtr, t0, t1, dt, outResultsPtr);
}

/**
 * Vectorized Batch Residual Evaluation across instances.
 * Evaluates equation residuals across all batch instances into outResidualsPtr [nInstances * nEqs].
 */
export function evalBatchResiduals(
  dae: DaeBuilder,
  nInstances: u32,
  varStride: u32,
  batchVarsPtr: u32,
  outResidualsPtr: u32
): void {
  let eqCount = dae.eqCount;
  for (let inst: u32 = 0; inst < nInstances; inst++) {
    let instanceVars = batchVarsPtr + inst * varStride * 8;
    let instanceRes = changetype<UnmanagedFloat64Array>(outResidualsPtr + inst * eqCount * 8);
    for (let eq: u32 = 0; eq < eqCount; eq++) {
      let r = evalEquationResidual(eq, dae, instanceVars);
      instanceRes[eq] = r;
    }
  }
}

export function dae_evalBatchResiduals(
  daePtr: u32,
  nInstances: u32,
  varStride: u32,
  batchVarsPtr: u32,
  outResidualsPtr: u32
): void {
  if (daePtr == 0 || nInstances == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  evalBatchResiduals(dae, nInstances, varStride, batchVarsPtr, outResidualsPtr);
}

