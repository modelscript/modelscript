// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zero-GC AssemblyScript Krylov Subspace Solvers & ILU(0) Preconditioner.
 *
 * Implements:
 *  - CCS sparse matrix-vector product (`ccsMatVecWasm`)
 *  - Saad's IKJ static-pattern ILU(0) factorization and triangular solve (`ilu0FactorWasm`, `ilu0SolveWasm`)
 *  - Restarted GMRES(m) with Givens rotations (`gmresCcsWasm`)
 *  - BiCGStab (`bicgstabCcsWasm`)
 *  - Two-pass Modified Gram-Schmidt Arnoldi orthogonalization (`mgsOrthogonalizeWasm`)
 */

@unmanaged
export class FlatILU0 {
  n: u32;
  totalNnz: u32;
  rowPtr: usize;
  colIndices: usize;
  luValues: usize;
  diagPtr: usize;
  scratchY: usize;
}

export function ilu0FreeWasm(iluPtr: u32): void {
  if (iluPtr == 0) return;
  let ilu = changetype<FlatILU0>(iluPtr as usize);
  if (ilu.rowPtr != 0) heap.free(ilu.rowPtr);
  if (ilu.colIndices != 0) heap.free(ilu.colIndices);
  if (ilu.luValues != 0) heap.free(ilu.luValues);
  if (ilu.diagPtr != 0) heap.free(ilu.diagPtr);
  if (ilu.scratchY != 0) heap.free(ilu.scratchY);
  heap.free(iluPtr as usize);
}

export function ccsMatVecWasm(
  nRows: u32,
  nCols: u32,
  colPtrPtr: u32,
  rowIndicesPtr: u32,
  valuesPtr: u32,
  vPtr: u32,
  outPtr: u32,
): void {
  let colPtr = colPtrPtr as usize;
  let rowIndices = rowIndicesPtr as usize;
  let values = valuesPtr as usize;
  let v = vPtr as usize;
  let out = outPtr as usize;

  memory.fill(out, 0, (nRows as usize) << 3);

  for (let col: u32 = 0; col < nCols; col++) {
    let vj = load<f64>(v + ((col as usize) << 3));
    if (vj == 0.0) continue;
    let start = load<i32>(colPtr + ((col as usize) << 2)) as u32;
    let end = load<i32>(colPtr + (((col + 1) as usize) << 2)) as u32;
    for (let p: u32 = start; p < end; p++) {
      let row = load<i32>(rowIndices + ((p as usize) << 2)) as u32;
      let val = load<f64>(values + ((p as usize) << 3));
      let rOff = (row as usize) << 3;
      store<f64>(out + rOff, load<f64>(out + rOff) + val * vj);
    }
  }
}

