import { DaeBuilder, EQ_STRIDE, EQ_KIND, EqKind, EQ_LHS, EQ_RHS, EXPR_STRIDE, EXPR_KIND, ExprKind, EXPR_DATA1 } from "../dae/builder";
import { evalEquationResidual } from "../dae/eval";
import { EventDetector } from "../simulation/events";
import { luFactor, luSolve, vectorNormInf } from "./matrix";
import { UnmanagedUint32Array, UnmanagedFloat64Array, DenseMatrixView } from "../core/array";

/**
 * Solves N x N coupled algebraic constraints using multi-variable Newton-Raphson
 * iteration with numerical finite-difference Jacobian and Armijo line search.
 *
 * @param dae DaeBuilder reference.
 * @param varValuesPtr Pointer to current variable values buffer.
 * @param eqIndicesPtr Pointer to N equation indices.
 * @param varIndicesPtr Pointer to N unknown variable indices.
 * @param n Dimension of the coupled block (N equations, N variables).
 * @param scratchPtr Pointer to a pre-allocated WASM scratch memory buffer.
 */
@inline
export function solveBlockAlgebraicConstraints(
  dae: DaeBuilder,
  varValuesPtr: u32,
  eqIndicesPtr: u32,
  varIndicesPtr: u32,
  n: u32,
  scratchPtr: u32
): bool {
  if (n == 0) return true;

  // Lay out memory offsets in scratch buffer
  // scratch layout:
  // - residual R: n * 8 bytes
  // - dx (step): n * 8 bytes
  // - Jacobian matrix J (row major): n * n * 8 bytes
  // - piv: n * 4 bytes
  // - scale: n * 8 bytes
  // - scratchForLu: n * 8 bytes
  let rPtr = scratchPtr;
  let dxPtr = rPtr + n * 8;
  let jPtr = dxPtr + n * 8;
  let pivPtr = jPtr + n * n * 8;
  let pivSize = (n * 4 + 7) & ~7;
  let scalePtr = pivPtr + pivSize;
  let luScratchPtr = scalePtr + n * 8;

  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);
  let eqIndices = changetype<UnmanagedUint32Array>(eqIndicesPtr as usize);
  let varIndices = changetype<UnmanagedUint32Array>(varIndicesPtr as usize);
  let r = changetype<UnmanagedFloat64Array>(rPtr as usize);
  let dx = changetype<UnmanagedFloat64Array>(dxPtr as usize);
  let jMat = DenseMatrixView.at(jPtr as usize, n, n);

  // Warm-start variables if cached values exist
  for (let i: u32 = 0; i < n; i++) {
    let vIdx = varIndices[i];
    let warmVal = dae.getWarmStartValue(vIdx);
    if (warmVal != 0.0) {
      varValues[vIdx] = warmVal;
    }
  }

  let tol: f64 = 1e-10;
  let maxIter: u32 = 25;
  let iter: u32 = 0;
  let eps: f64 = 1e-7;

  while (iter < maxIter) {
    iter++;

    // 1. Evaluate Residual Vector R
    for (let i: u32 = 0; i < n; i++) {
      let eqIdx = eqIndices[i];
      let res = evalEquationResidual(eqIdx, dae, varValuesPtr);
      r[i] = res;
    }

    // 2. Check Convergence: ||R||_inf < tol
    let normR = vectorNormInf(rPtr, n);
    if (normR < tol) break;

    // 3. Construct Finite-Difference Jacobian Matrix J (N x N)
    for (let j: u32 = 0; j < n; j++) {
      let vIdx = varIndices[j];
      let xOrig = varValues[vIdx];

      // Perturb variable x_j
      varValues[vIdx] = xOrig + eps;

      for (let i: u32 = 0; i < n; i++) {
        let eqIdx = eqIndices[i];
        let resPlus = evalEquationResidual(eqIdx, dae, varValuesPtr);
        let resOrig = r[i];
        let der = (resPlus - resOrig) / eps;

        // Store into J[i, j] (row-major)
        jMat.set(i, j, der);
      }

      // Restore variable x_j
      varValues[vIdx] = xOrig;
    }

    // 4. LU Factorization of J
    let success = luFactor(jPtr, pivPtr, scalePtr, n);
    if (!success) return false;

    // 5. Solve J * dx = R (dxPtr initially holds RHS = R)
    for (let i: u32 = 0; i < n; i++) {
      dx[i] = r[i];
    }
    luSolve(jPtr, pivPtr, scalePtr, dxPtr, luScratchPtr, n);

    // 6. Armijo Backtracking Line Search along direction -dx
    let alpha: f64 = 1.0;
    let stepAccepted = false;

    while (alpha > 0.0625) {
      // Apply candidate update: x_new = x_old - alpha * dx
      for (let j: u32 = 0; j < n; j++) {
        let vIdx = varIndices[j];
        let xOrig = varValues[vIdx];
        let delta = dx[j];
        varValues[vIdx] = xOrig - alpha * delta;
      }

      // Evaluate new residual norm
      let maxNewRes: f64 = 0.0;
      for (let i: u32 = 0; i < n; i++) {
        let eqIdx = eqIndices[i];
        let resNew = Math.abs(evalEquationResidual(eqIdx, dae, varValuesPtr));
        if (resNew > maxNewRes) maxNewRes = resNew;
      }

      if (maxNewRes < normR) {
        stepAccepted = true;
        break; // Step reduces residual, accept step
      }

      // Revert state update before reducing alpha
      for (let j: u32 = 0; j < n; j++) {
        let vIdx = varIndices[j];
        let xOrig = varValues[vIdx];
        let delta = dx[j];
        varValues[vIdx] = xOrig + alpha * delta;
      }

      alpha *= 0.5;
    }

    if (!stepAccepted) {
      // If line search failed to reduce residual, take full step as fallback
      for (let j: u32 = 0; j < n; j++) {
        let vIdx = varIndices[j];
        let xOrig = varValues[vIdx];
        let delta = dx[j];
        varValues[vIdx] = xOrig - delta;
      }
    }
  }

  // Update warm-start cache for all variables in block
  for (let i: u32 = 0; i < n; i++) {
    let vIdx = varIndices[i];
    let xFinal = varValues[vIdx];
    dae.setWarmStartValue(vIdx, xFinal);
  }

  return true;
}

