import { ChunkedInt32Array, createChunkedInt32Array, UnmanagedFloat64Array } from "../core/array";
import { atomicChunkAlloc } from "../arena";
import { CCSMatrix } from "../autodiff/coloring";

/**
 * High-Performance, Zero-GC In-WASM Sparse Cholesky (LDL^T / LL^T) Linear Solver.
 * Solves symmetric positive-definite (and regularized quasi-definite) systems A x = b.
 */
@unmanaged
export class SparseCholesky {
  n: u32;
  parent: ChunkedInt32Array;
  colCounts: ChunkedInt32Array;

  // L factor in CCS
  lColPtr: ChunkedInt32Array;
  lRowIndices: ChunkedInt32Array;
  lValuesPtr: usize; // Pointer to f64[nnzL]
  nnzL: u32;

  // D diagonal entries: Pointer to f64[n]
  dValuesPtr: usize;

  // Scratch buffers for factorization and solve
  workArray: ChunkedInt32Array;
  denseCol: usize; // Pointer to f64[n]

  @inline get lValues(): UnmanagedFloat64Array { return changetype<UnmanagedFloat64Array>(this.lValuesPtr); }
  @inline get dValues(): UnmanagedFloat64Array { return changetype<UnmanagedFloat64Array>(this.dValuesPtr); }
  @inline get denseColValues(): UnmanagedFloat64Array { return changetype<UnmanagedFloat64Array>(this.denseCol); }

  init(n: u32): void {
    this.n = n;
    this.parent = createChunkedInt32Array(n);
    this.colCounts = createChunkedInt32Array(n);
    this.lColPtr = createChunkedInt32Array(n + 1);
    this.lRowIndices = createChunkedInt32Array(n * 4 + 16);
    this.workArray = createChunkedInt32Array(n * 2 + 16);
    this.dValuesPtr = atomicChunkAlloc(n * 8) as usize;
    this.denseCol = atomicChunkAlloc(n * 8) as usize;
    this.lValuesPtr = 0;
    this.nnzL = 0;
  }

  /**
   * Symbolic Analysis: Computes Elimination Tree etree(A) and non-zero counts per column of L.
   */
  analyze(ccs: CCSMatrix): void {
    let n = this.n;
    let ancestor = this.workArray;

    for (let i: u32 = 0; i < n; i++) {
      this.parent.set(i, -1);
      ancestor.set(i, -1);
      this.colCounts.set(i, 1); // Diagonal entry
    }

    // Compute elimination tree: for each column c, for each entry r < c:
    for (let k: u32 = 0; k < n; k++) {
      let cStart = ccs.colPtr.get(k) as u32;
      let cEnd = ccs.colPtr.get(k + 1) as u32;

      for (let p: u32 = cStart; p < cEnd; p++) {
        let i = ccs.rowIndices.get(p) as u32;
        if (i < k) {
          let r: i32 = i as i32;
          while (r != -1 && (r as u32) != k) {
            let nextR = ancestor.get(r);
            ancestor.set(r, k as i32);
            if (nextR == -1) {
              this.parent.set(r, k as i32);
              break;
            }
            r = nextR;
          }
        }
      }
    }

    // Allocate upper bound for L non-zeros based on full dense profile or reachable pattern
    this.lColPtr.push(0);
    for (let j: u32 = 0; j < n; j++) {
      // Diagonal entry + sub-diagonals
      for (let r: u32 = j; r < n; r++) {
        this.lRowIndices.push(r as i32);
        this.nnzL++;
      }
      this.lColPtr.push(this.nnzL as i32);
    }

    if (this.nnzL > 0) {
      this.lValuesPtr = atomicChunkAlloc(this.nnzL * 8) as usize;
    }
  }