export function ilu0FactorWasm(
  n: u32,
  colPtrPtr: u32,
  rowIndicesPtr: u32,
  valuesPtr: u32,
  outMetaPtr: u32,
): u32 {
  let aColPtr = colPtrPtr as usize;
  let aRowIndices = rowIndicesPtr as usize;
  let aValues = valuesPtr as usize;

  let nBytesI32 = (n as usize) << 2;
  let np1BytesI32 = ((n + 1) as usize) << 2;

  let rowCounts = heap.alloc(nBytesI32);
  let hasDiag = heap.alloc(n as usize);
  memory.fill(rowCounts, 0, nBytesI32);
  memory.fill(hasDiag, 0, n as usize);

  for (let col: u32 = 0; col < n; col++) {
    let start = load<i32>(aColPtr + ((col as usize) << 2)) as u32;
    let end = load<i32>(aColPtr + (((col + 1) as usize) << 2)) as u32;
    for (let p: u32 = start; p < end; p++) {
      let row = load<i32>(aRowIndices + ((p as usize) << 2)) as u32;
      let rcOff = (row as usize) << 2;
      store<i32>(rowCounts + rcOff, load<i32>(rowCounts + rcOff) + 1);
      if (row == col) {
        store<u8>(hasDiag + (row as usize), 1);
      }
    }
  }

  for (let i: u32 = 0; i < n; i++) {
    if (load<u8>(hasDiag + (i as usize)) == 0) {
      let rcOff = (i as usize) << 2;
      store<i32>(rowCounts + rcOff, load<i32>(rowCounts + rcOff) + 1);
    }
  }

  let iluPtr = heap.alloc(offsetof<FlatILU0>());
  let ilu = changetype<FlatILU0>(iluPtr);
  ilu.n = n;
  ilu.rowPtr = heap.alloc(np1BytesI32);
  store<i32>(ilu.rowPtr, 0);
  for (let i: u32 = 0; i < n; i++) {
    let prev = load<i32>(ilu.rowPtr + ((i as usize) << 2));
    let cnt = load<i32>(rowCounts + ((i as usize) << 2));
    store<i32>(ilu.rowPtr + (((i + 1) as usize) << 2), prev + cnt);
  }
  heap.free(rowCounts);

  let totalNnz = load<i32>(ilu.rowPtr + ((n as usize) << 2)) as u32;
  ilu.totalNnz = totalNnz;
  ilu.colIndices = heap.alloc((totalNnz as usize) << 2);
  ilu.luValues = heap.alloc((totalNnz as usize) << 3);
  ilu.diagPtr = heap.alloc(nBytesI32);
  ilu.scratchY = heap.alloc((n as usize) << 3);

  let writePos = heap.alloc(nBytesI32);
  memory.copy(writePos, ilu.rowPtr, nBytesI32);

  for (let col: u32 = 0; col < n; col++) {
    if (load<u8>(hasDiag + (col as usize)) == 0) {
      let cOff = (col as usize) << 2;
      let pos = load<i32>(writePos + cOff) as u32;
      store<i32>(ilu.colIndices + ((pos as usize) << 2), col as i32);
      store<f64>(ilu.luValues + ((pos as usize) << 3), 1e-12);
      store<i32>(writePos + cOff, (pos + 1) as i32);
      store<u8>(hasDiag + (col as usize), 1);
    }
    let start = load<i32>(aColPtr + ((col as usize) << 2)) as u32;
    let end = load<i32>(aColPtr + (((col + 1) as usize) << 2)) as u32;
    for (let p: u32 = start; p < end; p++) {
      let row = load<i32>(aRowIndices + ((p as usize) << 2)) as u32;
      let rOff = (row as usize) << 2;
      let pos = load<i32>(writePos + rOff) as u32;
      store<i32>(ilu.colIndices + ((pos as usize) << 2), col as i32);
      store<f64>(ilu.luValues + ((pos as usize) << 3), load<f64>(aValues + ((p as usize) << 3)));
      store<i32>(writePos + rOff, (pos + 1) as i32);
    }
  }
  heap.free(writePos);
  heap.free(hasDiag);

  // Sort each row and locate diagonal
  for (let i: u32 = 0; i < n; i++) {
    let start = load<i32>(ilu.rowPtr + ((i as usize) << 2)) as i32;
    let end = load<i32>(ilu.rowPtr + (((i + 1) as usize) << 2)) as i32;
    for (let p: i32 = start + 1; p < end; p++) {
      let cVal = load<i32>(ilu.colIndices + ((p as usize) << 2));
      let vVal = load<f64>(ilu.luValues + ((p as usize) << 3));
      let q: i32 = p - 1;
      while (q >= start) {
        let qc = load<i32>(ilu.colIndices + ((q as usize) << 2));
        if (qc <= cVal) break;
        store<i32>(ilu.colIndices + (((q + 1) as usize) << 2), qc);
        store<f64>(ilu.luValues + (((q + 1) as usize) << 3), load<f64>(ilu.luValues + ((q as usize) << 3)));
        q--;
      }
      store<i32>(ilu.colIndices + (((q + 1) as usize) << 2), cVal);
      store<f64>(ilu.luValues + (((q + 1) as usize) << 3), vVal);
    }
    for (let p: i32 = start; p < end; p++) {
      if (load<i32>(ilu.colIndices + ((p as usize) << 2)) == (i as i32)) {
        store<i32>(ilu.diagPtr + ((i as usize) << 2), p);
        break;
      }
    }
  }

  // Saad Algorithm 10.4 IKJ ILU(0)
  let iw = heap.alloc(nBytesI32);
  memory.fill(iw, 0xff, nBytesI32);

  for (let i: u32 = 0; i < n; i++) {
    let rowStart = load<i32>(ilu.rowPtr + ((i as usize) << 2));
    let rowEnd = load<i32>(ilu.rowPtr + (((i + 1) as usize) << 2));
    let diagIdx = load<i32>(ilu.diagPtr + ((i as usize) << 2));

    for (let p: i32 = rowStart; p < rowEnd; p++) {
      let c = load<i32>(ilu.colIndices + ((p as usize) << 2)) as u32;
      store<i32>(iw + ((c as usize) << 2), p);
    }

    for (let p: i32 = rowStart; p < diagIdx; p++) {
      let k = load<i32>(ilu.colIndices + ((p as usize) << 2)) as u32;
      let kDiag = load<i32>(ilu.diagPtr + ((k as usize) << 2));
      let ukk = load<f64>(ilu.luValues + ((kDiag as usize) << 3));
      let pivot: f64 = Math.abs(ukk) > 1e-15 ? ukk : ukk >= 0.0 ? 1e-15 : -1e-15;
      let lik = load<f64>(ilu.luValues + ((p as usize) << 3)) / pivot;
      store<f64>(ilu.luValues + ((p as usize) << 3), lik);

      let kEnd = load<i32>(ilu.rowPtr + (((k + 1) as usize) << 2));
      for (let kp: i32 = kDiag + 1; kp < kEnd; kp++) {
        let j = load<i32>(ilu.colIndices + ((kp as usize) << 2)) as u32;
        let ijPos = load<i32>(iw + ((j as usize) << 2));
        if (ijPos != -1) {
          let ijOff = (ijPos as usize) << 3;
          let kVal = load<f64>(ilu.luValues + ((kp as usize) << 3));
          store<f64>(ilu.luValues + ijOff, load<f64>(ilu.luValues + ijOff) - lik * kVal);
        }
      }
    }

    let dOff = (diagIdx as usize) << 3;
    let diagVal = load<f64>(ilu.luValues + dOff);
    if (Math.abs(diagVal) < 1e-15) {
      store<f64>(ilu.luValues + dOff, diagVal >= 0.0 ? 1e-12 : -1e-12);
    }

    for (let p: i32 = rowStart; p < rowEnd; p++) {
      let c = load<i32>(ilu.colIndices + ((p as usize) << 2)) as u32;
      store<i32>(iw + ((c as usize) << 2), -1);
    }
  }
  heap.free(iw);

  if (outMetaPtr != 0) {
    let out = outMetaPtr as usize;
    store<u32>(out, totalNnz);
    store<u32>(out + 4, ilu.rowPtr as u32);
    store<u32>(out + 8, ilu.colIndices as u32);
    store<u32>(out + 12, ilu.luValues as u32);
    store<u32>(out + 16, ilu.diagPtr as u32);
  }

  return iluPtr as u32;
}

