import { CCSMatrix } from "../autodiff/coloring";
import { ChunkedInt32Array, createChunkedInt32Array, UnmanagedFloat64Array, UnmanagedInt32Array } from "../core/array";
import { atomicChunkAlloc } from "../arena";

/**
 * Sparse LU Factorization Data Structure (Gilbert-Peierls Left-Looking)
 */
@unmanaged
export class SparseLU {
  n: u32;
  // L factors in CCS format
  lColPtr: ChunkedInt32Array;
  lRowIndices: ChunkedInt32Array;
  lValuesPtr: usize;
  // U factors in CCS format
  uColPtr: ChunkedInt32Array;
  uRowIndices: ChunkedInt32Array;
  uValuesPtr: usize;
  // Row permutation vector P
  perm: ChunkedInt32Array;
  permInv: ChunkedInt32Array;

  @inline get lValues(): UnmanagedFloat64Array { return changetype<UnmanagedFloat64Array>(this.lValuesPtr); }
  @inline get uValues(): UnmanagedFloat64Array { return changetype<UnmanagedFloat64Array>(this.uValuesPtr); }

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
  let maxNnz = A.nnz * 4 + n * 4;
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
      let permR = lu.perm.get(r) as u32;
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
    }

    let pivotVal = denseX[k];

    // 4. Store U factor column k (rows 0..k)
    for (let r: u32 = 0; r <= k; r++) {
      let val = denseX[r];
      if (Math.abs(val) > 1e-15 || r == k) {
        lu.uRowIndices.push(r as i32);
        uValues[unnz] = val;
        unnz++;
      }
    }
    lu.uColPtr.push(unnz as i32);

    // 5. Store L factor column k (rows k..n-1, normalized by pivotVal)
    lu.lRowIndices.push(k as i32);
    lValues[lnnz] = 1.0; // Unit diagonal
    lnnz++;

    for (let r: u32 = k + 1; r < n; r++) {
      let val = denseX[r];
      if (Math.abs(val) > 1e-15) {
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

export function dae_sparseLuFactor(ccsPtr: u32): u32 {
  if (ccsPtr == 0) return 0;
  let ccs = changetype<CCSMatrix>(ccsPtr);
  let lu = sparseLuFactor(ccs);
  return changetype<u32>(lu);
}

export function dae_sparseLuSolve(luPtr: u32, bPtr: u32, xPtr: u32): boolean {
  if (luPtr == 0 || bPtr == 0 || xPtr == 0) return false;
  let lu = changetype<SparseLU>(luPtr);
  return sparseLuSolve(lu, bPtr as usize, xPtr as usize);
}
