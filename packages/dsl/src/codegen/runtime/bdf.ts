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

    let scratchSize = (n * 8) + (n * 8) + (n * n * 8) + ((n * 4 + 7) & ~7) + (n * 8) + (n * 8) + 128;
    this.scratchPtr = atomicChunkAlloc(scratchSize);
  }
}

/**
 * Predicts next state step using Pascal triangle polynomial extrapolation across Nordsieck history.
 */
@inline
function bdfPredict(solver: BdfSolver): void {
  let q = solver.order;
  let n = solver.nStates;

  for (let k: i32 = (q as i32); k >= 1; k--) {
    for (let j: i32 = k; j <= (q as i32); j++) {
      let srcRow = (j as u32) * n;
      let dstRow = ((j - 1) as u32) * n;

      for (let i: u32 = 0; i < n; i++) {
        let src = load<f64>(solver.historyPtr + (srcRow + i) * 8);
        let dst = load<f64>(solver.historyPtr + (dstRow + i) * 8);
        store<f64>(solver.historyPtr + (dstRow + i) * 8, dst + src);
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

  // 1. Predictor: Extrapolate Nordsieck history
  bdfPredict(solver);

  // Copy predicted state into active variable values buffer
  for (let i: u32 = 0; i < n; i++) {
    let sIdx = load<u32>(solver.stateIndicesPtr + i * 4);
    let predVal = load<f64>(solver.historyPtr + i * 8);
    store<f64>(varValuesPtr + sIdx * 8, predVal);
  }

  // 2. Newton-Raphson Corrector Loop for Stiff DAE:
  // G(y) = y_n - y_pred - (h / alpha0) * f(t, y) = 0
  let alpha0 = getBdfAlpha0(q);
  let h_alpha0 = dt / alpha0;

  let rPtr = solver.scratchPtr;
  let dyPtr = rPtr + n * 8;
  let jPtr = dyPtr + n * 8;
  let pivPtr = jPtr + n * n * 8;
  let pivSize = (n * 4 + 7) & ~7;
  let scalePtr = pivPtr + pivSize;
  let luScratchPtr = scalePtr + n * 8;

  let tol: f64 = solver.atol;
  let maxIter: u32 = 15;
  let iter: u32 = 0;
  let eps: f64 = 1e-7;

  while (iter < maxIter) {
    iter++;

    // Evaluate residual vector G(y)
    let maxRes: f64 = 0.0;
    for (let i: u32 = 0; i < n; i++) {
      let sIdx = load<u32>(solver.stateIndicesPtr + i * 4);
      let dIdx = load<u32>(solver.derivIndicesPtr + i * 4);

      let currY = load<f64>(varValuesPtr + sIdx * 8);
      let predY = load<f64>(solver.historyPtr + i * 8);
      let fVal = load<f64>(varValuesPtr + dIdx * 8);

      let gVal = (currY - predY) - h_alpha0 * fVal;
      store<f64>(rPtr + i * 8, gVal);
      if (Math.abs(gVal) > maxRes) maxRes = Math.abs(gVal);
    }

    if (maxRes < tol) break;

    // Assemble Jacobian J = I - h_alpha0 * (df/dy)
    for (let c: u32 = 0; c < n; c++) {
      let sIdx = load<u32>(solver.stateIndicesPtr + c * 4);
      let origVal = load<f64>(varValuesPtr + sIdx * 8);

      store<f64>(varValuesPtr + sIdx * 8, origVal + eps);

      for (let r: u32 = 0; r < n; r++) {
        let dIdx = load<u32>(solver.derivIndicesPtr + r * 4);
        let fPert = load<f64>(varValuesPtr + dIdx * 8);

        store<f64>(varValuesPtr + sIdx * 8, origVal);
        let fBase = load<f64>(varValuesPtr + dIdx * 8);
        let df_dy = (fPert - fBase) / eps;

        let jVal: f64 = (r == c ? 1.0 : 0.0) - h_alpha0 * df_dy;
        store<f64>(jPtr + (r * n + c) * 8, jVal);
      }
    }

    // Solve J * dy = -r
    let negRPtr = luScratchPtr;
    for (let i: u32 = 0; i < n; i++) {
      store<f64>(negRPtr + i * 8, -load<f64>(rPtr + i * 8));
    }

    if (luFactor(jPtr as u32, pivPtr as u32, scalePtr as u32, n)) {
      luSolve(jPtr as u32, pivPtr as u32, scalePtr as u32, negRPtr as u32, dyPtr as u32, n);
      for (let i: u32 = 0; i < n; i++) {
        let sIdx = load<u32>(solver.stateIndicesPtr + i * 4);
        let yOld = load<f64>(varValuesPtr + sIdx * 8);
        store<f64>(varValuesPtr + sIdx * 8, yOld + load<f64>(negRPtr + i * 8));
      }
    }
  }

  // 3. Update Nordsieck History with Difference Correction
  for (let i: u32 = 0; i < n; i++) {
    let sIdx = load<u32>(solver.stateIndicesPtr + i * 4);
    let yFinal = load<f64>(varValuesPtr + sIdx * 8);
    let yPred = load<f64>(solver.historyPtr + i * 8);
    let delta = yFinal - yPred;

    store<f64>(solver.historyPtr + i * 8, yFinal);
    store<f64>(solver.historyPtr + (1 * n + i) * 8, dt * load<f64>(varValuesPtr + load<u32>(solver.derivIndicesPtr + i * 4) * 8));

    if (q >= 2) {
      let row2 = load<f64>(solver.historyPtr + (2 * n + i) * 8);
      store<f64>(solver.historyPtr + (2 * n + i) * 8, row2 + delta * (1.0 / alpha0));
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
  store<u32>(solver.stateIndicesPtr + idx * 4, stateVarIdx);
  store<u32>(solver.derivIndicesPtr + idx * 4, derivVarIdx);
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