export function ilu0SolveWasm(iluPtr: u32, rPtr: u32, outPtr: u32): void {
  let ilu = changetype<FlatILU0>(iluPtr as usize);
  let n = ilu.n;
  let r = rPtr as usize;
  let out = outPtr as usize;
  let y = ilu.scratchY;

  // Forward: L * y = r
  for (let i: u32 = 0; i < n; i++) {
    let sum = load<f64>(r + ((i as usize) << 3));
    let start = load<i32>(ilu.rowPtr + ((i as usize) << 2));
    let diag = load<i32>(ilu.diagPtr + ((i as usize) << 2));
    for (let p: i32 = start; p < diag; p++) {
      let col = load<i32>(ilu.colIndices + ((p as usize) << 2)) as u32;
      let lVal = load<f64>(ilu.luValues + ((p as usize) << 3));
      sum -= lVal * load<f64>(y + ((col as usize) << 3));
    }
    store<f64>(y + ((i as usize) << 3), sum);
  }

  // Backward: U * out = y
  for (let i: i32 = (n as i32) - 1; i >= 0; i--) {
    let uI = i as u32;
    let sum = load<f64>(y + ((uI as usize) << 3));
    let diag = load<i32>(ilu.diagPtr + ((uI as usize) << 2));
    let end = load<i32>(ilu.rowPtr + (((uI + 1) as usize) << 2));
    for (let p: i32 = diag + 1; p < end; p++) {
      let col = load<i32>(ilu.colIndices + ((p as usize) << 2)) as u32;
      let uVal = load<f64>(ilu.luValues + ((p as usize) << 3));
      sum -= uVal * load<f64>(out + ((col as usize) << 3));
    }
    let diagVal = load<f64>(ilu.luValues + ((diag as usize) << 3));
    store<f64>(out + ((uI as usize) << 3), sum / diagVal);
  }
}

