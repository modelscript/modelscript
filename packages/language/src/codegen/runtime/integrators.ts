import { DaeBuilder, EQ_STRIDE, EQ_KIND, EqKind, EQ_LHS, EQ_RHS, EXPR_STRIDE, EXPR_KIND, ExprKind, EXPR_DATA1 } from "./dae";
import { evalEquationResidual } from "./eval";
import { getWarmStartValue, setWarmStartValue } from "./isolation";

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