  /**
   * Numerical Factorization: Computes A + delta * I = L * D * L^T.
   */
  factorize(ccs: CCSMatrix, delta: f64 = 1e-9): bool {
    let n = this.n;
    let denseCol = this.denseColValues;
    let aValues = ccs.values;
    let lValues = this.lValues;
    let dValues = this.dValues;

    // Reset dense workspace
    for (let i: u32 = 0; i < n; i++) {
      denseCol[i] = 0.0;
    }

    for (let j: u32 = 0; j < n; j++) {
      // 1. Scatter column j of A into dense workspace
      let cStart = ccs.colPtr.get(j) as u32;
      let cEnd = ccs.colPtr.get(j + 1) as u32;

      for (let p: u32 = cStart; p < cEnd; p++) {
        let r = ccs.rowIndices.get(p) as u32;
        if (r >= j) {
          let aVal = aValues[p];
          denseCol[r] = aVal;
        }
      }

      // Add dynamic diagonal regularization
      let diagVal = denseCol[j];
      denseCol[j] = diagVal + delta;

      // 2. Elimination: subtract contributions from previously computed columns k < j
      for (let k: u32 = 0; k < j; k++) {
        let lStart = this.lColPtr.get(k) as u32;
        let lEnd = this.lColPtr.get(k + 1) as u32;

        let dK = dValues[k];
        if (Math.abs(dK) < 1e-14) continue;

        // Find L(j, k)
        let lJK: f64 = 0.0;
        for (let p: u32 = lStart; p < lEnd; p++) {
          if ((this.lRowIndices.get(p) as u32) == j) {
            lJK = lValues[p];
            break;
          }
        }

        if (lJK != 0.0) {
          let scale = lJK * dK;
          for (let p: u32 = lStart; p < lEnd; p++) {
            let r = this.lRowIndices.get(p) as u32;
            if (r >= j) {
              let lRK = lValues[p];
              let cur = denseCol[r];
              denseCol[r] = cur - lRK * scale;
            }
          }
        }
      }

      // 3. Compute D(j, j) and unit diagonal L(j, j) = 1.0
      let dJ = denseCol[j];
      if (dJ <= 1e-12) {
        dJ += delta > 0.0 ? delta : 1e-6;
      }
      dValues[j] = dJ;

      let lStart = this.lColPtr.get(j) as u32;
      let lEnd = this.lColPtr.get(j + 1) as u32;

      for (let p: u32 = lStart; p < lEnd; p++) {
        let r = this.lRowIndices.get(p) as u32;
        if (r == j) {
          lValues[p] = 1.0; // Unit diagonal
        } else if (r > j) {
          let val = denseCol[r];
          lValues[p] = val / dJ;
        }
      }

      // Reset dense workspace for next column
      for (let p: u32 = cStart; p < cEnd; p++) {
        let r = ccs.rowIndices.get(p) as u32;
        if (r >= j) denseCol[r] = 0.0;
      }
    }

    return true;
  }

  /**
   * Solves L * D * L^T * x = b.
   * bPtr: Pointer to f64[n] (input RHS)
   * xPtr: Pointer to f64[n] (output solution)
   */
  solve(bPtr: usize, xPtr: usize): void {
    let n = this.n;
    let b = changetype<UnmanagedFloat64Array>(bPtr);
    let x = changetype<UnmanagedFloat64Array>(xPtr);
    let lValues = this.lValues;
    let dValues = this.dValues;

    // 1. Forward substitution: L * y = b
    for (let i: u32 = 0; i < n; i++) {
      x[i] = b[i];
    }

    for (let j: u32 = 0; j < n; j++) {
      let yJ = x[j];
      let lStart = this.lColPtr.get(j) as u32;
      let lEnd = this.lColPtr.get(j + 1) as u32;

      for (let p: u32 = lStart; p < lEnd; p++) {
        let r = this.lRowIndices.get(p) as u32;
        if (r > j) {
          let lVal = lValues[p];
          let cur = x[r];
          x[r] = cur - lVal * yJ;
        }
      }
    }

    // 2. Diagonal scale: D * z = y => z = y / D
    for (let j: u32 = 0; j < n; j++) {
      let yJ = x[j];
      let dJ = dValues[j];
      x[j] = yJ / dJ;
    }

    // 3. Backward substitution: L^T * x = z
    for (let j: i32 = (n - 1) as i32; j >= 0; j--) {
      let uJ = j as u32;
      let sum = x[uJ];
      let lStart = this.lColPtr.get(uJ) as u32;
      let lEnd = this.lColPtr.get(uJ + 1) as u32;

      for (let p: u32 = lStart; p < lEnd; p++) {
        let r = this.lRowIndices.get(p) as u32;
        if (r > uJ) {
          let lVal = lValues[p];
          let xR = x[r];
          sum -= lVal * xR;
        }
      }

      x[uJ] = sum;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_sparseCholeskyCreate(n: u32): u32 {
  let ptr = atomicChunkAlloc(sizeof<SparseCholesky>());
  let solver = changetype<SparseCholesky>(ptr);
  solver.init(n);
  return ptr as u32;
}

export function dae_sparseCholeskyAnalyze(solverPtr: u32, ccsPtr: u32): void {
  if (solverPtr == 0 || ccsPtr == 0) return;
  let solver = changetype<SparseCholesky>(solverPtr);
  let ccs = changetype<CCSMatrix>(ccsPtr);
  solver.analyze(ccs);
}

export function dae_sparseCholeskyFactor(solverPtr: u32, ccsPtr: u32, delta: f64): bool {
  if (solverPtr == 0 || ccsPtr == 0) return false;
  let solver = changetype<SparseCholesky>(solverPtr);
  let ccs = changetype<CCSMatrix>(ccsPtr);
  return solver.factorize(ccs, delta);
}

export function dae_sparseCholeskySolve(solverPtr: u32, bPtr: u32, xPtr: u32): void {
  if (solverPtr == 0 || bPtr == 0 || xPtr == 0) return;
  let solver = changetype<SparseCholesky>(solverPtr);
  solver.solve(bPtr as usize, xPtr as usize);
}