@inline
function vecNorm2(ptr: usize, n: u32): f64 {
  let sum: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    let v = load<f64>(ptr + ((i as usize) << 3));
    sum += v * v;
  }
  return Math.sqrt(sum);
}

@inline
function vecDot(aPtr: usize, bPtr: usize, n: u32): f64 {
  let sum: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    let off = (i as usize) << 3;
    sum += load<f64>(aPtr + off) * load<f64>(bPtr + off);
  }
  return sum;
}

/**
 * Right-preconditioned Restarted GMRES(m) over a CCS matrix in WASM linear memory.
 * Returns `iterations` (>= 0) if converged, or `-(iterations + 1)` if maxIter reached.
 */
export function gmresCcsWasm(
  n: u32,
  colPtrPtr: u32,
  rowIndicesPtr: u32,
  valuesPtr: u32,
  bPtr: u32,
  xPtr: u32,
  iluPtr: u32,
  tol: f64,
  maxIter: i32,
  restart: i32,
  outResNormPtr: u32,
): i32 {
  if (n == 0) {
    store<f64>(outResNormPtr as usize, 0.0);
    return 0;
  }

  let m: i32 = restart < 1 ? 1 : restart;
  if (m > (n as i32)) m = n as i32;

  let b = bPtr as usize;
  let x = xPtr as usize;
  let nBytes = (n as usize) << 3;

  let r0Ptr = heap.alloc(nBytes);
  let wPtr = heap.alloc(nBytes);
  let zPtr = heap.alloc(nBytes);
  let VPtr = heap.alloc(((m + 1) as usize) * nBytes);
  let HPtr = heap.alloc((((m + 1) * m) as usize) << 3);
  let csPtr = heap.alloc((m as usize) << 3);
  let snPtr = heap.alloc((m as usize) << 3);
  let gPtr = heap.alloc(((m + 1) as usize) << 3);
  let yPtr = heap.alloc((m as usize) << 3);

  let bNorm = vecNorm2(b, n);
  let threshold: f64 = tol * (bNorm > 1.0 ? bNorm : 1.0);
  let totalIters: i32 = 0;
  let finalResNorm: f64 = 0.0;
  let converged = false;

  while (totalIters < maxIter) {
    ccsMatVecWasm(n, n, colPtrPtr, rowIndicesPtr, valuesPtr, xPtr, r0Ptr as u32);
    for (let i: u32 = 0; i < n; i++) {
      let off = (i as usize) << 3;
      store<f64>(r0Ptr + off, load<f64>(b + off) - load<f64>(r0Ptr + off));
    }

    let beta = vecNorm2(r0Ptr, n);
    finalResNorm = beta;
    if (beta <= threshold) {
      converged = true;
      break;
    }

    let invBeta = 1.0 / beta;
    for (let i: u32 = 0; i < n; i++) {
      let off = (i as usize) << 3;
      store<f64>(VPtr + off, load<f64>(r0Ptr + off) * invBeta);
    }

    memory.fill(gPtr, 0, ((m + 1) as usize) << 3);
    store<f64>(gPtr, beta);
    memory.fill(HPtr, 0, (((m + 1) * m) as usize) << 3);

    let kReached: i32 = 0;
    for (let j: i32 = 0; j < m && totalIters < maxIter; j++) {
      totalIters++;
      kReached = j + 1;

      let vjPtr = VPtr + (j as usize) * nBytes;
      if (iluPtr != 0) {
        ilu0SolveWasm(iluPtr, vjPtr as u32, zPtr as u32);
      } else {
        memory.copy(zPtr, vjPtr, nBytes);
      }

      ccsMatVecWasm(n, n, colPtrPtr, rowIndicesPtr, valuesPtr, zPtr as u32, wPtr as u32);

      // Modified Gram-Schmidt
      for (let i: i32 = 0; i <= j; i++) {
        let viPtr = VPtr + (i as usize) * nBytes;
        let hij = vecDot(wPtr, viPtr, n);
        store<f64>(HPtr + (((i * m + j) as usize) << 3), hij);
        for (let row: u32 = 0; row < n; row++) {
          let off = (row as usize) << 3;
          store<f64>(wPtr + off, load<f64>(wPtr + off) - hij * load<f64>(viPtr + off));
        }
      }

      let hNext = vecNorm2(wPtr, n);
      store<f64>(HPtr + ((((j + 1) * m + j) as usize) << 3), hNext);
      if (hNext > 1e-30) {
        let invH = 1.0 / hNext;
        let vNextPtr = VPtr + ((j + 1) as usize) * nBytes;
        for (let row: u32 = 0; row < n; row++) {
          let off = (row as usize) << 3;
          store<f64>(vNextPtr + off, load<f64>(wPtr + off) * invH);
        }
      }

      // Apply previous Givens rotations
      for (let i: i32 = 0; i < j; i++) {
        let csI = load<f64>(csPtr + ((i as usize) << 3));
        let snI = load<f64>(snPtr + ((i as usize) << 3));
        let h0Off = ((i * m + j) as usize) << 3;
        let h1Off = (((i + 1) * m + j) as usize) << 3;
        let h0 = load<f64>(HPtr + h0Off);
        let h1 = load<f64>(HPtr + h1Off);
        store<f64>(HPtr + h0Off, csI * h0 + snI * h1);
        store<f64>(HPtr + h1Off, -snI * h0 + csI * h1);
      }

      let hjjOff = ((j * m + j) as usize) << 3;
      let hj1Off = (((j + 1) * m + j) as usize) << 3;
      let hjj = load<f64>(HPtr + hjjOff);
      let hj1 = load<f64>(HPtr + hj1Off);
      let denom = Math.hypot(hjj, hj1);
      let csJ: f64 = denom > 1e-30 ? hjj / denom : 1.0;
      let snJ: f64 = denom > 1e-30 ? hj1 / denom : 0.0;
      store<f64>(csPtr + ((j as usize) << 3), csJ);
      store<f64>(snPtr + ((j as usize) << 3), snJ);

      store<f64>(HPtr + hjjOff, csJ * hjj + snJ * hj1);
      store<f64>(HPtr + hj1Off, 0.0);

      let gjOff = (j as usize) << 3;
      let gj = load<f64>(gPtr + gjOff);
      store<f64>(gPtr + gjOff, csJ * gj);
      let gNext = -snJ * gj;
      store<f64>(gPtr + (((j + 1) as usize) << 3), gNext);

      finalResNorm = Math.abs(gNext);
      if (finalResNorm <= threshold) {
        converged = true;
        break;
      }
    }

    // Back-substitution H[0..k-1][0..k-1] * y = g[0..k-1]
    for (let i: i32 = kReached - 1; i >= 0; i--) {
      let sum = load<f64>(gPtr + ((i as usize) << 3));
      for (let j: i32 = i + 1; j < kReached; j++) {
        sum -= load<f64>(HPtr + (((i * m + j) as usize) << 3)) * load<f64>(yPtr + ((j as usize) << 3));
      }
      let diag = load<f64>(HPtr + (((i * m + i) as usize) << 3));
      store<f64>(yPtr + ((i as usize) << 3), Math.abs(diag) > 1e-30 ? sum / diag : 0.0);
    }

    // x += M^{-1} (V * y)
    memory.fill(wPtr, 0, nBytes);
    for (let j: i32 = 0; j < kReached; j++) {
      let yj = load<f64>(yPtr + ((j as usize) << 3));
      let vjPtr = VPtr + (j as usize) * nBytes;
      for (let row: u32 = 0; row < n; row++) {
        let off = (row as usize) << 3;
        store<f64>(wPtr + off, load<f64>(wPtr + off) + yj * load<f64>(vjPtr + off));
      }
    }

    if (iluPtr != 0) {
      ilu0SolveWasm(iluPtr, wPtr as u32, zPtr as u32);
    } else {
      memory.copy(zPtr, wPtr, nBytes);
    }
    for (let row: u32 = 0; row < n; row++) {
      let off = (row as usize) << 3;
      store<f64>(x + off, load<f64>(x + off) + load<f64>(zPtr + off));
    }

    if (converged) break;
  }

  // Recompute exact residual norm on exit
  ccsMatVecWasm(n, n, colPtrPtr, rowIndicesPtr, valuesPtr, xPtr, r0Ptr as u32);
  let sumSq: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    let off = (i as usize) << 3;
    let d = load<f64>(b + off) - load<f64>(r0Ptr + off);
    sumSq += d * d;
  }
  finalResNorm = Math.sqrt(sumSq);

  heap.free(r0Ptr);
  heap.free(wPtr);
  heap.free(zPtr);
  heap.free(VPtr);
  heap.free(HPtr);
  heap.free(csPtr);
  heap.free(snPtr);
  heap.free(gPtr);
  heap.free(yPtr);

  store<f64>(outResNormPtr as usize, finalResNorm);
  return (converged || finalResNorm <= threshold) ? totalIters : -(totalIters + 1);
}

