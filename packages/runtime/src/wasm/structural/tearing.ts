// SPDX-License-Identifier: AGPL-3.0-or-later
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
} from "../dae/builder";
import { ChunkedInt32Array, createChunkedInt32Array, UnmanagedFloat64Array, UnmanagedUint32Array } from "../core/array";
import { atomicChunkAlloc } from "../arena";
import { evalExpr, evalEquationResidual } from "../dae/eval";
import { luFactor, luSolve, vectorNormInf } from "../solvers/matrix";
import { evalExprDerivative } from "../autodiff/coloring";
import { UnmanagedMap64, createMap64 } from "../core/hashmap";

/**
 * High-Performance WASM Tearing & Sparse Dynamic Solvers for Large-Scale DAEs.
 *
 * Implements the Cellier-Elmqvist Minimum Degree Tearing Algorithm for decomposing
 * coupled algebraic equation loops in DAE systems into minimal iterative cores.
 *
 * Academic Citations:
 *   - Cellier, F. E. (1979). Combined Continuous/Discrete System Simulation by Use of Digital
 *     Computers: Techniques and Tools. PhD thesis, ETH Zurich. DOI: 10.3929/ethz-a-000179979.
 *   - Elmqvist, H., & Otter, M. (1994). "Methods for Tearing Systems of Equations in Object-Oriented
 *     Modeling." Proceedings of the European Simulation Multiconference (ESM'94), pp. 326–332.
 *   - Mahana, P. N., & Eagan, J. P. (1975). "A tearing algorithm for large systems of equations."
 *
 * ModelScript Architectural Rationale:
 *   Algebraic loops in physical models (such as kinematic closed loops, electrical bridge circuits,
 *   or multi-phase fluid equilibria) create coupled non-linear equation systems of size N inside
 *   BLT SCC blocks. Solving these with full N-dimensional Newton-Raphson incurs an O(N^3) cost per
 *   iteration. Tearing selects a minimal set of k tearing variables (k << N) such that breaking them
 *   allows the remaining N-k variables to be solved via a fast explicit forward substitution chain.
 *   The iterative solver is then restricted to the small k x k residual system, accelerating
 *   simulation runtime by orders of magnitude.
 *
 * Modifications:
 *   - Implemented as an unmanaged WebAssembly kernel (`@unmanaged`) without garbage collection overhead.
 *   - Minimum degree heuristic analyzes the incidence graph of the SCC block directly in memory.
 *   - Partitions equations into k tearing variables, an explicit inner forward chain, and k residual constraints.
 *   - Evaluates inner chains and residuals directly against WebAssembly linear memory DAE variables.
 */
@unmanaged
export class TornBlock {
  /** Total number of equations and variables in the strongly connected component (SCC). */
  blockSize: u32;
  /** Number of selected tearing (iteration) variables $k$. */
  nTear: u32;
  /** Number of explicitly causalized inner variables $N - k$. */
  nInner: u32;

  /** Indices of the $k$ tearing variables iterated by the outer Newton-Raphson solver. */
  tearVarIndices: ChunkedInt32Array;
  /** Ordered sequence of $N - k$ inner variable indices evaluated explicitly along the forward chain. */
  innerVarIndices: ChunkedInt32Array;
  /** Ordered sequence of $N - k$ inner equation indices solved sequentially for `innerVarIndices`. */
  innerEqIndices: ChunkedInt32Array;
  /** Indices of the $k$ residual constraint equations evaluated to drive the tearing iteration. */
  residualEqIndices: ChunkedInt32Array;

  /** Returns the chunked array of tearing variable indices. */
  @inline getTearVarIndices(): ChunkedInt32Array { return this.tearVarIndices; }
  /** Returns the chunked array of inner forward-chain variable indices. */
  @inline getInnerVarIndices(): ChunkedInt32Array { return this.innerVarIndices; }
  /** Returns the chunked array of inner forward-chain equation indices. */
  @inline getInnerEqIndices(): ChunkedInt32Array { return this.innerEqIndices; }
  /** Returns the chunked array of residual equation indices. */
  @inline getResidualEqIndices(): ChunkedInt32Array { return this.residualEqIndices; }