/**
 * Solves and enforces algebraic constraints across state vectors.
 * Uses warm-started 1x1 Newton-Raphson iteration with Armijo line search.
 */
@inline
export function solveAlgebraicConstraints(dae: DaeBuilder, varValuesPtr: u32): void {
  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);

  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let offset = i * EQ_STRIDE;
    if (dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;

    // Check if equation target LHS is a non-derivative variable
    let lhsExpr = dae.getEqData().get(offset + EQ_LHS);
    if (lhsExpr == 0xffffffff) continue;

    let lhsOffset = lhsExpr * EXPR_STRIDE;
    let lhsKind = dae.getExprData().get(lhsOffset + EXPR_KIND);
    if (lhsKind != ExprKind.Name) continue; // Only handle algebraic variable assignments

    let targetVarIdx = dae.getExprData().get(lhsOffset + EXPR_DATA1) as u32;
    if (targetVarIdx >= dae.varCount) continue;

    // Retrieve warm start value if available
    let warmVal = dae.getWarmStartValue(targetVarIdx);
    if (warmVal != 0.0) {
      varValues[targetVarIdx] = warmVal;
    }

    let x: f64 = varValues[targetVarIdx];
    let tol: f64 = 1e-10;
    let maxIter: u32 = 25;
    let iter: u32 = 0;

    while (iter < maxIter) {
      iter++;
      let res = evalEquationResidual(i, dae, varValuesPtr);
      if (Math.abs(res) < tol) break;

      // Numerical finite difference derivative in CPU registers
      let eps: f64 = 1e-7;
      varValues[targetVarIdx] = x + eps;
      let resPlus = evalEquationResidual(i, dae, varValuesPtr);
      varValues[targetVarIdx] = x;

      let der = (resPlus - res) / eps;
      if (Math.abs(der) < 1e-14) der = der >= 0 ? 1e-6 : -1e-6;

      let step = res / der;

      // Armijo backtracking
      let alpha: f64 = 1.0;
      let xNew = x - step;
      varValues[targetVarIdx] = xNew;
      let resNew = Math.abs(evalEquationResidual(i, dae, varValuesPtr));

      while (resNew >= Math.abs(res) && alpha > 0.0625) {
        alpha *= 0.5;
        xNew = x - alpha * step;
        varValues[targetVarIdx] = xNew;
        resNew = Math.abs(evalEquationResidual(i, dae, varValuesPtr));
      }

      x = xNew;
    }

    varValues[targetVarIdx] = x;
    dae.setWarmStartValue(targetVarIdx, x);
  }
}