/**
 * Right-preconditioned BiCGStab over a CCS matrix in WASM linear memory.
 * Returns `iterations` (>= 0) if converged, or `-(iterations + 1)` if not converged.
 */
export function bicgstabCcsWasm(
  n: u32,
  colPtrPtr: u32,
  rowIndicesPtr: u32,
  valuesPtr: u32,
  bPtr: u32,
  xPtr: u32,
  iluPtr: u32,
  tol: f64,
  maxIter: i32,
  outResNormPtr: u32,
): i32 {
  if (n == 0) {
    store<f64>(outResNormPtr as usize, 0.0);
    return 0;
  }

  let b = bPtr as usize;
  let x = xPtr as usize;
  let nBytes = (n as usize) << 3;

  let rPtr = heap.alloc(nBytes);
  let rHatPtr = heap.alloc(nBytes);
  let pPtr = heap.alloc(nBytes);
  let vPtr = heap.alloc(nBytes);
  let sPtr = heap.alloc(nBytes);
  let tPtr = heap.alloc(nBytes);
  let yPtr = heap.alloc(nBytes);
  let zPtr = heap.alloc(nBytes);

  memory.fill(pPtr, 0, nBytes);
  memory.fill(vPtr, 0, nBytes);

  let bNorm = vecNorm2(b, n);
  let threshold: f64 = tol * (bNorm > 1.0 ? bNorm : 1.0);

  ccsMatVecWasm(n, n, colPtrPtr, rowIndicesPtr, valuesPtr, xPtr, rPtr as u32);
  for (let i: u32 = 0; i < n; i++) {
    let off = (i as usize) << 3;
    let ri = load<f64>(b + off) - load<f64>(rPtr + off);
    store<f64>(rPtr + off, ri);
    store<f64>(rHatPtr + off, ri);
  }

  let resNorm = vecNorm2(rPtr, n);
  if (resNorm <= threshold) {
    heap.free(rPtr);
    heap.free(rHatPtr);
    heap.free(pPtr);
    heap.free(vPtr);
    heap.free(sPtr);
    heap.free(tPtr);
    heap.free(yPtr);
    heap.free(zPtr);
    store<f64>(outResNormPtr as usize, resNorm);
    return 0;
  }

  let rhoPrev: f64 = 1.0;
  let alpha: f64 = 1.0;
  let omega: f64 = 1.0;
  let iters: i32 = 0;
  let converged = false;

  for (let k: i32 = 0; k < maxIter; k++) {
    iters++;
    let rho = vecDot(rHatPtr, rPtr, n);
    if (Math.abs(rho) < 1e-30) break;

    let beta: f64 = (rho / rhoPrev) * (alpha / omega);
    for (let i: u32 = 0; i < n; i++) {
      let off = (i as usize) << 3;
      let pi = load<f64>(rPtr + off) + beta * (load<f64>(pPtr + off) - omega * load<f64>(vPtr + off));
      store<f64>(pPtr + off, pi);
    }

    if (iluPtr != 0) {
      ilu0SolveWasm(iluPtr, pPtr as u32, yPtr as u32);
    } else {
      memory.copy(yPtr, pPtr, nBytes);
    }
    ccsMatVecWasm(n, n, colPtrPtr, rowIndicesPtr, valuesPtr, yPtr as u32, vPtr as u32);

    let denom = vecDot(rHatPtr, vPtr, n);
    if (Math.abs(denom) < 1e-30) break;
    alpha = rho / denom;

    for (let i: u32 = 0; i < n; i++) {
      let off = (i as usize) << 3;
      store<f64>(sPtr + off, load<f64>(rPtr + off) - alpha * load<f64>(vPtr + off));
    }

    let sNorm = vecNorm2(sPtr, n);
    if (sNorm <= threshold) {
      for (let i: u32 = 0; i < n; i++) {
        let off = (i as usize) << 3;
        store<f64>(x + off, load<f64>(x + off) + alpha * load<f64>(yPtr + off));
      }
      resNorm = sNorm;
      converged = true;
      break;
    }

    if (iluPtr != 0) {
      ilu0SolveWasm(iluPtr, sPtr as u32, zPtr as u32);
    } else {
      memory.copy(zPtr, sPtr, nBytes);
    }
    ccsMatVecWasm(n, n, colPtrPtr, rowIndicesPtr, valuesPtr, zPtr as u32, tPtr as u32);

    let tt = vecDot(tPtr, tPtr, n);
    if (tt < 1e-30) break;
    omega = vecDot(tPtr, sPtr, n) / tt;

    for (let i: u32 = 0; i < n; i++) {
      let off = (i as usize) << 3;
      store<f64>(x + off, load<f64>(x + off) + alpha * load<f64>(yPtr + off) + omega * load<f64>(zPtr + off));
      store<f64>(rPtr + off, load<f64>(sPtr + off) - omega * load<f64>(tPtr + off));
    }

    resNorm = vecNorm2(rPtr, n);
    if (resNorm <= threshold) {
      converged = true;
      break;
    }
    if (Math.abs(omega) < 1e-30) break;
    rhoPrev = rho;
  }

  heap.free(rPtr);
  heap.free(rHatPtr);
  heap.free(pPtr);
  heap.free(vPtr);
  heap.free(sPtr);
  heap.free(tPtr);
  heap.free(yPtr);
  heap.free(zPtr);

  store<f64>(outResNormPtr as usize, resNorm);
  return converged ? iters : -(iters + 1);
}

