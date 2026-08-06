import { DaeBuilder, EQ_STRIDE, EQ_KIND, EqKind, EQ_LHS, EQ_RHS, EXPR_STRIDE, EXPR_KIND, ExprKind, EXPR_DATA1 } from "./dae";
import { evalEquationResidual } from "./eval";
import { EventDetector } from "./events";
import { getWarmStartValue, setWarmStartValue } from "./isolation";
import { luFactor, luSolve, vectorNormInf } from "./matrix";

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
  let scalePtr = pivPtr + n * 4;
  let luScratchPtr = scalePtr + n * 8;

  // Warm-start variables if cached values exist
  for (let i: u32 = 0; i < n; i++) {
    let vIdx = load<u32>(varIndicesPtr + i * 4);
    let warmVal = getWarmStartValue(vIdx);
    if (warmVal != 0.0) {
      store<f64>(varValuesPtr + vIdx * 8, warmVal);
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
      let eqIdx = load<u32>(eqIndicesPtr + i * 4);
      let res = evalEquationResidual(eqIdx, dae, varValuesPtr);
      store<f64>(rPtr + i * 8, res);
    }

    // 2. Check Convergence: ||R||_inf < tol
    let normR = vectorNormInf(rPtr, n);
    if (normR < tol) break;

    // 3. Construct Finite-Difference Jacobian Matrix J (N x N)
    for (let j: u32 = 0; j < n; j++) {
      let vIdx = load<u32>(varIndicesPtr + j * 4);
      let xOrig = load<f64>(varValuesPtr + vIdx * 8);

      // Perturb variable x_j
      store<f64>(varValuesPtr + vIdx * 8, xOrig + eps);

      for (let i: u32 = 0; i < n; i++) {
        let eqIdx = load<u32>(eqIndicesPtr + i * 4);
        let resPlus = evalEquationResidual(eqIdx, dae, varValuesPtr);
        let resOrig = load<f64>(rPtr + i * 8);
        let der = (resPlus - resOrig) / eps;

        // Store into J[i, j] (row-major)
        store<f64>(jPtr + (i * n + j) * 8, der);
      }

      // Restore variable x_j
      store<f64>(varValuesPtr + vIdx * 8, xOrig);
    }

    // 4. LU Factorization of J
    let success = luFactor(jPtr, pivPtr, scalePtr, n);
    if (!success) return false;

    // 5. Solve J * dx = R (dxPtr initially holds RHS = R)
    for (let i: u32 = 0; i < n; i++) {
      store<f64>(dxPtr + i * 8, load<f64>(rPtr + i * 8));
    }
    luSolve(jPtr, pivPtr, scalePtr, dxPtr, luScratchPtr, n);

    // 6. Armijo Backtracking Line Search along direction -dx
    let alpha: f64 = 1.0;
    let stepAccepted = false;

    while (alpha > 0.0625) {
      // Apply candidate update: x_new = x_old - alpha * dx
      for (let j: u32 = 0; j < n; j++) {
        let vIdx = load<u32>(varIndicesPtr + j * 4);
        let xOrig = load<f64>(varValuesPtr + vIdx * 8);
        let delta = load<f64>(dxPtr + j * 8);
        store<f64>(varValuesPtr + vIdx * 8, xOrig - alpha * delta);
      }

      // Evaluate new residual norm
      let maxNewRes: f64 = 0.0;
      for (let i: u32 = 0; i < n; i++) {
        let eqIdx = load<u32>(eqIndicesPtr + i * 4);
        let resNew = Math.abs(evalEquationResidual(eqIdx, dae, varValuesPtr));
        if (resNew > maxNewRes) maxNewRes = resNew;
      }

      if (maxNewRes < normR) {
        stepAccepted = true;
        break; // Step reduces residual, accept step
      }

      // Revert state update before reducing alpha
      for (let j: u32 = 0; j < n; j++) {
        let vIdx = load<u32>(varIndicesPtr + j * 4);
        let xOrig = load<f64>(varValuesPtr + vIdx * 8);
        let delta = load<f64>(dxPtr + j * 8);
        store<f64>(varValuesPtr + vIdx * 8, xOrig + alpha * delta);
      }

      alpha *= 0.5;
    }

    if (!stepAccepted) {
      // If line search failed to reduce residual, take full step as fallback
      for (let j: u32 = 0; j < n; j++) {
        let vIdx = load<u32>(varIndicesPtr + j * 4);
        let xOrig = load<f64>(varValuesPtr + vIdx * 8);
        let delta = load<f64>(dxPtr + j * 8);
        store<f64>(varValuesPtr + vIdx * 8, xOrig - delta);
      }
    }
  }

  // Update warm-start cache for all variables in block
  for (let i: u32 = 0; i < n; i++) {
    let vIdx = load<u32>(varIndicesPtr + i * 4);
    let xFinal = load<f64>(varValuesPtr + vIdx * 8);
    setWarmStartValue(vIdx, xFinal);
  }

  return true;
}