/**
 * Single-step Explicit Euler integration over state variables with DAE algebraic loop convergence.
 */
@inline
export function stepEuler(dae: DaeBuilder, varValuesPtr: u32, dt: f64): void {
  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);

  // 1. Explicit ODE State Update
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let offset = i * EQ_STRIDE;
    if (dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;

    let lhsExpr = dae.getEqData().get(offset + EQ_LHS);
    if (lhsExpr == 0xffffffff) continue;

    let lhsOffset = lhsExpr * EXPR_STRIDE;
    if (dae.getExprData().get(lhsOffset + EXPR_KIND) == ExprKind.Der) {
      let stateVarIdx = dae.getExprData().get(lhsOffset + EXPR_DATA1);
      let res = evalEquationResidual(i, dae, varValuesPtr);
      let stateVal = varValues[stateVarIdx];
      varValues[stateVarIdx] = stateVal + dt * res;
    }
  }

  // 2. Algebraic Constraint Enforcement
  solveAlgebraicConstraints(dae, varValuesPtr);
}

/**
 * Single-step RK4 (4th Order Runge-Kutta) Integrator.
 */
@inline
export function stepRK4(
  dae: DaeBuilder,
  varValuesPtr: u32,
  tempPtr: u32,
  k1Ptr: u32,
  k2Ptr: u32,
  k3Ptr: u32,
  k4Ptr: u32,
  dt: f64
): void {
  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);
  let temp = changetype<UnmanagedFloat64Array>(tempPtr as usize);
  let k1Arr = changetype<UnmanagedFloat64Array>(k1Ptr as usize);
  let k2Arr = changetype<UnmanagedFloat64Array>(k2Ptr as usize);
  let k3Arr = changetype<UnmanagedFloat64Array>(k3Ptr as usize);
  let k4Arr = changetype<UnmanagedFloat64Array>(k4Ptr as usize);

  // 1. Compute k1 = f(y_n)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let k1 = evalEquationResidual(i, dae, varValuesPtr);
    k1Arr[i] = k1;
    let y0 = varValues[i];
    temp[i] = y0 + 0.5 * dt * k1;
  }

  // 2. Compute k2 = f(y_n + 0.5*dt*k1)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let k2 = evalEquationResidual(i, dae, tempPtr);
    k2Arr[i] = k2;
    let y0 = varValues[i];
    temp[i] = y0 + 0.5 * dt * k2;
  }

  // 3. Compute k3 = f(y_n + 0.5*dt*k2)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let k3 = evalEquationResidual(i, dae, tempPtr);
    k3Arr[i] = k3;
    let y0 = varValues[i];
    temp[i] = y0 + dt * k3;
  }

  // 4. Compute k4 = f(y_n + dt*k3)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let k4 = evalEquationResidual(i, dae, tempPtr);
    k4Arr[i] = k4;
  }

  // 5. Final update: y_{n+1} = y_n + (dt/6) * (k1 + 2*k2 + 2*k3 + k4)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let y0 = varValues[i];
    let k1 = k1Arr[i];
    let k2 = k2Arr[i];
    let k3 = k3Arr[i];
    let k4 = k4Arr[i];

    let yNext = y0 + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    varValues[i] = yNext;
  }

  // 6. Algebraic Constraint Enforcement
  solveAlgebraicConstraints(dae, varValuesPtr);
}

/**
 * Single-step DAE simulation combining ODE propagation and algebraic loop warm-starting.
 */
@inline
export function stepDAE(dae: DaeBuilder, varValuesPtr: u32, dt: f64): void {
  stepEuler(dae, varValuesPtr, dt);
}

/**
 * Main simulation loop for continuous integration.
 */
@inline
export function runSimulationLoop(
  dae: DaeBuilder,
  varValuesPtr: u32,
  startTime: f64,
  stopTime: f64,
  stepSize: f64
): u32 {
  let steps = ((stopTime - startTime) / stepSize) as u32;

  for (let step: u32 = 0; step < steps; step++) {
    stepDAE(dae, varValuesPtr, stepSize);
  }

  return steps;
}

/**
 * Main simulation loop with Zero-Crossing Event Localization & Hybrid State Resets.
 */
