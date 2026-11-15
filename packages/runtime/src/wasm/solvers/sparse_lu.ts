// SPDX-License-Identifier: AGPL-3.0-or-later

import { CCSMatrix } from "../autodiff/coloring";
import { ChunkedInt32Array, createChunkedInt32Array, UnmanagedFloat64Array, UnmanagedInt32Array } from "../core/array";
import { atomicChunkAlloc } from "../arena";

/**
 * Sparse LU Factorization Data Structure (Gilbert-Peierls Left-Looking).
 *
 * Implements high-performance sparse LU decomposition with partial pivoting
 * for large-scale sparse linear systems in WebAssembly linear memory.
 *
 * Academic Citations:
 *   - Gilbert, J. R., & Peierls, T. (1988). "Sparse partial pivoting in time proportional
 *     to arithmetic operations." SIAM Journal on Scientific and Statistical Computing, 9(5),
 *     pp. 862–874. DOI: 10.1137/0909058.
 *   - Davis, T. A. (2006). Direct Methods for Sparse Linear Systems. SIAM.
 *     ISBN: 978-0-898716-13-9. (CSparse / KLU Sparse Factorization Algorithms)
 *
 * ModelScript Architectural Rationale:
 *   Newton iterations in stiff DAE solvers (BDF, TR-BDF2, and algebraic tearing loops) repeatedly
 *   solve large Jacobian systems J * dx = -r. For large physical networks, J is ultra-sparse (<1% non-zero).
 *   Dense LU factorization takes O(N^3) time and O(N^2) memory, which is completely non-viable in
 *   WebAssembly. The Gilbert-Peierls algorithm computes sparse LU factorizations in time proportional
 *   to actual floating-point operations by determining nonzero fill-in patterns via depth-first
 *   search on the dependency graph of L, providing near-linear solving performance for sparse DAEs.
 *
 * Modifications:
 *   - Implemented as an unmanaged AssemblyScript structure (`@unmanaged`) in WebAssembly linear memory.
 *   - Operates on Compressed Column Storage (`CCSMatrix`) matrices with zero GC allocation.
 *   - Performs symbolic graph reachability via DFS on DAG(L) to identify non-zero fill-in positions.
 *   - Employs dense accumulator vectors and unmanaged scratch buffers allocated via `atomicChunkAlloc`.
 */
@unmanaged
export class SparseLU {
  /** Dimension $n$ of the square $n \times n$ sparse matrix. */
  n: u32;
  // L factors in CCS format
  /** Column pointer array (`n + 1` elements) for the lower-triangular factor $L$ in CCS format. */
  lColPtr: ChunkedInt32Array;
  /** Row index array for non-zero entries of the lower-triangular factor $L$. */
  lRowIndices: ChunkedInt32Array;
  /** Linear memory pointer to the `f64` numerical values of $L$. */
  lValuesPtr: usize;
  // U factors in CCS format
  /** Column pointer array (`n + 1` elements) for the upper-triangular factor $U$ in CCS format. */
  uColPtr: ChunkedInt32Array;
  /** Row index array for non-zero entries of the upper-triangular factor $U$. */
  uRowIndices: ChunkedInt32Array;
  /** Linear memory pointer to the `f64` numerical values of $U$. */
  uValuesPtr: usize;
  // Row permutation vector P
  /** Row permutation vector $P$ mapping pivot steps to original row indices. */
  perm: ChunkedInt32Array;
  /** Inverse row permutation vector $P^{-1}$ mapping original rows to pivot steps. */
  permInv: ChunkedInt32Array;

  /** Returns a typed view over the numerical non-zero values of $L$. */
  @inline get lValues(): UnmanagedFloat64Array { return changetype<UnmanagedFloat64Array>(this.lValuesPtr); }
  /** Returns a typed view over the numerical non-zero values of $U$. */
  @inline get uValues(): UnmanagedFloat64Array { return changetype<UnmanagedFloat64Array>(this.uValuesPtr); }

  /**
   * Initializes the sparse LU factor storage and identity row permutations for an $n \times n$ matrix.
   */
  init(n: u32): void {
    this.n = n;
    this.lColPtr = createChunkedInt32Array(n + 1);
    this.lRowIndices = createChunkedInt32Array(n * 8);
    this.uColPtr = createChunkedInt32Array(n + 1);
    this.uRowIndices = createChunkedInt32Array(n * 8);
    this.perm = createChunkedInt32Array(n);
    this.permInv = createChunkedInt32Array(n);
    for (let i: u32 = 0; i < n; i++) {
      this.perm.push(i as i32);
      this.permInv.push(i as i32);
    }
  }
}

