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
} from "./dae";
import { evalEquationResidual } from "./eval";
import { luFactor, luSolve, vectorNormInf } from "./matrix";
import { atomicChunkAlloc } from "./arena";

/**
 * Natural Parameter Homotopy Continuation Solver for Modelica 3.7.
 * Solves non-linear systems with complex initial algebraic loops by embedding a homotopy parameter:
 *   H(x, lambda) = lambda * f_actual(x) + (1 - lambda) * f_simplified(x) = 0
 * Tracks the equilibrium curve from lambda = 0 (easily solvable simplified system) to lambda = 1 (actual system)
 * using an adaptive Euler-Newton path tracking predictor-corrector method.
 */
@unmanaged
export class HomotopySolver {
  daePtr: u32;
  nVars: u32;
  lambda: f64;
  dLambda: f64;
  minDLambda: f64;
  maxDLambda: f64;
  tol: f64;
  maxCorrectorIter: u32;

  // Scratch memory for Newton corrector, tangent vector, and LU factorization
  // Memory layout:
  // - residual H(x, lambda): n * 8 bytes
  // - dx (correction / tangent): n * 8 bytes
  // - dH_dlambda: n * 8 bytes
  // - Jacobian J_x: n * n * 8 bytes
  // - piv: ((n * 4 + 7) & ~7) bytes
  // - scale: n * 8 bytes
  // - luScratch: n * 8 bytes
  scratchPtr: usize;

  init(daePtr: u32, nVars: u32, tol: f64): void {
    this.daePtr = daePtr;
    this.nVars = nVars;
    this.lambda = 0.0;
    this.dLambda = 0.1;
    this.minDLambda = 1e-5;
    this.maxDLambda = 0.25;
    this.tol = tol;
    this.maxCorrectorIter = 10;

    let n = nVars > 0 ? nVars : 1;
    let pivSize = (n * 4 + 7) & ~7;
    let totalScratch = (n * 8) + (n * 8) + (n * 8) + (n * n * 8) + pivSize + (n * 8) + (n * 8) + 128;
    this.scratchPtr = atomicChunkAlloc(totalScratch);
  }
}

/**
 * Evaluates homotopy residual vector:
 * H(x, lambda) = lambda * actualResidual(x) + (1 - lambda) * simpleResidual(x)
 */
@inline
function evalHomotopyResidual(
  solver: HomotopySolver,
  varValuesPtr: u32,
  lambda: f64,
  outRPtr: u32
): f64 {
  let dae = changetype<DaeBuilder>(solver.daePtr);
  let n = solver.nVars;
  let maxRes: f64 = 0.0;

  for (let eqIdx: u32 = 0; eqIdx < n; eqIdx++) {
    let baseRes = evalEquationResidual(eqIdx, dae, varValuesPtr);
    let hVal = lambda * baseRes + (1.0 - lambda) * (load<f64>(varValuesPtr + eqIdx * 8) - 1.0);
    store<f64>(outRPtr + eqIdx * 8, hVal);
    if (Math.abs(hVal) > maxRes) maxRes = Math.abs(hVal);
  }

  return maxRes;
}

/**
 * Evaluates Homotopy Jacobian J_x = dH/dx and parameter derivative dH/dlambda.
 */
@inline
function evalHomotopyJacobian(
  solver: HomotopySolver,
  varValuesPtr: u32,
  lambda: f64,
  jPtr: u32,
  dHdLamPtr: u32
): void {
  let dae = changetype<DaeBuilder>(solver.daePtr);
  let n = solver.nVars;
  let eps: f64 = 1e-7;

  // Compute dH/dlambda = f_actual(x) - f_simplified(x)
  for (let eqIdx: u32 = 0; eqIdx < n; eqIdx++) {
    let baseRes = evalEquationResidual(eqIdx, dae, varValuesPtr);
    let simpleRes = load<f64>(varValuesPtr + eqIdx * 8) - 1.0;
    store<f64>(dHdLamPtr + eqIdx * 8, baseRes - simpleRes);
  }

  // Compute J_x via finite difference perturbation
  for (let c: u32 = 0; c < n; c++) {
    let origVal = load<f64>(varValuesPtr + c * 8);
    store<f64>(varValuesPtr + c * 8, origVal + eps);

    for (let r: u32 = 0; r < n; r++) {
      let basePert = evalEquationResidual(r, dae, varValuesPtr);
      let hPert = lambda * basePert + (1.0 - lambda) * ((r == c ? origVal + eps : load<f64>(varValuesPtr + r * 8)) - 1.0);

      store<f64>(varValuesPtr + c * 8, origVal);
      let baseOrig = evalEquationResidual(r, dae, varValuesPtr);
      let hOrig = lambda * baseOrig + (1.0 - lambda) * (load<f64>(varValuesPtr + r * 8) - 1.0);

      let dh_dx = (hPert - hOrig) / eps;
      store<f64>(jPtr + (r * n + c) * 8, dh_dx);
    }
  }
}

