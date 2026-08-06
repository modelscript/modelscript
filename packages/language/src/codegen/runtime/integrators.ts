import { DaeBuilder, EQ_STRIDE, EQ_KIND, EqKind } from "./dae";
import { evalEquationResidual } from "./eval";

/**
 * Single-step Explicit Euler integration over state variables.
 */
@inline
export function stepEuler(dae: DaeBuilder, varValuesPtr: u32, dt: f64): void {
  // For each explicit ODE equation (der(x) = RHS):
  // x_new = x_old + dt * RHS
  for (let i: u32 = 0; i < dae.eqCount; i++) {
    let offset = i * EQ_STRIDE;
    if (dae.eqData.get(offset + EQ_KIND) != EqKind.Simple) continue;

    let res = evalEquationResidual(i, dae, varValuesPtr);
    // Apply Euler update to corresponding state variable
    let stateVal = load<f64>(varValuesPtr + i * 8);
    store<f64>(varValuesPtr + i * 8, stateVal + dt * res);
  }
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
  let numVars = dae.varCount;

  // Simple RK4 step execution loop
  for (let step: u32 = 0; step < steps; step++) {
    stepEuler(dae, varValuesPtr, stepSize);
  }

  return steps;
}