@inline
export function runSimulationLoopWithEvents(
  dae: DaeBuilder,
  events: EventDetector,
  varValuesPtr: u32,
  tempValuesPtr: u32,
  startTime: f64,
  stopTime: f64,
  stepSize: f64
): u32 {
  let steps = ((stopTime - startTime) / stepSize) as u32;
  let numVars = dae.varCount;
  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);
  let tempValues = changetype<UnmanagedFloat64Array>(tempValuesPtr as usize);

  for (let step: u32 = 0; step < steps; step++) {
    let t0 = startTime + (step as f64) * stepSize;

    // 1. Copy starting state to temp buffer
    for (let v: u32 = 0; v < numVars; v++) {
      tempValues[v] = varValues[v];
    }

    // 2. Take candidate continuous step
    stepDAE(dae, varValuesPtr, stepSize);

    // 3. Check for zero-crossing events
    let zcfIdx = events.checkZeroCrossings(varValuesPtr);
    if (zcfIdx != -1) {
      // Event localized in interval [t0, t0 + stepSize]
      let tEvent = events.bisectEventTime(
        zcfIdx as u32,
        tempValuesPtr,
        varValuesPtr,
        varValuesPtr, // stores interpolated result
        t0,
        t0 + stepSize
      );

      // Enforce constraints & update signs at tEvent
      solveAlgebraicConstraints(dae, varValuesPtr);
      events.updateZcfSigns(varValuesPtr);
    }
  }

  return steps;
}

/**
 * Computes derivative values dy/dt for all state variables.
 */
@inline
export function computeDerivatives(dae: DaeBuilder, varValuesPtr: u32, kOutPtr: u32): void {
  let numVars = dae.varCount;
  let kOut = changetype<UnmanagedFloat64Array>(kOutPtr as usize);

  for (let v: u32 = 0; v < numVars; v++) {
    kOut[v] = 0.0;
  }

  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let offset = i * EQ_STRIDE;
    if (dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;

    let lhsExpr = dae.getEqData().get(offset + EQ_LHS);
    if (lhsExpr == 0xffffffff) continue;

    let lhsOffset = lhsExpr * EXPR_STRIDE;
    if (dae.getExprData().get(lhsOffset + EXPR_KIND) == ExprKind.Der) {
      let stateVarIdx = dae.getExprData().get(lhsOffset + EXPR_DATA1) as u32;
      if (stateVarIdx < numVars) {
        let res = evalEquationResidual(i, dae, varValuesPtr);
        kOut[stateVarIdx] = res;
      }
    }
  }
}

/**
 * Cubic Hermite interpolation for dense output between t0 and t0 + dt.
 * Uses initial stage derivative (k1) and final stage derivative (k7).
 */
@inline
export function hermiteInterpolate(
  y0Ptr: u32,
  y1Ptr: u32,
  k1Ptr: u32,
  k7Ptr: u32,
  dt: f64,
  theta: f64,
  numVars: u32,
  outPtr: u32
): void {
  let theta2 = theta * theta;
  let theta3 = theta2 * theta;

  let h00 = 2.0 * theta3 - 3.0 * theta2 + 1.0;
  let h10 = theta3 - 2.0 * theta2 + theta;
  let h01 = -2.0 * theta3 + 3.0 * theta2;
  let h11 = theta3 - theta2;

  let y0Arr = changetype<UnmanagedFloat64Array>(y0Ptr as usize);
  let y1Arr = changetype<UnmanagedFloat64Array>(y1Ptr as usize);
  let k1Arr = changetype<UnmanagedFloat64Array>(k1Ptr as usize);
  let k7Arr = changetype<UnmanagedFloat64Array>(k7Ptr as usize);
  let outArr = changetype<UnmanagedFloat64Array>(outPtr as usize);

  for (let i: u32 = 0; i < numVars; i++) {
    let y0 = y0Arr[i];
    let y1 = y1Arr[i];
    let f0 = k1Arr[i] * dt;
    let f1 = k7Arr[i] * dt;
    outArr[i] = h00 * y0 + h10 * f0 + h01 * y1 + h11 * f1;
  }
}

/**
 * Single step Dormand-Prince 5(4) (DOPRI5) adaptive Runge-Kutta integrator with FSAL.
 * Returns true if step was accepted within error bounds, false if rejected.
 */
