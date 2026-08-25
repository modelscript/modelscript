// SPDX-License-Identifier: AGPL-3.0-or-later
// @ts-nocheck
import {
  DaeBuilder,
  EQ_STRIDE,
  EQ_KIND,
  EqKind,
  EQ_LHS,
  EQ_RHS,
  EXPR_STRIDE,
  EXPR_KIND,
  ExprKind,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  VAR_STRIDE,
  VAR_FLAGS,
  FLAG_TEARING_VAR
} from "./dae";
import { ChunkedInt32Array, createChunkedInt32Array } from "./array";
import { atomicChunkAlloc } from "./arena";
import { evalExpr, evalEquationResidual } from "./eval";
import { luFactor, luSolve, vectorNormInf } from "./matrix";

/**
 * Representation of an algebraic loop partitioned by tearing into:
 * 1. Tearing variables (k variables)
 * 2. Causal forward evaluation sequence (N - k inner variables and equations)
 * 3. Residual equations (k residual constraints: r(x_tear) = 0)
 */
@unmanaged
export class TornBlock {
  blockSize: u32;
  nTear: u32;
  nInner: u32;

  tearVarIndicesPtr: usize;
  innerVarIndicesPtr: usize;
  innerEqIndicesPtr: usize;
  residualEqIndicesPtr: usize;

  @inline getTearVarIndices(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<TornBlock>("tearVarIndicesPtr"))); }
  @inline getInnerVarIndices(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<TornBlock>("innerVarIndicesPtr"))); }
  @inline getInnerEqIndices(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<TornBlock>("innerEqIndicesPtr"))); }
  @inline getResidualEqIndices(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<TornBlock>("residualEqIndicesPtr"))); }

  init(): void {
    this.blockSize = 0;
    this.nTear = 0;
    this.nInner = 0;

    this.tearVarIndicesPtr = changetype<usize>(createChunkedInt32Array(16));
    this.innerVarIndicesPtr = changetype<usize>(createChunkedInt32Array(64));
    this.innerEqIndicesPtr = changetype<usize>(createChunkedInt32Array(64));
    this.residualEqIndicesPtr = changetype<usize>(createChunkedInt32Array(16));
  }
}

/**
 * Applies Cellier-Elmqvist minimum degree tearing to an SCC equation block.
 * Partitions the block into k tearing variables, an explicit forward chain of N-k inner variables,
 * and k residual equations.
 */
export function createTornBlock(
  dae: DaeBuilder,
  eqIndicesPtr: u32,
  varIndicesPtr: u32,
  n: u32
): TornBlock {
  let tornPtr = atomicChunkAlloc(sizeof<TornBlock>());
  let torn = changetype<TornBlock>(tornPtr);
  torn.init();
  torn.blockSize = n;

  if (n <= 1) {
    if (n == 1) {
      let v0 = load<u32>(varIndicesPtr);
      let e0 = load<u32>(eqIndicesPtr);
      torn.getInnerVarIndices().push(v0 as i32);
      torn.getInnerEqIndices().push(e0 as i32);
      torn.nInner = 1;
    }
    return torn;
  }

  // Minimum Degree Heuristic:
  // Select tearing variable with lowest non-zero incidence degree
  let minDegree: u32 = 0xffffffff;
  let selectedTearVar: u32 = load<u32>(varIndicesPtr);
  let selectedTearIdx: u32 = 0;

  for (let i: u32 = 0; i < n; i++) {
    let varIdx = load<u32>(varIndicesPtr + i * 4);
    let degree: u32 = 0;

    for (let j: u32 = 0; j < n; j++) {
      let eqIdx = load<u32>(eqIndicesPtr + j * 4);
      let eqOffset = eqIdx * EQ_STRIDE;
      let lhs = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
      let rhs = dae.getEqData().get(eqOffset + EQ_RHS) as u32;
      if (exprContainsVar(dae, lhs, varIdx) || exprContainsVar(dae, rhs, varIdx)) {
        degree++;
      }
    }

    if (degree > 0 && degree < minDegree) {
      minDegree = degree;
      selectedTearVar = varIdx;
      selectedTearIdx = i;
    }
  }

  // Register tearing variable
  torn.getTearVarIndices().push(selectedTearVar as i32);
  torn.nTear = 1;

  let offset = selectedTearVar * VAR_STRIDE;
  let curFlags = dae.getVarData().get(offset + VAR_FLAGS);
  dae.getVarData().set(offset + VAR_FLAGS, curFlags | FLAG_TEARING_VAR);

  // Partition the remaining equations into inner forward chain and residual
  // Equations 0 to n-2 -> Inner chain; Equation n-1 -> Residual equation
  for (let i: u32 = 0; i < n; i++) {
    let vIdx = load<u32>(varIndicesPtr + i * 4);
    let eIdx = load<u32>(eqIndicesPtr + i * 4);

    if (i != selectedTearIdx) {
      torn.getInnerVarIndices().push(vIdx as i32);
      torn.getInnerEqIndices().push(eIdx as i32);
      torn.nInner++;
    } else {
      torn.getResidualEqIndices().push(eIdx as i32);
    }
  }

  return torn;
}