/**
 * Solves and enforces algebraic constraints across state vectors.
 * Uses warm-started 1x1 Newton-Raphson iteration with Armijo line search.
 */
@inline
export function solveAlgebraicConstraints(dae: DaeBuilder, varValuesPtr: u32): void {
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let offset = i * EQ_STRIDE;
    if (dae.eqData.get(offset + EQ_KIND) != EqKind.Simple) continue;

    // Check if equation target LHS is a non-derivative variable
    let lhsExpr = dae.eqData.get(offset + EQ_LHS);
    if (lhsExpr == 0xffffffff) continue;

    let lhsOffset = lhsExpr * EXPR_STRIDE;
    let lhsKind = dae.exprData.get(lhsOffset + EXPR_KIND);
    if (lhsKind != ExprKind.Name) continue; // Only handle algebraic variable assignments

    let targetVarIdx = dae.exprData.get(lhsOffset + EXPR_DATA1) as u32;
    if (targetVarIdx >= dae.varCount) continue;

    // Retrieve warm start value if available
    let warmVal = getWarmStartValue(targetVarIdx);
    if (warmVal != 0.0) {
      store<f64>(varValuesPtr + targetVarIdx * 8, warmVal);
    }

    let x: f64 = load<f64>(varValuesPtr + targetVarIdx * 8);
    let tol: f64 = 1e-10;
    let maxIter: u32 = 25;
    let iter: u32 = 0;

    while (iter < maxIter) {
      iter++;
      let res = evalEquationResidual(i, dae, varValuesPtr);
      if (Math.abs(res) < tol) break;

      // Numerical finite difference derivative in CPU registers
      let eps: f64 = 1e-7;
      store<f64>(varValuesPtr + targetVarIdx * 8, x + eps);
      let resPlus = evalEquationResidual(i, dae, varValuesPtr);
      store<f64>(varValuesPtr + targetVarIdx * 8, x);

      let der = (resPlus - res) / eps;
      if (Math.abs(der) < 1e-14) der = der >= 0 ? 1e-6 : -1e-6;

      let step = res / der;

      // Armijo backtracking
      let alpha: f64 = 1.0;
      let xNew = x - step;
      store<f64>(varValuesPtr + targetVarIdx * 8, xNew);
      let resNew = Math.abs(evalEquationResidual(i, dae, varValuesPtr));

      while (resNew >= Math.abs(res) && alpha > 0.0625) {
        alpha *= 0.5;
        xNew = x - alpha * step;
        store<f64>(varValuesPtr + targetVarIdx * 8, xNew);
        resNew = Math.abs(evalEquationResidual(i, dae, varValuesPtr));
      }

      x = xNew;
    }

    store<f64>(varValuesPtr + targetVarIdx * 8, x);
    setWarmStartValue(targetVarIdx, x);
  }
}

/**
 * Single-step Explicit Euler integration over state variables with DAE algebraic loop convergence.
 */