@inline
export function stepDopri5(
  dae: DaeBuilder,
  varValuesPtr: u32,
  kStagesPtr: u32,
  tempValuesPtr: u32,
  yNewPtr: u32,
  dt: f64,
  atol: f64,
  rtol: f64
): bool {
  let numVars = dae.varCount;
  if (numVars == 0) return true;

  let k0Ptr = kStagesPtr;
  let k1Ptr = kStagesPtr + numVars * 8;
  let k2Ptr = kStagesPtr + numVars * 8 * 2;
  let k3Ptr = kStagesPtr + numVars * 8 * 3;
  let k4Ptr = kStagesPtr + numVars * 8 * 4;
  let k5Ptr = kStagesPtr + numVars * 8 * 5;
  let k6Ptr = kStagesPtr + numVars * 8 * 6;

  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);
  let tempValues = changetype<UnmanagedFloat64Array>(tempValuesPtr as usize);
  let yNew = changetype<UnmanagedFloat64Array>(yNewPtr as usize);
  let k0 = changetype<UnmanagedFloat64Array>(k0Ptr as usize);
  let k1 = changetype<UnmanagedFloat64Array>(k1Ptr as usize);
  let k2 = changetype<UnmanagedFloat64Array>(k2Ptr as usize);
  let k3 = changetype<UnmanagedFloat64Array>(k3Ptr as usize);
  let k4 = changetype<UnmanagedFloat64Array>(k4Ptr as usize);
  let k5 = changetype<UnmanagedFloat64Array>(k5Ptr as usize);
  let k6 = changetype<UnmanagedFloat64Array>(k6Ptr as usize);

  // Stage 0: k0 = f(y0)
  computeDerivatives(dae, varValuesPtr, k0Ptr);

  // Stage 1
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = varValues[v];
    tempValues[v] = y0 + dt * (0.2) * k0[v];
  }
  computeDerivatives(dae, tempValuesPtr, k1Ptr);

  // Stage 2
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = varValues[v];
    tempValues[v] = y0 + dt * ((3.0 / 40.0) * k0[v] + (9.0 / 40.0) * k1[v]);
  }
  computeDerivatives(dae, tempValuesPtr, k2Ptr);

  // Stage 3
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = varValues[v];
    tempValues[v] = y0 + dt * ((44.0 / 45.0) * k0[v] - (56.0 / 15.0) * k1[v] + (32.0 / 9.0) * k2[v]);
  }
  computeDerivatives(dae, tempValuesPtr, k3Ptr);

  // Stage 4
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = varValues[v];
    tempValues[v] =
      y0 + dt * ((19372.0 / 6561.0) * k0[v] - (25360.0 / 2187.0) * k1[v] + (64448.0 / 6561.0) * k2[v] - (212.0 / 729.0) * k3[v]);
  }
  computeDerivatives(dae, tempValuesPtr, k4Ptr);

  // Stage 5
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = varValues[v];
    tempValues[v] =
      y0 +
      dt *
        ((9017.0 / 3168.0) * k0[v] -
          (355.0 / 33.0) * k1[v] +
          (46732.0 / 5247.0) * k2[v] +
          (49.0 / 176.0) * k3[v] -
          (5103.0 / 18656.0) * k4[v]);
  }
  computeDerivatives(dae, tempValuesPtr, k5Ptr);

  // Stage 6 (5th order solution)
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = varValues[v];
    let y5th =
      y0 +
      dt *
        ((35.0 / 384.0) * k0[v] +
          (500.0 / 1113.0) * k2[v] +
          (125.0 / 192.0) * k3[v] -
          (2187.0 / 6784.0) * k4[v] +
          (11.0 / 84.0) * k5[v]);
    yNew[v] = y5th;
  }

  // FSAL Stage 7: f(y5th)
  computeDerivatives(dae, yNewPtr, k6Ptr);

  // Error evaluation against scaled norm
  let maxErrNorm: f64 = 0.0;
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = varValues[v];
    let y5th = yNew[v];

    let errI =
      dt *
      ((71.0 / 57600.0) * k0[v] -
        (71.0 / 16695.0) * k2[v] +
        (71.0 / 1920.0) * k3[v] -
        (17253.0 / 339200.0) * k4[v] +
        (22.0 / 525.0) * k5[v] -
        (1.0 / 40.0) * k6[v]);
    let absY0 = Math.abs(y0);
    let absY5th = Math.abs(y5th);
    let maxY = absY0 > absY5th ? absY0 : absY5th;
    let sc = atol + rtol * maxY;
    if (sc < 1e-15) sc = 1e-15;
    let scaledErr = Math.abs(errI) / sc;
    if (scaledErr > maxErrNorm) maxErrNorm = scaledErr;
  }

  if (maxErrNorm <= 1.0) {
    for (let v: u32 = 0; v < numVars; v++) {
      varValues[v] = yNew[v];
    }
    solveAlgebraicConstraints(dae, varValuesPtr);
    return true;
  }

  return false;
}