/**
 * Solves the non-linear algebraic system using Homotopy Continuation path tracking from lambda = 0 to 1.
 */
export function solveHomotopy(
  solver: HomotopySolver,
  varValuesPtr: u32,
  maxSteps: u32
): bool {
  let n = solver.nVars;
  let dae = changetype<DaeBuilder>(solver.daePtr);

  let rPtr = solver.scratchPtr;
  let dxPtr = rPtr + n * 8;
  let dHdLamPtr = dxPtr + n * 8;
  let jPtr = dHdLamPtr + n * 8;
  let pivPtr = jPtr + n * n * 8;
  let pivSize = (n * 4 + 7) & ~7;
  let scalePtr = pivPtr + pivSize;
  let luScratchPtr = scalePtr + n * 8;

  solver.lambda = 0.0;
  let step: u32 = 0;

  // Initialize at lambda = 0 simplified root (e.g. x = 1.0)
  for (let i: u32 = 0; i < n; i++) {
    store<f64>(varValuesPtr + i * 8, 1.0);
  }

  while (solver.lambda < 1.0 && step < maxSteps) {
    step++;

    let targetLambda = solver.lambda + solver.dLambda;
    if (targetLambda > 1.0) targetLambda = 1.0;
    let actualStep = targetLambda - solver.lambda;

    // 1. Predictor Step: Tangent vector dx/dlambda = -J_x^{-1} * (dH/dlambda)
    evalHomotopyJacobian(solver, varValuesPtr, solver.lambda, jPtr as u32, dHdLamPtr as u32);

    let negDHPtr = luScratchPtr;
    for (let i: u32 = 0; i < n; i++) {
      store<f64>(negDHPtr + i * 8, -load<f64>(dHdLamPtr + i * 8));
    }

    if (luFactor(jPtr as u32, pivPtr as u32, scalePtr as u32, n)) {
      luSolve(jPtr as u32, pivPtr as u32, scalePtr as u32, negDHPtr as u32, dxPtr as u32, n);
      // Euler predictor: x_pred = x + actualStep * (dx/dlambda)
      for (let i: u32 = 0; i < n; i++) {
        let currX = load<f64>(varValuesPtr + i * 8);
        store<f64>(varValuesPtr + i * 8, currX + actualStep * load<f64>(negDHPtr + i * 8));
      }
    }

    solver.lambda = targetLambda;

    // 2. Corrector Step: Newton-Raphson loop at current lambda
    let correctorIter: u32 = 0;
    let converged: bool = false;

    while (correctorIter < solver.maxCorrectorIter) {
      correctorIter++;
      let maxRes = evalHomotopyResidual(solver, varValuesPtr, solver.lambda, rPtr as u32);
      if (maxRes < solver.tol) {
        converged = true;
        break;
      }

      evalHomotopyJacobian(solver, varValuesPtr, solver.lambda, jPtr as u32, dHdLamPtr as u32);
      for (let i: u32 = 0; i < n; i++) {
        store<f64>(negDHPtr + i * 8, -load<f64>(rPtr + i * 8));
      }

      if (!luFactor(jPtr as u32, pivPtr as u32, scalePtr as u32, n)) {
        break; // Singular Jacobian
      }

      luSolve(jPtr as u32, pivPtr as u32, scalePtr as u32, negDHPtr as u32, dxPtr as u32, n);
      for (let i: u32 = 0; i < n; i++) {
        let currX = load<f64>(varValuesPtr + i * 8);
        store<f64>(varValuesPtr + i * 8, currX + load<f64>(negDHPtr + i * 8));
      }
    }

    if (!converged) {
      // Step rejection: reduce dLambda and backtrack
      solver.lambda -= actualStep;
      solver.dLambda *= 0.5;
      if (solver.dLambda < solver.minDLambda) return false; // Path tracing failed
    } else {
      // Step acceptance: increase dLambda if convergence was rapid
      if (correctorIter <= 3 && solver.dLambda < solver.maxDLambda) {
        solver.dLambda *= 1.2;
      }
    }
  }

  return solver.lambda >= 1.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_createHomotopySolver(daePtr: u32, nVars: u32, tol: f64): u32 {
  if (daePtr == 0) return 0;
  let ptr = atomicChunkAlloc(256);
  let solver = changetype<HomotopySolver>(ptr);
  solver.init(daePtr, nVars, tol);
  return ptr as u32;
}

export function dae_solveHomotopy(solverPtr: u32, varValuesPtr: u32, maxSteps: u32): bool {
  if (solverPtr == 0) return false;
  let solver = changetype<HomotopySolver>(solverPtr);
  return solveHomotopy(solver, varValuesPtr, maxSteps);
}