  /**
   * Initializes the torn block metadata and allocates unmanaged index arrays.
   */
  init(): void {
    this.blockSize = 0;
    this.nTear = 0;
    this.nInner = 0;

    this.tearVarIndices = createChunkedInt32Array(16);
    this.innerVarIndices = createChunkedInt32Array(64);
    this.innerEqIndices = createChunkedInt32Array(64);
    this.residualEqIndices = createChunkedInt32Array(16);
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
  let tornPtr = atomicChunkAlloc(256);
  let torn = changetype<TornBlock>(tornPtr);
  torn.init();
  torn.blockSize = n;

  let eqIndices = changetype<UnmanagedUint32Array>(eqIndicesPtr);
  let varIndices = changetype<UnmanagedUint32Array>(varIndicesPtr);

  if (n <= 1) {
    if (n == 1) {
      let v0 = varIndices[0];
      let e0 = eqIndices[0];
      torn.getInnerVarIndices().push(v0 as i32);
      torn.getInnerEqIndices().push(e0 as i32);
      torn.nInner = 1;
    }
    return torn;
  }

  // Allocate incidence matrix (n * n bytes) + varAssigned (n) + eqUsed (n) + isTearVar (n)
  let totalBytes = n * n + 3 * n;
  let tmpPtr = atomicChunkAlloc(totalBytes);
  memory.fill(tmpPtr, 0, totalBytes);
  let incPtr = tmpPtr;
  let varAssignedPtr = incPtr + n * n;
  let eqUsedPtr = varAssignedPtr + n;
  let isTearVarPtr = eqUsedPtr + n;

  for (let e: u32 = 0; e < n; e++) {
    let eqIdx = eqIndices[e];
    let eqOffset = eqIdx * EQ_STRIDE;
    let lhs = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
    let rhs = dae.getEqData().get(eqOffset + EQ_RHS) as u32;
    for (let v: u32 = 0; v < n; v++) {
      let varIdx = varIndices[v];
      if (exprContainsVar(dae, lhs, varIdx) || exprContainsVar(dae, rhs, varIdx)) {
        store<u8>(incPtr + e * n + v, 1);
      }
    }
  }

  let assignedCount: u32 = 0;
  while (assignedCount < n) {
    // 1. Greedy forward causalization once at least one tearing variable has broken a cycle
    let progress = true;
    while (progress && torn.nTear > 0) {
      progress = false;
      let bestE: i32 = -1;
      let bestV: i32 = -1;
      let bestScore: i32 = -1;

      for (let e: u32 = 0; e < n; e++) {
        if (load<u8>(eqUsedPtr + e) != 0) continue;
        let unassignedCount: u32 = 0;
        let lastV: u32 = 0;
        for (let v: u32 = 0; v < n; v++) {
          if (load<u8>(varAssignedPtr + v) == 0 && load<u8>(incPtr + e * n + v) != 0) {
            unassignedCount++;
            lastV = v;
          }
        }
        if (unassignedCount == 1) {
          let score: i32 = load<u8>(isTearVarPtr + e) == 0 ? 1 : 0;
          if (e == lastV) score += 2;
          let eqIdx = eqIndices[e];
          let lhs = dae.getEqData().get(eqIdx * EQ_STRIDE + EQ_LHS) as u32;
          if (lhs < dae.exprCount && dae.getExprData().get(lhs * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
            let rawV = dae.getExprData().get(lhs * EXPR_STRIDE + EXPR_DATA1) as u32;
            if (rawV >= dae.varCount) {
              let res = dae.lookupVariableByName(rawV);
              if (res >= 0) rawV = res as u32;
            }
            if (rawV == varIndices[lastV]) score += 4;
          }
          if (score > bestScore) {
            bestScore = score;
            bestE = e as i32;
            bestV = lastV as i32;
          }
        }
      }

      if (bestE >= 0 && bestV >= 0) {
        store<u8>(eqUsedPtr + (bestE as u32), 1);
        store<u8>(varAssignedPtr + (bestV as u32), 1);
        torn.getInnerVarIndices().push(varIndices[bestV as u32] as i32);
        torn.getInnerEqIndices().push(eqIndices[bestE as u32] as i32);
        torn.nInner++;
        assignedCount++;
        progress = true;
      }
    }

    if (assignedCount >= n) break;

    // 2. Select next tearing variable to break remaining cycle(s)
    let bestTearIdx: u32 = 0;
    let bestDegree: i32 = -1;
    for (let v: u32 = 0; v < n; v++) {
      if (load<u8>(varAssignedPtr + v) != 0) continue;
      let degree: i32 = 0;
      for (let e: u32 = 0; e < n; e++) {
        if (load<u8>(eqUsedPtr + e) == 0 && load<u8>(incPtr + e * n + v) != 0) {
          degree++;
        }
      }
      if (degree > bestDegree) {
        bestDegree = degree;
        bestTearIdx = v;
      }
    }

    let selectedTearVar = varIndices[bestTearIdx];
    store<u8>(varAssignedPtr + bestTearIdx, 1);
    store<u8>(isTearVarPtr + bestTearIdx, 1);
    torn.getTearVarIndices().push(selectedTearVar as i32);
    torn.nTear++;
    assignedCount++;

    let offset = selectedTearVar * VAR_STRIDE;
    let curFlags = dae.getVarData().get(offset + VAR_FLAGS);
    dae.getVarData().set(offset + VAR_FLAGS, curFlags | FLAG_TEARING_VAR);
  }

  // Remaining unused equations form the k residual equations
  for (let e: u32 = 0; e < n; e++) {
    if (load<u8>(eqUsedPtr + e) == 0) {
      torn.getResidualEqIndices().push(eqIndices[e] as i32);
    }
  }

  return torn;
}

/**
 * Checks if an expression tree contains a reference to target variable ID.
 */
function exprContainsVar(dae: DaeBuilder, exprId: u32, targetVarId: u32): bool {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    let rawId = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (rawId == targetVarId) return true;
    if (rawId >= dae.varCount) {
      let resolved = dae.lookupVariableByName(rawId);
      return resolved >= 0 && (resolved as u32) == targetVarId;
    }
    return false;
  }

  if (
    kind == ExprKind.IntLiteral ||
    kind == ExprKind.RealLiteral ||
    kind == ExprKind.BoolLiteral ||
    kind == ExprKind.StringLiteral ||
    kind == ExprKind.EnumLiteral ||
    kind == ExprKind.Colon
  ) {
    return false;
  }

  if (kind == ExprKind.Der || kind == ExprKind.Pre) {
    let data1 = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    if (data1 != 0xffffffff && data1 < dae.exprCount && exprContainsVar(dae, data1, targetVarId)) return true;
    if (left != 0xffffffff && left < dae.exprCount && exprContainsVar(dae, left, targetVarId)) return true;
    return false;
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    return left != 0xffffffff && exprContainsVar(dae, left, targetVarId);
  }

  if (kind == ExprKind.Binary) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    if (left != 0xffffffff && exprContainsVar(dae, left, targetVarId)) return true;
    if (right != 0xffffffff && exprContainsVar(dae, right, targetVarId)) return true;
    return false;
  }