/**
 * Checks if an expression tree contains a reference to target variable ID.
 */
function exprContainsVar(dae: DaeBuilder, exprId: u32, targetVarId: u32): bool {
  if (exprId >= dae.exprCount) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    return (dae.getExprData().get(offset + EXPR_DATA1) as u32) == targetVarId;
  }

  let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
  let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

  if (left != 0xffffffff && exprContainsVar(dae, left, targetVarId)) return true;
  if (right != 0xffffffff && exprContainsVar(dae, right, targetVarId)) return true;

  return false;
}

/**
 * Evaluates the inner forward-substitution chain for a torn block.
 */
export function evalInnerChain(dae: DaeBuilder, torn: TornBlock, varValuesPtr: u32): void {
  for (let i: u32 = 0; i < torn.nInner; i++) {
    let eqIdx = torn.getInnerEqIndices().get(i) as u32;
    let varIdx = torn.getInnerVarIndices().get(i) as u32;

    // Evaluate residual and solve for varIdx
    let eqOffset = eqIdx * EQ_STRIDE;
    let lhs = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
    let rhs = dae.getEqData().get(eqOffset + EQ_RHS) as u32;

    if (lhs < dae.exprCount && dae.getExprData().get(lhs * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let targetV = dae.getExprData().get(lhs * EXPR_STRIDE + EXPR_DATA1) as u32;
      if (targetV == varIdx) {
        // Direct assignment: x_inner = RHS
        let rhsVal = evalExpr(rhs, dae, varValuesPtr);
        store<f64>(varValuesPtr + varIdx * 8, rhsVal);
        continue;
      }
    }

    // 1D Newton fallback for inner equation
    let x = load<f64>(varValuesPtr + varIdx * 8);
    let eps: f64 = 1e-7;
    for (let iter: u32 = 0; iter < 10; iter++) {
      let r = evalEquationResidual(eqIdx, dae, varValuesPtr);
      if (Math.abs(r) < 1e-10) break;
      store<f64>(varValuesPtr + varIdx * 8, x + eps);
      let rPlus = evalEquationResidual(eqIdx, dae, varValuesPtr);
      store<f64>(varValuesPtr + varIdx * 8, x);
      let der = (rPlus - r) / eps;
      if (Math.abs(der) < 1e-14) der = 1e-6;
      x -= r / der;
      store<f64>(varValuesPtr + varIdx * 8, x);
    }
  }
}

/**
 * Solves a torn algebraic loop block using reduced-order Newton-Raphson iteration
 * on the k residual equations r(x_tear) = 0 with Armijo backtracking line search.
 */
export function solveTornBlock(
  dae: DaeBuilder,
  torn: TornBlock,
  varValuesPtr: u32,
  scratchPtr: u32
): bool {
  let k = torn.nTear;
  if (k == 0) {
    evalInnerChain(dae, torn, varValuesPtr);
    return true;
  }

  let rPtr = scratchPtr;
  let dxPtr = rPtr + k * 8;
  let jPtr = dxPtr + k * 8;
  let pivPtr = jPtr + k * k * 8;
  let scalePtr = pivPtr + k * 4;
  let luScratchPtr = scalePtr + k * 8;

  let tol: f64 = 1e-10;
  let maxIter: u32 = 25;
  let eps: f64 = 1e-7;

  for (let iter: u32 = 0; iter < maxIter; iter++) {
    // 1. Forward-substitute inner variables
    evalInnerChain(dae, torn, varValuesPtr);

    // 2. Evaluate Residual vector R (k equations)
    for (let i: u32 = 0; i < k; i++) {
      let resEq = torn.getResidualEqIndices().get(i) as u32;
      let res = evalEquationResidual(resEq, dae, varValuesPtr);
      store<f64>(rPtr + i * 8, res);
    }

    // 3. Check convergence
    let normR = vectorNormInf(rPtr, k);
    if (normR < tol) break;

    // 4. Construct k x k Reduced Jacobian J_tear via perturbation
    for (let j: u32 = 0; j < k; j++) {
      let tearV = torn.getTearVarIndices().get(j) as u32;
      let xOrig = load<f64>(varValuesPtr + tearV * 8);

      // Perturb tearing variable
      store<f64>(varValuesPtr + tearV * 8, xOrig + eps);
      evalInnerChain(dae, torn, varValuesPtr);

      for (let i: u32 = 0; i < k; i++) {
        let resEq = torn.getResidualEqIndices().get(i) as u32;
        let resPlus = evalEquationResidual(resEq, dae, varValuesPtr);
        let resOrig = load<f64>(rPtr + i * 8);
        let der = (resPlus - resOrig) / eps;
        store<f64>(jPtr + (i * k + j) * 8, der);
      }

      // Restore
      store<f64>(varValuesPtr + tearV * 8, xOrig);
    }

    // 5. Solve J_tear * dx = R
    if (!luFactor(jPtr, pivPtr, scalePtr, k)) return false;
    for (let i: u32 = 0; i < k; i++) {
      store<f64>(dxPtr + i * 8, load<f64>(rPtr + i * 8));
    }
    luSolve(jPtr, pivPtr, scalePtr, dxPtr, luScratchPtr, k);

    // 6. Armijo Line Search
    let alpha: f64 = 1.0;
    let stepAccepted = false;

    while (alpha > 0.0625) {
      for (let j: u32 = 0; j < k; j++) {
        let tearV = torn.getTearVarIndices().get(j) as u32;
        let xOrig = load<f64>(varValuesPtr + tearV * 8);
        let delta = load<f64>(dxPtr + j * 8);
        store<f64>(varValuesPtr + tearV * 8, xOrig - alpha * delta);
      }

      evalInnerChain(dae, torn, varValuesPtr);

      let maxNewRes: f64 = 0.0;
      for (let i: u32 = 0; i < k; i++) {
        let resEq = torn.getResidualEqIndices().get(i) as u32;
        let resNew = Math.abs(evalEquationResidual(resEq, dae, varValuesPtr));
        if (resNew > maxNewRes) maxNewRes = resNew;
      }

      if (maxNewRes < normR) {
        stepAccepted = true;
        break;
      }

      // Revert step
      for (let j: u32 = 0; j < k; j++) {
        let tearV = torn.getTearVarIndices().get(j) as u32;
        let xOrig = load<f64>(varValuesPtr + tearV * 8);
        let delta = load<f64>(dxPtr + j * 8);
        store<f64>(varValuesPtr + tearV * 8, xOrig + alpha * delta);
      }

      alpha *= 0.5;
    }

    if (!stepAccepted) {
      for (let j: u32 = 0; j < k; j++) {
        let tearV = torn.getTearVarIndices().get(j) as u32;
        let xOrig = load<f64>(varValuesPtr + tearV * 8);
        let delta = load<f64>(dxPtr + j * 8);
        store<f64>(varValuesPtr + tearV * 8, xOrig - delta);
      }
    }
  }

  // Final evaluation of inner chain
  evalInnerChain(dae, torn, varValuesPtr);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Bridge Functions
// ─────────────────────────────────────────────────────────────────────────────

export function dae_createTornBlock(daePtr: u32, eqIndicesPtr: u32, varIndicesPtr: u32, n: u32): u32 {
  let block = createTornBlock(changetype<DaeBuilder>(daePtr), eqIndicesPtr, varIndicesPtr, n);
  return changetype<usize>(block) as u32;
}

export function dae_solveTornBlock(daePtr: u32, tornBlockPtr: u32, varValuesPtr: u32, scratchPtr: u32): bool {
  return solveTornBlock(changetype<DaeBuilder>(daePtr), changetype<TornBlock>(tornBlockPtr), varValuesPtr, scratchPtr);
}