/**
 * Executes a Backward Differentiation Formula (BDF) implicit integration step of order 1, 2, or 3 for stiff ODE systems.
 */
@inline
export function stepBDF(
  dae: DaeBuilder,
  varValuesPtr: u32,
  historyBufPtr: u32,
  scratchPtr: u32,
  dt: f64,
  order: i32
): bool {
  let numVars = dae.varCount;
  if (numVars == 0) return true;

  // BDF Coefficients
  let beta0: f64 = 1.0;
  let c1: f64 = 1.0;
  let c2: f64 = 0.0;
  let c3: f64 = 0.0;

  if (order == 2) {
    beta0 = 2.0 / 3.0;
    c1 = 4.0 / 3.0;
    c2 = -1.0 / 3.0;
  } else if (order >= 3) {
    beta0 = 6.0 / 11.0;
    c1 = 18.0 / 11.0;
    c2 = -9.0 / 11.0;
    c3 = 2.0 / 11.0;
  }

  // Lay out memory offsets in scratch buffer
  let yPredPtr = scratchPtr;
  let rPtr = yPredPtr + numVars * 8;
  let dxPtr = rPtr + numVars * 8;
  let jPtr = dxPtr + numVars * 8;
  let pivPtr = jPtr + numVars * numVars * 8;
  let pivSize = (numVars * 4 + 7) & ~7;
  let scalePtr = pivPtr + pivSize;
  let luScratchPtr = scalePtr + numVars * 8;
  let fEvalPtr = luScratchPtr + numVars * 8;
  let fPerturbPtr = fEvalPtr + numVars * 8;

  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);
  let yPred = changetype<UnmanagedFloat64Array>(yPredPtr as usize);
  let r = changetype<UnmanagedFloat64Array>(rPtr as usize);
  let dx = changetype<UnmanagedFloat64Array>(dxPtr as usize);
  let jMat = DenseMatrixView.at(jPtr as usize, numVars, numVars);
  let fEval = changetype<UnmanagedFloat64Array>(fEvalPtr as usize);
  let fPerturb = changetype<UnmanagedFloat64Array>(fPerturbPtr as usize);
  let historyBuf = DenseMatrixView.at(historyBufPtr as usize, 3, numVars);

  // Compute predictor y_pred from history steps
  for (let v: u32 = 0; v < numVars; v++) {
    let yHist1 = historyBuf.get(0, v);
    let yHist2 = historyBuf.get(1, v);
    let yHist3 = historyBuf.get(2, v);

    let pred = c1 * yHist1 + c2 * yHist2 + c3 * yHist3;
    yPred[v] = pred;
    varValues[v] = pred; // Initial guess
  }

  let betaDt = beta0 * dt;
  let maxIter: u32 = 20;
  let tol: f64 = 1e-8;
  let eps: f64 = 1e-7;

  for (let iter: u32 = 0; iter < maxIter; iter++) {
    computeDerivatives(dae, varValuesPtr, fEvalPtr);

    // Compute residual R = y - yPred - betaDt * f(y)
    for (let i: u32 = 0; i < numVars; i++) {
      let yVal = varValues[i];
      let yPredVal = yPred[i];
      let fVal = fEval[i];
      r[i] = yVal - yPredVal - betaDt * fVal;
    }

    // Check convergence: ||R||_inf < tol
    let normR = vectorNormInf(rPtr, numVars);
    if (normR < tol) {
      solveAlgebraicConstraints(dae, varValuesPtr);
      return true;
    }

    // Build Jacobian J = I - betaDt * df/dy via finite differences
    for (let j: u32 = 0; j < numVars; j++) {
      let origY = varValues[j];
      let hJ = eps * Math.max(Math.abs(origY), 1.0);
      varValues[j] = origY + hJ;

      computeDerivatives(dae, varValuesPtr, fPerturbPtr);
      varValues[j] = origY; // restore

      for (let i: u32 = 0; i < numVars; i++) {
        let fOrig = fEval[i];
        let fPert = fPerturb[i];
        let dfdy = (fPert - fOrig) / hJ;

        let ji = (i == j ? 1.0 : 0.0) - betaDt * dfdy;
        jMat.set(i, j, ji);
      }
    }

    // Solve J * dx = R
    if (!luFactor(jPtr, pivPtr, scalePtr, numVars)) return false;
    for (let i: u32 = 0; i < numVars; i++) {
      dx[i] = r[i];
    }
    luSolve(jPtr, pivPtr, scalePtr, dxPtr, luScratchPtr, numVars);

    // Apply Newton step: y = y - dx
    for (let i: u32 = 0; i < numVars; i++) {
      varValues[i] -= dx[i];
    }
  }

  return false;
}