  if (kind == ExprKind.IfElse || kind == ExprKind.Range) {
    let data1 = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    if (data1 != 0xffffffff && exprContainsVar(dae, data1, targetVarId)) return true;
    if (left != 0xffffffff && exprContainsVar(dae, left, targetVarId)) return true;
    if (right != 0xffffffff && exprContainsVar(dae, right, targetVarId)) return true;
    return false;
  }

  if (kind == ExprKind.Subscript || kind == ExprKind.Call || kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
    if (kind == ExprKind.Subscript) {
      let baseExpr = dae.getExprData().get(offset + EXPR_DATA1) as u32;
      if (baseExpr != 0xffffffff && exprContainsVar(dae, baseExpr, targetVarId)) return true;
    }
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let rightVal = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    let data1Val = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let count: u32 =
      kind == ExprKind.Call || kind == ExprKind.Subscript
        ? rightVal
        : rightVal > 0 && rightVal != 0xffffffff
          ? rightVal
          : data1Val;
    if (count > 0 && count != 0xffffffff && left != 0xffffffff) {
      if (exprContainsVar(dae, left, targetVarId)) return true;
      for (let a: u32 = 1; a < count; a++) {
        let slotIdx = exprId + a;
        if (slotIdx < dae.exprCount) {
          let slotOffset = slotIdx * EXPR_STRIDE;
          let slotKind = dae.getExprData().get(slotOffset + EXPR_KIND);
          let argExpr = slotKind == ExprKind.Tuple
            ? (dae.getExprData().get(slotOffset + EXPR_LEFT) as u32)
            : left + a;
          if (argExpr != 0xffffffff && exprContainsVar(dae, argExpr, targetVarId)) return true;
        }
      }
    }
    return false;
  }

  return false;
}

/**
 * Evaluates the inner forward-substitution chain for a torn block.
 */