/**
 * Computes Sparse LU Factorization of a square CCSMatrix using left-looking Gilbert-Peierls algorithm with partial pivoting.
 */
export function sparseLuFactor(A: CCSMatrix): SparseLU {
  let n = A.nCols;
  let luPtr = atomicChunkAlloc(sizeof<SparseLU>());
  let lu = changetype<SparseLU>(luPtr);
  lu.init(n);

  let lnnz: u32 = 0;
  let unnz: u32 = 0;

  lu.lColPtr.push(0);
  lu.uColPtr.push(0);

  // Dense working accumulator vector
  let denseXPtr = atomicChunkAlloc(n * 8);
  let touchedPtr = atomicChunkAlloc(n * 4);
  let denseX = changetype<UnmanagedFloat64Array>(denseXPtr);
  let touched = changetype<UnmanagedInt32Array>(touchedPtr);

  // Allocate max estimation buffers for L and U values
  let maxNnz = A.nnz * 4 + n * 8;
  if (n * n > maxNnz) maxNnz = n * n;
  if (maxNnz < 16) maxNnz = 16;
  lu.lValuesPtr = atomicChunkAlloc(maxNnz * 8);
  lu.uValuesPtr = atomicChunkAlloc(maxNnz * 8);
  let lValues = lu.lValues;
  let uValues = lu.uValues;
  let aValues = A.values;

  for (let k: u32 = 0; k < n; k++) {
    // 1. Unpack column k of A into dense accumulator
    for (let i: u32 = 0; i < n; i++) {
      denseX[i] = 0.0;
      touched[i] = 0;
    }

    let aStart = A.colPtr.get(k) as u32;
    let aEnd = A.colPtr.get(k + 1) as u32;
    for (let p: u32 = aStart; p < aEnd; p++) {
      let r = A.rowIndices.get(p) as u32;
      let val = aValues[p];
      let permR = lu.permInv.get(r) as u32;
      denseX[permR] = val;
      touched[permR] = 1;
    }

    // 2. Triangular solve with previously computed L columns: L[0..k-1] * u = a_k
    for (let j: u32 = 0; j < k; j++) {
      let xj = denseX[j];
      if (Math.abs(xj) < 1e-15) continue;

      let lStart = lu.lColPtr.get(j) as u32;
      let lEnd = lu.lColPtr.get(j + 1) as u32;
      for (let p: u32 = lStart + 1; p < lEnd; p++) {
        let r = lu.lRowIndices.get(p) as u32;
        let lVal = lValues[p];
        let curr = denseX[r];
        denseX[r] = curr - xj * lVal;
        touched[r] = 1;
      }
    }

    // 3. Partial Pivoting: Find maximum entry in denseX[k..n-1]
    let maxVal: f64 = Math.abs(denseX[k]);
    let pivotRow: u32 = k;

    for (let r: u32 = k + 1; r < n; r++) {
      let val = Math.abs(denseX[r]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }

    if (maxVal < 1e-14) {
      // Perturb near-singular pivot for numerical stability
      denseX[k] = 1e-6;
      maxVal = 1e-6;
    }

    // Swap pivot rows if needed
    if (pivotRow != k) {
      let tmp = denseX[k];
      denseX[k] = denseX[pivotRow];
      denseX[pivotRow] = tmp;

      let pK = lu.perm.get(k);
      let pPiv = lu.perm.get(pivotRow);
      lu.perm.set(k, pPiv);
      lu.perm.set(pivotRow, pK);

      lu.permInv.set(pK, pivotRow as i32);
      lu.permInv.set(pPiv, k as i32);

      // Permute row indices k <-> pivotRow in previously factored columns of L
      for (let p: u32 = 0; p < lnnz; p++) {
        let rIdx = lu.lRowIndices.get(p) as u32;
        if (rIdx == k) {
          lu.lRowIndices.set(p, pivotRow as i32);
        } else if (rIdx == pivotRow) {
          lu.lRowIndices.set(p, k as i32);
        }
      }
    }

    let pivotVal = denseX[k];

    // 4. Store U factor column k (rows 0..k)
    for (let r: u32 = 0; r <= k; r++) {
      let val = denseX[r];
      if ((Math.abs(val) > 1e-15 || r == k) && unnz < maxNnz) {
        lu.uRowIndices.push(r as i32);
        uValues[unnz] = val;
        unnz++;
      }
    }
    lu.uColPtr.push(unnz as i32);

    // 5. Store L factor column k (rows k..n-1, normalized by pivotVal)
    if (lnnz < maxNnz) {
      lu.lRowIndices.push(k as i32);
      lValues[lnnz] = 1.0; // Unit diagonal
      lnnz++;
    }

    for (let r: u32 = k + 1; r < n; r++) {
      let val = denseX[r];
      if (Math.abs(val) > 1e-15 && lnnz < maxNnz) {
        let lVal = val / pivotVal;
        lu.lRowIndices.push(r as i32);
        lValues[lnnz] = lVal;
        lnnz++;
      }
    }
    lu.lColPtr.push(lnnz as i32);
  }

  return lu;
}

/**
 * Solves A * x = b given factored SparseLU:
 * 1. Permute RHS: y0 = P * b
 * 2. Forward solve: L * y = y0
 * 3. Backward solve: U * x = y
 */
export function sparseLuSolve(lu: SparseLU, bPtr: usize, xPtr: usize): boolean {
  let n = lu.n;
  let yPtr = atomicChunkAlloc(n * 8);
  let y = changetype<UnmanagedFloat64Array>(yPtr);
  let b = changetype<UnmanagedFloat64Array>(bPtr);
  let x = changetype<UnmanagedFloat64Array>(xPtr);
  let lValues = lu.lValues;
  let uValues = lu.uValues;

  // 1. Permute RHS
  for (let i: u32 = 0; i < n; i++) {
    let pIdx = lu.perm.get(i) as u32;
    y[i] = b[pIdx];
  }

  // 2. Forward Solve: L * y = y
  for (let j: u32 = 0; j < n; j++) {
    let yj = y[j];
    if (Math.abs(yj) < 1e-15) continue;

    let start = lu.lColPtr.get(j) as u32;
    let end = lu.lColPtr.get(j + 1) as u32;
    for (let p: u32 = start + 1; p < end; p++) {
      let r = lu.lRowIndices.get(p) as u32;
      let lVal = lValues[p];
      let curr = y[r];
      y[r] = curr - yj * lVal;
    }
  }

  // 3. Backward Solve: U * x = y
  for (let j: i32 = (n as i32) - 1; j >= 0; j--) {
    let yj = y[j as u32];
    let start = lu.uColPtr.get(j as u32) as u32;
    let end = lu.uColPtr.get((j as u32) + 1) as u32;

    let diagVal: f64 = 1.0;
    let sum: f64 = yj;

    for (let p: u32 = start; p < end; p++) {
      let r = lu.uRowIndices.get(p) as u32;
      let uVal = uValues[p];
      if (r == (j as u32)) {
        diagVal = uVal;
      }
    }

    if (Math.abs(diagVal) < 1e-14) diagVal = 1e-6;
    let xj = sum / diagVal;
    x[j as u32] = xj;

    // Subtract contribution from remaining upper rows
    for (let p: u32 = start; p < end; p++) {
      let r = lu.uRowIndices.get(p) as u32;
      if (r < (j as u32)) {
        let uVal = uValues[p];
        let curr = y[r];
        y[r] = curr - uVal * xj;
      }
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the sparse $PA = LU$ factorization of the `CCSMatrix` at `ccsPtr` and returns the `SparseLU` pointer.
 */
export function dae_sparseLuFactor(ccsPtr: u32): u32 {
  if (ccsPtr == 0) return 0;
  let ccs = changetype<CCSMatrix>(ccsPtr);
  let lu = sparseLuFactor(ccs);
  return changetype<u32>(lu);
}

/**
 * Solves $Ax = b$ using a pre-computed `SparseLU` factorization at `luPtr`, writing the solution to `xPtr`.
 */
export function dae_sparseLuSolve(luPtr: u32, bPtr: u32, xPtr: u32): boolean {
  if (luPtr == 0 || bPtr == 0 || xPtr == 0) return false;
  let lu = changetype<SparseLU>(luPtr);
  return sparseLuSolve(lu, bPtr as usize, xPtr as usize);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flat-Buffer Gilbert-Peierls Sparse LU (with Threshold Pivoting & Refactorize)
// ─────────────────────────────────────────────────────────────────────────────

@unmanaged
export class FlatSparseLU {
  n: u32;
  lLen: u32;
  uLen: u32;
  lCap: u32;
  uCap: u32;
  hasColPerm: u32;
  hasSymbolicPattern: u32;
  lColPtr: usize;
  lRowIndices: usize;
  lValues: usize;
  uColPtr: usize;
  uRowIndices: usize;
  uValues: usize;
  uDiagInv: usize;
  perm: usize;
  permInv: usize;
  colPerm: usize;
  scratchX: usize;
  scratchY: usize;
}

@inline
function growI32Buf(ptr: usize, oldLen: u32, newCap: u32): usize {
  let newPtr = heap.alloc((newCap as usize) << 2);
  memory.copy(newPtr, ptr, (oldLen as usize) << 2);
  heap.free(ptr);
  return newPtr;
}

@inline
function growF64Buf(ptr: usize, oldLen: u32, newCap: u32): usize {
  let newPtr = heap.alloc((newCap as usize) << 3);
  memory.copy(newPtr, ptr, (oldLen as usize) << 3);
  heap.free(ptr);
  return newPtr;
}

export function flatSparseLuFree(luPtr: u32): void {
  if (luPtr == 0) return;
  let lu = changetype<FlatSparseLU>(luPtr as usize);
  if (lu.lColPtr != 0) heap.free(lu.lColPtr);
  if (lu.lRowIndices != 0) heap.free(lu.lRowIndices);
  if (lu.lValues != 0) heap.free(lu.lValues);
  if (lu.uColPtr != 0) heap.free(lu.uColPtr);
  if (lu.uRowIndices != 0) heap.free(lu.uRowIndices);
  if (lu.uValues != 0) heap.free(lu.uValues);
  if (lu.uDiagInv != 0) heap.free(lu.uDiagInv);
  if (lu.perm != 0) heap.free(lu.perm);
  if (lu.permInv != 0) heap.free(lu.permInv);
  if (lu.colPerm != 0) heap.free(lu.colPerm);
  if (lu.scratchX != 0) heap.free(lu.scratchX);
  if (lu.scratchY != 0) heap.free(lu.scratchY);
  heap.free(luPtr as usize);
}

export function flatSparseLuFactor(
  n: u32,
  nnz: u32,
  aColPtrPtr: u32,
  aRowIndicesPtr: u32,
  aValuesPtr: u32,
  colPermPtr: u32,
  allowPerturbation: bool,
  pivotThreshold: f64,
  keepStructural: bool,
): u32 {
  let aColPtr = aColPtrPtr as usize;
  let aRowIndices = aRowIndicesPtr as usize;
  let aValues = aValuesPtr as usize;

  let initCap: u32 = nnz * 3 + n * 2;
  if (initCap < 64) initCap = 64;

  let luPtr = heap.alloc(offsetof<FlatSparseLU>());
  let lu = changetype<FlatSparseLU>(luPtr);
  lu.n = n;
  lu.lLen = 0;
  lu.uLen = 0;
  lu.lCap = initCap;
  lu.uCap = initCap;
  lu.hasColPerm = colPermPtr != 0 ? 1 : 0;
  lu.hasSymbolicPattern = keepStructural ? 1 : 0;

  let nBytesI32 = (n as usize) << 2;
  let np1BytesI32 = ((n + 1) as usize) << 2;
  let nBytesF64 = (n as usize) << 3;

  lu.lColPtr = heap.alloc(np1BytesI32);
  lu.uColPtr = heap.alloc(np1BytesI32);
  lu.lRowIndices = heap.alloc((initCap as usize) << 2);
  lu.lValues = heap.alloc((initCap as usize) << 3);
  lu.uRowIndices = heap.alloc((initCap as usize) << 2);
  lu.uValues = heap.alloc((initCap as usize) << 3);
  lu.uDiagInv = heap.alloc(nBytesF64);
  lu.perm = heap.alloc(nBytesI32);
  lu.permInv = heap.alloc(nBytesI32);
  lu.scratchX = heap.alloc(nBytesF64);
  lu.scratchY = heap.alloc(nBytesF64);
  if (colPermPtr != 0) {
    lu.colPerm = heap.alloc(nBytesI32);
    memory.copy(lu.colPerm, colPermPtr as usize, nBytesI32);
  } else {
    lu.colPerm = 0;
  }

  memory.fill(lu.permInv, 0xff, nBytesI32);
  memory.fill(lu.scratchX, 0, nBytesF64);
  memory.fill(lu.uDiagInv, 0, nBytesF64);

  let xiPtr = heap.alloc(nBytesI32);
  let visitedPtr = heap.alloc(nBytesI32);
  let dfsRowPtr = heap.alloc(nBytesI32);
  let dfsPtrPtr = heap.alloc(nBytesI32);
  memory.fill(visitedPtr, 0xff, nBytesI32);

  let lLen: u32 = 0;
  let uLen: u32 = 0;
  let fallbackCursor: u32 = 0;
  let failed = false;

  for (let k: u32 = 0; k < n; k++) {
    store<i32>(lu.lColPtr + ((k as usize) << 2), lLen as i32);
    store<i32>(lu.uColPtr + ((k as usize) << 2), uLen as i32);

    let col: u32 = lu.colPerm != 0 ? (load<i32>(lu.colPerm + ((k as usize) << 2)) as u32) : k;
    let aStart = load<i32>(aColPtr + ((col as usize) << 2)) as u32;
    let aEnd = load<i32>(aColPtr + (((col + 1) as usize) << 2)) as u32;

    // 1. Gilbert-Peierls Reachability DFS over L(:, 0..k-1)
    let top: u32 = n;
    for (let p: u32 = aStart; p < aEnd; p++) {
      let startRow = load<i32>(aRowIndices + ((p as usize) << 2)) as u32;
      if (load<i32>(visitedPtr + ((startRow as usize) << 2)) == (k as i32)) continue;

      let stackTop: i32 = 0;
      store<i32>(dfsRowPtr, startRow as i32);
      let j0 = load<i32>(lu.permInv + ((startRow as usize) << 2));
      let initLp: i32 = j0 >= 0 ? load<i32>(lu.lColPtr + ((j0 as usize) << 2)) + 1 : 0;
      store<i32>(dfsPtrPtr, initLp);
      store<i32>(visitedPtr + ((startRow as usize) << 2), k as i32);

      while (stackTop >= 0) {
        let stOff = (stackTop as usize) << 2;
        let currRow = load<i32>(dfsRowPtr + stOff) as u32;
        let j = load<i32>(lu.permInv + ((currRow as usize) << 2));
        if (j >= 0) {
          let lEnd = load<i32>(lu.lColPtr + (((j + 1) as usize) << 2));
          let lp = load<i32>(dfsPtrPtr + stOff);
          while (lp < lEnd) {
            let lr = load<i32>(lu.lRowIndices + ((lp as usize) << 2)) as u32;
            if (load<i32>(visitedPtr + ((lr as usize) << 2)) != (k as i32)) break;
            lp++;
          }
          store<i32>(dfsPtrPtr + stOff, lp + 1);
          if (lp < lEnd) {
            let childRow = load<i32>(lu.lRowIndices + ((lp as usize) << 2)) as u32;
            store<i32>(visitedPtr + ((childRow as usize) << 2), k as i32);
            stackTop++;
            let nextOff = (stackTop as usize) << 2;
            store<i32>(dfsRowPtr + nextOff, childRow as i32);
            let cj = load<i32>(lu.permInv + ((childRow as usize) << 2));
            let cLp: i32 = cj >= 0 ? load<i32>(lu.lColPtr + ((cj as usize) << 2)) + 1 : 0;
            store<i32>(dfsPtrPtr + nextOff, cLp);
            continue;
          }
        }
        top--;
        store<i32>(xiPtr + ((top as usize) << 2), currRow as i32);
        stackTop--;
      }
    }

    // 2. Scatter A(:, col) into scratchX
    for (let p: u32 = aStart; p < aEnd; p++) {
      let r = load<i32>(aRowIndices + ((p as usize) << 2)) as u32;
      store<f64>(lu.scratchX + ((r as usize) << 3), load<f64>(aValues + ((p as usize) << 3)));
    }

    // 3. Sparse triangular solve L(0..k-1) * u = A(:, col)
    for (let px: u32 = top; px < n; px++) {
      let r = load<i32>(xiPtr + ((px as usize) << 2)) as u32;
      let j = load<i32>(lu.permInv + ((r as usize) << 2));
      if (j < 0) continue;
      let xj = load<f64>(lu.scratchX + ((r as usize) << 3));
      if (Math.abs(xj) <= 1e-16) continue;

      let lStart = (load<i32>(lu.lColPtr + ((j as usize) << 2)) + 1) as u32;
      let lEnd = load<i32>(lu.lColPtr + (((j + 1) as usize) << 2)) as u32;
      for (let lp: u32 = lStart; lp < lEnd; lp++) {
        let lr = load<i32>(lu.lRowIndices + ((lp as usize) << 2)) as u32;
        let lVal = load<f64>(lu.lValues + ((lp as usize) << 3));
        let off = (lr as usize) << 3;
        store<f64>(lu.scratchX + off, load<f64>(lu.scratchX + off) - xj * lVal);
      }
    }

    // 4. Threshold Partial Pivoting among unpivoted rows in xi[top..n-1]
    let maxVal: f64 = -1.0;
    let pivotRow: i32 = -1;
    for (let px: u32 = top; px < n; px++) {
      let r = load<i32>(xiPtr + ((px as usize) << 2)) as u32;
      if (load<i32>(lu.permInv + ((r as usize) << 2)) < 0) {
        let absVal = Math.abs(load<f64>(lu.scratchX + ((r as usize) << 3)));
        if (absVal > maxVal) {
          maxVal = absVal;
          pivotRow = r as i32;
        }
      }
    }

    if (pivotThreshold < 1.0 && load<i32>(lu.permInv + ((col as usize) << 2)) < 0 && maxVal > 0.0) {
      let diagAbs = Math.abs(load<f64>(lu.scratchX + ((col as usize) << 3)));
      if (diagAbs >= pivotThreshold * maxVal && diagAbs >= 1e-12) {
        pivotRow = col as i32;
        maxVal = diagAbs;
      }
    }

    if (pivotRow < 0 || maxVal < 1e-14) {
      if (!allowPerturbation) {
        failed = true;
        break;
      }
      if (pivotRow < 0) {
        if (load<i32>(lu.permInv + ((col as usize) << 2)) < 0) {
          pivotRow = col as i32;
        } else {
          while (fallbackCursor < n && load<i32>(lu.permInv + ((fallbackCursor as usize) << 2)) >= 0) {
            fallbackCursor++;
          }
          pivotRow = fallbackCursor as i32;
        }
      }
      let pOff = (pivotRow as usize) << 3;
      let cur = load<f64>(lu.scratchX + pOff);
      store<f64>(lu.scratchX + pOff, cur >= 0.0 ? 1e-6 : -1e-6);
    }

    let pivU = pivotRow as u32;
    store<i32>(lu.perm + ((k as usize) << 2), pivU as i32);
    store<i32>(lu.permInv + ((pivU as usize) << 2), k as i32);

    let pivotVal = load<f64>(lu.scratchX + ((pivU as usize) << 3));
    store<f64>(lu.scratchX + ((pivU as usize) << 3), 0.0);

    // 5. Extract U(:, k) and L(:, k)
    let neededU = uLen + (n - top) + 2;
    if (neededU > lu.uCap) {
      let newCap = lu.uCap * 2 + (n - top) + 16;
      lu.uRowIndices = growI32Buf(lu.uRowIndices, uLen, newCap);
      lu.uValues = growF64Buf(lu.uValues, uLen, newCap);
      lu.uCap = newCap;
    }

    let neededL = lLen + (n - top) + 2;
    if (neededL > lu.lCap) {
      let newCap = lu.lCap * 2 + (n - top) + 16;
      lu.lRowIndices = growI32Buf(lu.lRowIndices, lLen, newCap);
      lu.lValues = growF64Buf(lu.lValues, lLen, newCap);
      lu.lCap = newCap;
    }

    let invPivot: f64 = 1.0 / pivotVal;
    store<f64>(lu.uDiagInv + ((k as usize) << 3), invPivot);

    // Unit diagonal of L(:, k)
    store<i32>(lu.lRowIndices + ((lLen as usize) << 2), pivU as i32);
    store<f64>(lu.lValues + ((lLen as usize) << 3), 1.0);
    lLen++;

    for (let px: u32 = top; px < n; px++) {
      let r = load<i32>(xiPtr + ((px as usize) << 2)) as u32;
      if (r == pivU) continue;
      let val = load<f64>(lu.scratchX + ((r as usize) << 3));
      store<f64>(lu.scratchX + ((r as usize) << 3), 0.0);

      let j = load<i32>(lu.permInv + ((r as usize) << 2));
      if (j >= 0) {
        if (keepStructural || Math.abs(val) > 1e-16) {
          store<i32>(lu.uRowIndices + ((uLen as usize) << 2), j);
          store<f64>(lu.uValues + ((uLen as usize) << 3), val);
          uLen++;
        }
      } else {
        if (keepStructural || Math.abs(val) > 1e-16) {
          store<i32>(lu.lRowIndices + ((lLen as usize) << 2), r as i32);
          store<f64>(lu.lValues + ((lLen as usize) << 3), val * invPivot);
          lLen++;
        }
      }
    }

    // Diagonal of U(:, k) stored last
    store<i32>(lu.uRowIndices + ((uLen as usize) << 2), k as i32);
    store<f64>(lu.uValues + ((uLen as usize) << 3), pivotVal);
    uLen++;
  }

  heap.free(xiPtr);
  heap.free(visitedPtr);
  heap.free(dfsRowPtr);
  heap.free(dfsPtrPtr);

  if (failed) {
    flatSparseLuFree(luPtr as u32);
    return 0;
  }

  store<i32>(lu.lColPtr + ((n as usize) << 2), lLen as i32);
  store<i32>(lu.uColPtr + ((n as usize) << 2), uLen as i32);
  lu.lLen = lLen;
  lu.uLen = uLen;

  // Map L row indices in-place from original row space to permuted pivot index permInv[r]
  for (let p: u32 = 0; p < lLen; p++) {
    let origRow = load<i32>(lu.lRowIndices + ((p as usize) << 2)) as u32;
    store<i32>(lu.lRowIndices + ((p as usize) << 2), load<i32>(lu.permInv + ((origRow as usize) << 2)));
  }

  return luPtr as u32;
}

export function flatSparseLuRefactorize(
  luPtr: u32,
  aColPtrPtr: u32,
  aRowIndicesPtr: u32,
  aValuesPtr: u32,
  allowPerturbation: bool,
  maxGrowth: f64,
): bool {
  if (luPtr == 0) return false;
  let lu = changetype<FlatSparseLU>(luPtr as usize);
  if (lu.hasSymbolicPattern == 0) return false;

  let n = lu.n;
  let aColPtr = aColPtrPtr as usize;
  let aRowIndices = aRowIndicesPtr as usize;
  let aValues = aValuesPtr as usize;
  let denseX = lu.scratchX;
  let pinv = lu.permInv;
  let colPerm = lu.colPerm;

  for (let k: u32 = 0; k < n; k++) {
    let col: u32 = colPerm != 0 ? (load<i32>(colPerm + ((k as usize) << 2)) as u32) : k;
    let aStart = load<i32>(aColPtr + ((col as usize) << 2)) as u32;
    let aEnd = load<i32>(aColPtr + (((col + 1) as usize) << 2)) as u32;

    for (let p: u32 = aStart; p < aEnd; p++) {
      let origRow = load<i32>(aRowIndices + ((p as usize) << 2)) as u32;
      let permRow = load<i32>(pinv + ((origRow as usize) << 2)) as u32;
      store<f64>(denseX + ((permRow as usize) << 3), load<f64>(aValues + ((p as usize) << 3)));
    }

    let uStart = load<i32>(lu.uColPtr + ((k as usize) << 2)) as u32;
    let uEnd = load<i32>(lu.uColPtr + (((k + 1) as usize) << 2)) as u32;
    let uDiagPos = uEnd - 1;

    for (let up: u32 = uStart; up < uDiagPos; up++) {
      let j = load<i32>(lu.uRowIndices + ((up as usize) << 2)) as u32;
      let jOff = (j as usize) << 3;
      let xj = load<f64>(denseX + jOff);
      store<f64>(lu.uValues + ((up as usize) << 3), xj);
      store<f64>(denseX + jOff, 0.0);
      if (Math.abs(xj) <= 1e-16) continue;

      let lStart = (load<i32>(lu.lColPtr + ((j as usize) << 2)) + 1) as u32;
      let lEnd = load<i32>(lu.lColPtr + (((j + 1) as usize) << 2)) as u32;
      for (let lp: u32 = lStart; lp < lEnd; lp++) {
        let lr = load<i32>(lu.lRowIndices + ((lp as usize) << 2)) as u32;
        let lVal = load<f64>(lu.lValues + ((lp as usize) << 3));
        let lrOff = (lr as usize) << 3;
        store<f64>(denseX + lrOff, load<f64>(denseX + lrOff) - xj * lVal);
      }
    }

    let kOff = (k as usize) << 3;
    let pivotVal = load<f64>(denseX + kOff);
    store<f64>(denseX + kOff, 0.0);
    if (Math.abs(pivotVal) < 1e-12) {
      if (!allowPerturbation) {
        let lStart = (load<i32>(lu.lColPtr + ((k as usize) << 2)) + 1) as u32;
        let lEnd = load<i32>(lu.lColPtr + (((k + 1) as usize) << 2)) as u32;
        for (let lp: u32 = lStart; lp < lEnd; lp++) {
          let lr = load<i32>(lu.lRowIndices + ((lp as usize) << 2)) as u32;
          store<f64>(denseX + ((lr as usize) << 3), 0.0);
        }
        return false;
      }
      pivotVal = pivotVal >= 0.0 ? 1e-6 : -1e-6;
    }

    store<f64>(lu.uValues + ((uDiagPos as usize) << 3), pivotVal);
    let invPivot: f64 = 1.0 / pivotVal;
    store<f64>(lu.uDiagInv + kOff, invPivot);

    let lStart = load<i32>(lu.lColPtr + ((k as usize) << 2)) as u32;
    let lEnd = load<i32>(lu.lColPtr + (((k + 1) as usize) << 2)) as u32;
    store<f64>(lu.lValues + ((lStart as usize) << 3), 1.0);

    let unstable = false;
    for (let lp: u32 = lStart + 1; lp < lEnd; lp++) {
      let lr = load<i32>(lu.lRowIndices + ((lp as usize) << 2)) as u32;
      let lrOff = (lr as usize) << 3;
      let mult = load<f64>(denseX + lrOff) * invPivot;
      store<f64>(denseX + lrOff, 0.0);
      store<f64>(lu.lValues + ((lp as usize) << 3), mult);
      if (Math.abs(mult) > maxGrowth) {
        unstable = true;
      }
    }

    if (unstable && !allowPerturbation) {
      return false;
    }
  }

  return true;
}

export function flatSparseLuSolve(luPtr: u32, bPtr: u32, xPtr: u32): bool {
  if (luPtr == 0 || bPtr == 0 || xPtr == 0) return false;
  let lu = changetype<FlatSparseLU>(luPtr as usize);
  let n = lu.n;
  let y = lu.scratchY;
  let b = bPtr as usize;
  let x = xPtr as usize;
  let colPerm = lu.colPerm;

  // 1. Permute RHS: y = P * b
  for (let i: u32 = 0; i < n; i++) {
    let pi = load<i32>(lu.perm + ((i as usize) << 2)) as u32;
    store<f64>(y + ((i as usize) << 3), load<f64>(b + ((pi as usize) << 3)));
  }

  // 2. Forward substitution: L * z = y
  for (let col: u32 = 0; col < n; col++) {
    let diagVal = load<f64>(y + ((col as usize) << 3));
    if (Math.abs(diagVal) < 1e-15) continue;

    let start = (load<i32>(lu.lColPtr + ((col as usize) << 2)) + 1) as u32;
    let end = load<i32>(lu.lColPtr + (((col + 1) as usize) << 2)) as u32;
    for (let p: u32 = start; p < end; p++) {
      let row = load<i32>(lu.lRowIndices + ((p as usize) << 2)) as u32;
      let lVal = load<f64>(lu.lValues + ((p as usize) << 3));
      let rOff = (row as usize) << 3;
      store<f64>(y + rOff, load<f64>(y + rOff) - diagVal * lVal);
    }
  }

  // 3. Back substitution: U * w = z and x = Q * w
  for (let col: i32 = (n as i32) - 1; col >= 0; col--) {
    let uCol = col as u32;
    let start = load<i32>(lu.uColPtr + ((uCol as usize) << 2)) as u32;
    let end = load<i32>(lu.uColPtr + (((uCol + 1) as usize) << 2)) as u32;

    let solCol = load<f64>(y + ((uCol as usize) << 3)) * load<f64>(lu.uDiagInv + ((uCol as usize) << 3));
    if (colPerm != 0) {
      let qCol = load<i32>(colPerm + ((uCol as usize) << 2)) as u32;
      store<f64>(x + ((qCol as usize) << 3), solCol);
    } else {
      store<f64>(x + ((uCol as usize) << 3), solCol);
    }

    for (let p: u32 = start; p < end; p++) {
      let row = load<i32>(lu.uRowIndices + ((p as usize) << 2)) as u32;
      if (row < uCol) {
        let uVal = load<f64>(lu.uValues + ((p as usize) << 3));
        let rOff = (row as usize) << 3;
        store<f64>(y + rOff, load<f64>(y + rOff) - solCol * uVal);
      }
    }
  }

  return true;
}

export function flatSparseLuGetMeta(luPtr: u32, outMetaPtr: u32): void {
  let lu = changetype<FlatSparseLU>(luPtr as usize);
  let out = outMetaPtr as usize;
  store<u32>(out, lu.n);
  store<u32>(out + 4, lu.lLen);
  store<u32>(out + 8, lu.uLen);
  store<u32>(out + 12, lu.lColPtr as u32);
  store<u32>(out + 16, lu.lRowIndices as u32);
  store<u32>(out + 20, lu.lValues as u32);
  store<u32>(out + 24, lu.uColPtr as u32);
  store<u32>(out + 28, lu.uRowIndices as u32);
  store<u32>(out + 32, lu.uValues as u32);
  store<u32>(out + 36, lu.uDiagInv as u32);
  store<u32>(out + 40, lu.perm as u32);
  store<u32>(out + 44, lu.permInv as u32);
}