/**
 * Radau IIA (Order 3, 2-Stage) Implicit Runge-Kutta Integrator for Stiff DAE Systems.
 * Stiffly accurate L-stable integrator with automated stage-residual Newton convergence.
 */
@inline
export function stepRadauIIA(
  dae: DaeBuilder,
  varValuesPtr: u32,
  stageYPtr: u32,
  scratchPtr: u32,
  dt: f64
): bool {
  let numVars = dae.varCount;
  if (numVars == 0) return true;

  // Radau IIA 2-Stage Butcher Coefficients
  let a11: f64 = 5.0 / 12.0;
  let a12: f64 = -1.0 / 12.0;
  let a21: f64 = 3.0 / 4.0;
  let a22: f64 = 1.0 / 4.0;

  let y1Ptr = stageYPtr;
  let y2Ptr = stageYPtr + numVars * 8;
  let f1Ptr = stageYPtr + numVars * 8 * 2;
  let f2Ptr = stageYPtr + numVars * 8 * 3;

  // Scratch memory layout for 2N dimension coupled Newton system
  let dim2N = numVars * 2;
  let rPtr = scratchPtr;
  let dxPtr = rPtr + dim2N * 8;
  let jPtr = dxPtr + dim2N * 8;
  let pivPtr = jPtr + dim2N * dim2N * 8;
  let scalePtr = pivPtr + dim2N * 4;
  let luScratchPtr = scalePtr + dim2N * 8;
  let fPerturbPtr = luScratchPtr + dim2N * 8;

  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);
  let y1 = changetype<UnmanagedFloat64Array>(y1Ptr as usize);
  let y2 = changetype<UnmanagedFloat64Array>(y2Ptr as usize);
  let f1 = changetype<UnmanagedFloat64Array>(f1Ptr as usize);
  let f2 = changetype<UnmanagedFloat64Array>(f2Ptr as usize);
  let r = changetype<UnmanagedFloat64Array>(rPtr as usize);
  let dx = changetype<UnmanagedFloat64Array>(dxPtr as usize);
  let jMat = DenseMatrixView.at(jPtr as usize, dim2N, dim2N);
  let fPerturb = changetype<UnmanagedFloat64Array>(fPerturbPtr as usize);

  // Initial stage guess: Y1 = y_n, Y2 = y_n
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = varValues[v];
    y1[v] = y0;
    y2[v] = y0;
  }

  let maxIter: u32 = 25;
  let tol: f64 = 1e-9;
  let eps: f64 = 1e-7;

  for (let iter: u32 = 0; iter < maxIter; iter++) {
    computeDerivatives(dae, y1Ptr, f1Ptr);
    computeDerivatives(dae, y2Ptr, f2Ptr);

    // 1. Evaluate Residual R1 and R2
    for (let i: u32 = 0; i < numVars; i++) {
      let y0 = varValues[i];
      let y1Val = y1[i];
      let y2Val = y2[i];
      let f1Val = f1[i];
      let f2Val = f2[i];

      let r1 = y1Val - y0 - dt * (a11 * f1Val + a12 * f2Val);
      let r2 = y2Val - y0 - dt * (a21 * f1Val + a22 * f2Val);

      r[i] = r1;
      r[numVars + i] = r2;
    }

    // Check convergence: ||R||_inf < tol
    let normR = vectorNormInf(rPtr, dim2N);
    if (normR < tol) {
      // Radau IIA is stiffly accurate: y_{n+1} = Y2
      for (let v: u32 = 0; v < numVars; v++) {
        varValues[v] = y2[v];
      }
      solveAlgebraicConstraints(dae, varValuesPtr);
      return true;
    }

    // 2. Build Block 2N x 2N Jacobian via finite differences
    for (let j: u32 = 0; j < numVars; j++) {
      let y1Orig = y1[j];
      let hJ1 = eps * Math.max(Math.abs(y1Orig), 1.0);
      y1[j] = y1Orig + hJ1;
      computeDerivatives(dae, y1Ptr, fPerturbPtr);
      y1[j] = y1Orig;

      for (let i: u32 = 0; i < numVars; i++) {
        let f1Orig = f1[i];
        let df1dy1 = (fPerturb[i] - f1Orig) / hJ1;

        // Block (1, 1): I - dt * a11 * df1/dy1
        let j11 = (i == j ? 1.0 : 0.0) - dt * a11 * df1dy1;
        jMat.set(i, j, j11);

        // Block (2, 1): -dt * a21 * df1/dy1
        let j21 = -dt * a21 * df1dy1;
        jMat.set(numVars + i, j, j21);
      }

      let y2Orig = y2[j];
      let hJ2 = eps * Math.max(Math.abs(y2Orig), 1.0);
      y2[j] = y2Orig + hJ2;
      computeDerivatives(dae, y2Ptr, fPerturbPtr);
      y2[j] = y2Orig;

      for (let i: u32 = 0; i < numVars; i++) {
        let f2Orig = f2[i];
        let df2dy2 = (fPerturb[i] - f2Orig) / hJ2;

        // Block (1, 2): -dt * a12 * df2/dy2
        let j12 = -dt * a12 * df2dy2;
        jMat.set(i, numVars + j, j12);

        // Block (2, 2): I - dt * a22 * df2/dy2
        let j22 = (i == j ? 1.0 : 0.0) - dt * a22 * df2dy2;
        jMat.set(numVars + i, numVars + j, j22);
      }
    }

    // 3. Solve J * dx = R
    if (!luFactor(jPtr, pivPtr, scalePtr, dim2N)) return false;
    for (let i: u32 = 0; i < dim2N; i++) {
      dx[i] = r[i];
    }
    luSolve(jPtr, pivPtr, scalePtr, dxPtr, luScratchPtr, dim2N);

    // 4. Update stages: Y1 = Y1 - dx1, Y2 = Y2 - dx2
    for (let i: u32 = 0; i < numVars; i++) {
      y1[i] -= dx[i];
      y2[i] -= dx[numVars + i];
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Simulation & Integrator Bridge Functions
// ─────────────────────────────────────────────────────────────────────────────

export function sim_stepEuler(daePtr: u32, varValuesPtr: u32, dt: f64): void {
  stepEuler(changetype<DaeBuilder>(daePtr), varValuesPtr, dt);
}

export function sim_stepRK4(
  daePtr: u32,
  varValuesPtr: u32,
  tempPtr: u32,
  k1Ptr: u32,
  k2Ptr: u32,
  k3Ptr: u32,
  k4Ptr: u32,
  dt: f64
): void {
  stepRK4(changetype<DaeBuilder>(daePtr), varValuesPtr, tempPtr, k1Ptr, k2Ptr, k3Ptr, k4Ptr, dt);
}

export function sim_stepDopri5(
  daePtr: u32,
  varValuesPtr: u32,
  kStagesPtr: u32,
  tempValuesPtr: u32,
  yNewPtr: u32,
  dt: f64,
  atol: f64,
  rtol: f64
): bool {
  return stepDopri5(changetype<DaeBuilder>(daePtr), varValuesPtr, kStagesPtr, tempValuesPtr, yNewPtr, dt, atol, rtol);
}

export function sim_stepRadauIIA(
  daePtr: u32,
  varValuesPtr: u32,
  stageYPtr: u32,
  scratchPtr: u32,
  dt: f64
): bool {
  return stepRadauIIA(changetype<DaeBuilder>(daePtr), varValuesPtr, stageYPtr, scratchPtr, dt);
}

export function sim_stepBDF(
  daePtr: u32,
  varValuesPtr: u32,
  historyBufPtr: u32,
  scratchPtr: u32,
  dt: f64,
  order: i32
): bool {
  return stepBDF(changetype<DaeBuilder>(daePtr), varValuesPtr, historyBufPtr, scratchPtr, dt, order);
}

export function sim_interpolateDenseOutput(
  y0Ptr: u32,
  y1Ptr: u32,
  k1Ptr: u32,
  k7Ptr: u32,
  dt: f64,
  theta: f64,
  numVars: u32,
  outPtr: u32
): void {
  hermiteInterpolate(y0Ptr, y1Ptr, k1Ptr, k7Ptr, dt, theta, numVars, outPtr);
}