@inline
export function stepEuler(dae: DaeBuilder, varValuesPtr: u32, dt: f64): void {
  // 1. Explicit ODE State Update
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let offset = i * EQ_STRIDE;
    if (dae.eqData.get(offset + EQ_KIND) != EqKind.Simple) continue;

    let lhsExpr = dae.eqData.get(offset + EQ_LHS);
    if (lhsExpr == 0xffffffff) continue;

    let lhsOffset = lhsExpr * EXPR_STRIDE;
    if (dae.exprData.get(lhsOffset + EXPR_KIND) == ExprKind.Der) {
      let stateVarIdx = dae.exprData.get(lhsOffset + EXPR_DATA1);
      let res = evalEquationResidual(i, dae, varValuesPtr);
      let stateVal = load<f64>(varValuesPtr + stateVarIdx * 8);
      store<f64>(varValuesPtr + stateVarIdx * 8, stateVal + dt * res);
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
  let numVars = dae.varCount;

  // 1. Compute k1 = f(y_n)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let k1 = evalEquationResidual(i, dae, varValuesPtr);
    store<f64>(k1Ptr + i * 8, k1);
    let y0 = load<f64>(varValuesPtr + i * 8);
    store<f64>(tempPtr + i * 8, y0 + 0.5 * dt * k1);
  }

  // 2. Compute k2 = f(y_n + 0.5*dt*k1)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let k2 = evalEquationResidual(i, dae, tempPtr);
    store<f64>(k2Ptr + i * 8, k2);
    let y0 = load<f64>(varValuesPtr + i * 8);
    store<f64>(tempPtr + i * 8, y0 + 0.5 * dt * k2);
  }

  // 3. Compute k3 = f(y_n + 0.5*dt*k2)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let k3 = evalEquationResidual(i, dae, tempPtr);
    store<f64>(k3Ptr + i * 8, k3);
    let y0 = load<f64>(varValuesPtr + i * 8);
    store<f64>(tempPtr + i * 8, y0 + dt * k3);
  }

  // 4. Compute k4 = f(y_n + dt*k3)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let k4 = evalEquationResidual(i, dae, tempPtr);
    store<f64>(k4Ptr + i * 8, k4);
  }

  // 5. Final update: y_{n+1} = y_n + (dt/6) * (k1 + 2*k2 + 2*k3 + k4)
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let y0 = load<f64>(varValuesPtr + i * 8);
    let k1 = load<f64>(k1Ptr + i * 8);
    let k2 = load<f64>(k2Ptr + i * 8);
    let k3 = load<f64>(k3Ptr + i * 8);
    let k4 = load<f64>(k4Ptr + i * 8);

    let yNext = y0 + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    store<f64>(varValuesPtr + i * 8, yNext);
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

  for (let step: u32 = 0; step < steps; step++) {
    let t0 = startTime + (step as f64) * stepSize;

    // 1. Copy starting state to temp buffer
    for (let v: u32 = 0; v < numVars; v++) {
      store<f64>(tempValuesPtr + v * 8, load<f64>(varValuesPtr + v * 8));
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
  for (let v: u32 = 0; v < numVars; v++) {
    store<f64>(kOutPtr + v * 8, 0.0);
  }

  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let offset = i * EQ_STRIDE;
    if (dae.eqData.get(offset + EQ_KIND) != EqKind.Simple) continue;

    let lhsExpr = dae.eqData.get(offset + EQ_LHS);
    if (lhsExpr == 0xffffffff) continue;

    let lhsOffset = lhsExpr * EXPR_STRIDE;
    if (dae.exprData.get(lhsOffset + EXPR_KIND) == ExprKind.Der) {
      let stateVarIdx = dae.exprData.get(lhsOffset + EXPR_DATA1) as u32;
      if (stateVarIdx < numVars) {
        let res = evalEquationResidual(i, dae, varValuesPtr);
        store<f64>(kOutPtr + stateVarIdx * 8, res);
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

  for (let i: u32 = 0; i < numVars; i++) {
    let y0 = load<f64>(y0Ptr + i * 8);
    let y1 = load<f64>(y1Ptr + i * 8);
    let f0 = load<f64>(k1Ptr + i * 8) * dt;
    let f1 = load<f64>(k7Ptr + i * 8) * dt;
    store<f64>(outPtr + i * 8, h00 * y0 + h10 * f0 + h01 * y1 + h11 * f1);
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

  // Stage 0: k0 = f(y0)
  computeDerivatives(dae, varValuesPtr, k0Ptr);

  // Stage 1
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = load<f64>(varValuesPtr + v * 8);
    let k0 = load<f64>(k0Ptr + v * 8);
    store<f64>(tempValuesPtr + v * 8, y0 + dt * (0.2) * k0);
  }
  computeDerivatives(dae, tempValuesPtr, k1Ptr);

  // Stage 2
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = load<f64>(varValuesPtr + v * 8);
    let k0 = load<f64>(k0Ptr + v * 8);
    let k1 = load<f64>(k1Ptr + v * 8);
    store<f64>(tempValuesPtr + v * 8, y0 + dt * ((3.0 / 40.0) * k0 + (9.0 / 40.0) * k1));
  }
  computeDerivatives(dae, tempValuesPtr, k2Ptr);

  // Stage 3
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = load<f64>(varValuesPtr + v * 8);
    let k0 = load<f64>(k0Ptr + v * 8);
    let k1 = load<f64>(k1Ptr + v * 8);
    let k2 = load<f64>(k2Ptr + v * 8);
    store<f64>(tempValuesPtr + v * 8, y0 + dt * ((44.0 / 45.0) * k0 - (56.0 / 15.0) * k1 + (32.0 / 9.0) * k2));
  }
  computeDerivatives(dae, tempValuesPtr, k3Ptr);

  // Stage 4
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = load<f64>(varValuesPtr + v * 8);
    let k0 = load<f64>(k0Ptr + v * 8);
    let k1 = load<f64>(k1Ptr + v * 8);
    let k2 = load<f64>(k2Ptr + v * 8);
    let k3 = load<f64>(k3Ptr + v * 8);
    store<f64>(
      tempValuesPtr + v * 8,
      y0 + dt * ((19372.0 / 6561.0) * k0 - (25360.0 / 2187.0) * k1 + (64448.0 / 6561.0) * k2 - (212.0 / 729.0) * k3)
    );
  }
  computeDerivatives(dae, tempValuesPtr, k4Ptr);

  // Stage 5
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = load<f64>(varValuesPtr + v * 8);
    let k0 = load<f64>(k0Ptr + v * 8);
    let k1 = load<f64>(k1Ptr + v * 8);
    let k2 = load<f64>(k2Ptr + v * 8);
    let k3 = load<f64>(k3Ptr + v * 8);
    let k4 = load<f64>(k4Ptr + v * 8);
    store<f64>(
      tempValuesPtr + v * 8,
      y0 + dt * ((9017.0 / 3168.0) * k0 - (355.0 / 33.0) * k1 + (46732.0 / 5247.0) * k2 + (49.0 / 176.0) * k3 - (5103.0 / 18656.0) * k4)
    );
  }
  computeDerivatives(dae, tempValuesPtr, k5Ptr);

  // Stage 6 (5th order solution)
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = load<f64>(varValuesPtr + v * 8);
    let k0 = load<f64>(k0Ptr + v * 8);
    let k2 = load<f64>(k2Ptr + v * 8);
    let k3 = load<f64>(k3Ptr + v * 8);
    let k4 = load<f64>(k4Ptr + v * 8);
    let k5 = load<f64>(k5Ptr + v * 8);
    let y5th = y0 + dt * ((35.0 / 384.0) * k0 + (500.0 / 1113.0) * k2 + (125.0 / 192.0) * k3 - (2187.0 / 6784.0) * k4 + (11.0 / 84.0) * k5);
    store<f64>(yNewPtr + v * 8, y5th);
  }

  // FSAL Stage 7: f(y5th)
  computeDerivatives(dae, yNewPtr, k6Ptr);

  // Error evaluation against scaled norm
  let maxErrNorm: f64 = 0.0;
  for (let v: u32 = 0; v < numVars; v++) {
    let y0 = load<f64>(varValuesPtr + v * 8);
    let y5th = load<f64>(yNewPtr + v * 8);
    let k0 = load<f64>(k0Ptr + v * 8);
    let k2 = load<f64>(k2Ptr + v * 8);
    let k3 = load<f64>(k3Ptr + v * 8);
    let k4 = load<f64>(k4Ptr + v * 8);
    let k5 = load<f64>(k5Ptr + v * 8);
    let k6 = load<f64>(k6Ptr + v * 8);

    let errI = dt * ((71.0 / 57600.0) * k0 - (71.0 / 16695.0) * k2 + (71.0 / 1920.0) * k3 - (17253.0 / 339200.0) * k4 + (22.0 / 525.0) * k5 - (1.0 / 40.0) * k6);
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
      store<f64>(varValuesPtr + v * 8, load<f64>(yNewPtr + v * 8));
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
  let scalePtr = pivPtr + numVars * 4;
  let luScratchPtr = scalePtr + numVars * 8;
  let fEvalPtr = luScratchPtr + numVars * 8;
  let fPerturbPtr = fEvalPtr + numVars * 8;

  // Compute predictor y_pred from history steps
  for (let v: u32 = 0; v < numVars; v++) {
    let yHist1 = load<f64>(historyBufPtr + 0 * numVars * 8 + v * 8);
    let yHist2 = load<f64>(historyBufPtr + 1 * numVars * 8 + v * 8);
    let yHist3 = load<f64>(historyBufPtr + 2 * numVars * 8 + v * 8);

    let pred = c1 * yHist1 + c2 * yHist2 + c3 * yHist3;
    store<f64>(yPredPtr + v * 8, pred);
    store<f64>(varValuesPtr + v * 8, pred); // Initial guess
  }

  let betaDt = beta0 * dt;
  let maxIter: u32 = 20;
  let tol: f64 = 1e-8;
  let eps: f64 = 1e-7;

  for (let iter: u32 = 0; iter < maxIter; iter++) {
    computeDerivatives(dae, varValuesPtr, fEvalPtr);

    // Compute residual R = y - yPred - betaDt * f(y)
    for (let i: u32 = 0; i < numVars; i++) {
      let yVal = load<f64>(varValuesPtr + i * 8);
      let yPred = load<f64>(yPredPtr + i * 8);
      let fVal = load<f64>(fEvalPtr + i * 8);
      store<f64>(rPtr + i * 8, yVal - yPred - betaDt * fVal);
    }

    // Check convergence: ||R||_inf < tol
    let normR = vectorNormInf(rPtr, numVars);
    if (normR < tol) {
      solveAlgebraicConstraints(dae, varValuesPtr);
      return true;
    }

    // Build Jacobian J = I - betaDt * df/dy via finite differences
    for (let j: u32 = 0; j < numVars; j++) {
      let origY = load<f64>(varValuesPtr + j * 8);
      let hJ = eps * Math.max(Math.abs(origY), 1.0);
      store<f64>(varValuesPtr + j * 8, origY + hJ);

      computeDerivatives(dae, varValuesPtr, fPerturbPtr);
      store<f64>(varValuesPtr + j * 8, origY); // restore

      for (let i: u32 = 0; i < numVars; i++) {
        let fOrig = load<f64>(fEvalPtr + i * 8);
        let fPert = load<f64>(fPerturbPtr + i * 8);
        let dfdy = (fPert - fOrig) / hJ;

        let ji = (i == j ? 1.0 : 0.0) - betaDt * dfdy;
        store<f64>(jPtr + (i * numVars + j) * 8, ji);
      }
    }

    // Solve J * dx = R
    if (!luFactor(jPtr, pivPtr, scalePtr, numVars)) return false;
    for (let i: u32 = 0; i < numVars; i++) {
      store<f64>(dxPtr + i * 8, load<f64>(rPtr + i * 8));
    }
    luSolve(jPtr, pivPtr, scalePtr, dxPtr, luScratchPtr, numVars);

    // Apply Newton step: y = y - dx
    for (let i: u32 = 0; i < numVars; i++) {
      let yVal = load<f64>(varValuesPtr + i * 8);
      let dxVal = load<f64>(dxPtr + i * 8);
      store<f64>(varValuesPtr + i * 8, yVal - dxVal);
    }
  }

  return false;
}