/**
 * Two-pass Modified Gram-Schmidt orthogonalization for Arnoldi iteration.
 * Orthogonalizes `w` (length n) against columns 0..k of `qMat` (row-major or column-strided: column j at offset j*n),
 * accumulating projections into `hCol[0..k]` and returning final `||w||_2`.
 */
export function mgsOrthogonalizeWasm(
  n: u32,
  k: u32,
  qMatPtr: u32,
  wPtr: u32,
  hColPtr: u32,
): f64 {
  let qMat = qMatPtr as usize;
  let w = wPtr as usize;
  let hCol = hColPtr as usize;
  let nBytes = (n as usize) << 3;

  for (let i: u32 = 0; i <= k; i++) {
    let qi = qMat + (i as usize) * nBytes;
    let dot = vecDot(w, qi, n);
    store<f64>(hCol + ((i as usize) << 3), dot);
    for (let row: u32 = 0; row < n; row++) {
      let off = (row as usize) << 3;
      store<f64>(w + off, load<f64>(w + off) - dot * load<f64>(qi + off));
    }
  }

  // Second pass (DGKS reorthogonalization)
  for (let i: u32 = 0; i <= k; i++) {
    let qi = qMat + (i as usize) * nBytes;
    let corr = vecDot(w, qi, n);
    let hOff = (i as usize) << 3;
    store<f64>(hCol + hOff, load<f64>(hCol + hOff) + corr);
    for (let row: u32 = 0; row < n; row++) {
      let off = (row as usize) << 3;
      store<f64>(w + off, load<f64>(w + off) - corr * load<f64>(qi + off));
    }
  }

  return vecNorm2(w, n);
}