export function evalInnerChain(dae: DaeBuilder, torn: TornBlock, varValuesPtr: u32): void {
  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr);
  for (let i: u32 = 0; i < torn.nInner; i++) {
    let eqIdx = torn.getInnerEqIndices().get(i) as u32;
    let varIdx = torn.getInnerVarIndices().get(i) as u32;

    // Evaluate residual and solve for varIdx
    let eqOffset = eqIdx * EQ_STRIDE;
    let lhs = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
    let rhs = dae.getEqData().get(eqOffset + EQ_RHS) as u32;

    if (lhs < dae.exprCount && dae.getExprData().get(lhs * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let targetV = dae.getExprData().get(lhs * EXPR_STRIDE + EXPR_DATA1) as u32;
      if (targetV >= dae.varCount) {
        let resolved = dae.lookupVariableByName(targetV);
        if (resolved >= 0) targetV = resolved as u32;
      }
      if (targetV == varIdx && !exprContainsVar(dae, rhs, varIdx)) {
        // Direct assignment: x_inner = RHS
        let rhsVal = evalExpr(rhs, dae, varValuesPtr);
        varValues[varIdx] = rhsVal;
        continue;
      }
    }

    if (rhs < dae.exprCount && dae.getExprData().get(rhs * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let targetV = dae.getExprData().get(rhs * EXPR_STRIDE + EXPR_DATA1) as u32;
      if (targetV >= dae.varCount) {
        let resolved = dae.lookupVariableByName(targetV);
        if (resolved >= 0) targetV = resolved as u32;
      }
      if (targetV == varIdx && !exprContainsVar(dae, lhs, varIdx)) {
        // Direct assignment: LHS = x_inner
        let lhsVal = evalExpr(lhs, dae, varValuesPtr);
        varValues[varIdx] = lhsVal;
        continue;
      }
    }

    // 1D Newton fallback for inner equation using analytical derivative
    let x = varValues[varIdx];
    for (let iter: u32 = 0; iter < 10; iter++) {
      let r = evalEquationResidual(eqIdx, dae, varValuesPtr);
      if (Math.abs(r) < 1e-10) break;
      let der = evalExprDerivative(rhs, dae, varIdx, varValuesPtr) - evalExprDerivative(lhs, dae, varIdx, varValuesPtr);
      if (Math.abs(der) < 1e-14) der = 1e-6;
      x -= r / der;
      varValues[varIdx] = x;
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

  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr);

  let rPtr = scratchPtr;
  let dxPtr = rPtr + k * 8;
  let jPtr = dxPtr + k * 8;
  let pivPtr = jPtr + k * k * 8;
  let pivSize = (k * 4 + 7) & ~7;
  let scalePtr = pivPtr + pivSize;
  let luScratchPtr = scalePtr + k * 8;

  let r = changetype<UnmanagedFloat64Array>(rPtr);
  let dx = changetype<UnmanagedFloat64Array>(dxPtr);
  let jMat = changetype<UnmanagedFloat64Array>(jPtr);

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
      r[i] = res;
    }

    // 3. Check convergence
    let normR = vectorNormInf(rPtr, k);
    if (!isNaN(normR) && normR < tol) return true;

    // 4. Construct k x k Reduced Jacobian J_tear via perturbation
    for (let j: u32 = 0; j < k; j++) {
      let tearV = torn.getTearVarIndices().get(j) as u32;
      let xOrig = varValues[tearV];

      // Perturb tearing variable
      varValues[tearV] = xOrig + eps;
      evalInnerChain(dae, torn, varValuesPtr);

      for (let i: u32 = 0; i < k; i++) {
        let resEq = torn.getResidualEqIndices().get(i) as u32;
        let resPlus = evalEquationResidual(resEq, dae, varValuesPtr);
        let resOrig = r[i];
        let der = (resPlus - resOrig) / eps;
        jMat[i * k + j] = der;
      }

      // Restore
      varValues[tearV] = xOrig;
    }

    // 5. Solve J_tear * dx = R
    if (!luFactor(jPtr, pivPtr, scalePtr, k)) return false;
    for (let i: u32 = 0; i < k; i++) {
      dx[i] = r[i];
    }
    luSolve(jPtr, pivPtr, scalePtr, dxPtr, luScratchPtr, k);

    // 6. Armijo Line Search
    let alpha: f64 = 1.0;
    let stepAccepted = false;

    while (alpha > 0.0625) {
      for (let j: u32 = 0; j < k; j++) {
        let tearV = torn.getTearVarIndices().get(j) as u32;
        let xOrig = varValues[tearV];
        let delta = dx[j];
        varValues[tearV] = xOrig - alpha * delta;
      }

      evalInnerChain(dae, torn, varValuesPtr);

      let maxNewRes: f64 = 0.0;
      for (let i: u32 = 0; i < k; i++) {
        let resEq = torn.getResidualEqIndices().get(i) as u32;
        let resNew = Math.abs(evalEquationResidual(resEq, dae, varValuesPtr));
        if (isNaN(resNew)) {
          maxNewRes = Infinity;
          break;
        }
        if (resNew > maxNewRes) maxNewRes = resNew;
      }

      if (maxNewRes < normR) {
        stepAccepted = true;
        if (maxNewRes < tol) return true;
        break;
      }

      // Revert step
      for (let j: u32 = 0; j < k; j++) {
        let tearV = torn.getTearVarIndices().get(j) as u32;
        let xOrig = varValues[tearV];
        let delta = dx[j];
        varValues[tearV] = xOrig + alpha * delta;
      }

      alpha *= 0.5;
    }

    if (!stepAccepted) {
      for (let j: u32 = 0; j < k; j++) {
        let tearV = torn.getTearVarIndices().get(j) as u32;
        let xOrig = varValues[tearV];
        let delta = dx[j];
        varValues[tearV] = xOrig - delta;
      }
      evalInnerChain(dae, torn, varValuesPtr);

      let finalRes: f64 = 0.0;
      for (let i: u32 = 0; i < k; i++) {
        let resEq = torn.getResidualEqIndices().get(i) as u32;
        let resNew = Math.abs(evalEquationResidual(resEq, dae, varValuesPtr));
        if (isNaN(resNew)) {
          finalRes = Infinity;
          break;
        }
        if (resNew > finalRes) finalRes = resNew;
      }
      if (finalRes < tol) return true;
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Bridge Functions & Incremental Tearing Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unmanaged hash cache mapping 64-bit structural SCC hashes to pre-computed `TornBlock` pointers.
 * Enables incremental reuse of tearing partitions across minor model edits.
 */
@unmanaged
export class TearingCache {
  /** Underlying 64-bit key-to-pointer hash map in WebAssembly linear memory. */
  map: UnmanagedMap64;

  /**
   * Initializes the tearing cache with the specified bucket capacity.
   */
  init(capacity: u32 = 256): void {
    this.map = changetype<UnmanagedMap64>(createMap64(capacity));
  }

  /**
   * Looks up a cached `TornBlock` pointer by its 64-bit structural SCC hash, returning 0 on miss.
   */
  get(sccHash: u64): u32 {
    return this.map.get(sccHash);
  }

  /**
   * Inserts or updates a `TornBlock` pointer for the given 64-bit structural SCC hash.
   */
  set(sccHash: u64, tornBlockPtr: u32): void {
    this.map.set(sccHash, tornBlockPtr);
  }
}

/**
 * Allocates and initializes a new incremental `TearingCache` in WebAssembly linear memory.
 */
export function dae_createTearingCache(capacity: u32 = 256): u32 {
  let ptr = atomicChunkAlloc(offsetof<TearingCache>());
  let cache = changetype<TearingCache>(ptr);
  cache.init(capacity);
  return ptr as u32;
}

/**
 * Retrieves a cached `TornBlock` for the given 64-bit SCC hash (`sccHashHi:sccHashLo`),
 * or computes and caches a new tearing partition if not found.
 */
export function dae_getOrCacheTornBlock(
  cachePtr: u32,
  sccHashHi: u32,
  sccHashLo: u32,
  daePtr: u32,
  eqIndicesPtr: u32,
  varIndicesPtr: u32,
  n: u32
): u32 {
  let sccHash = ((sccHashHi as u64) << 32) | (sccHashLo as u64);
  if (cachePtr != 0) {
    let cache = changetype<TearingCache>(cachePtr);
    let existing = cache.get(sccHash);
    if (existing != 0) return existing;
  }

  let block = createTornBlock(changetype<DaeBuilder>(daePtr), eqIndicesPtr, varIndicesPtr, n);
  let resPtr = changetype<usize>(block) as u32;
  if (cachePtr != 0) {
    changetype<TearingCache>(cachePtr).set(sccHash, resPtr);
  }
  return resPtr;
}

/**
 * Computes a `TornBlock` partition for an SCC block of size `n` and returns its linear memory pointer.
 */
export function dae_createTornBlock(daePtr: u32, eqIndicesPtr: u32, varIndicesPtr: u32, n: u32): u32 {
  let block = createTornBlock(changetype<DaeBuilder>(daePtr), eqIndicesPtr, varIndicesPtr, n);
  return changetype<usize>(block) as u32;
}

/**
 * Solves a `TornBlock` algebraic loop in-place using damped Newton-Raphson iteration on the tearing variables.
 */
export function dae_solveTornBlock(daePtr: u32, tornBlockPtr: u32, varValuesPtr: u32, scratchPtr: u32): bool {
  return solveTornBlock(changetype<DaeBuilder>(daePtr), changetype<TornBlock>(tornBlockPtr), varValuesPtr, scratchPtr);
}

