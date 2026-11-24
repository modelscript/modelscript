// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for Domain-Decomposed Parallel Krylov (RAS-GMRES).
 *
 * Implements zero-GC flat linear-memory kernels for:
 * - Vector operations: dot product (`dk_dot`), Euclidean norm (`dk_norm2`), AXPY (`dk_axpy`)
 * - Sparse & dense matrix-vector products: CSR SpMV (`dk_csr_spmv`, `dk_csr_spmv_rows`),
 *   dense GEMV (`dk_dense_matvec`)
 * - Dense partial-pivoting LU factorization & solve for RAS subdomain blocks
 *   (`dk_dense_lu_factor`, `dk_dense_lu_solve`)
 * - GMRES Krylov subspace kernels: Modified Gram-Schmidt Arnoldi orthogonalization
 *   (`dk_mgs_arnoldi_step`), Givens rotations (`dk_gmres_givens_step`), upper-triangular
 *   back-substitution (`dk_gmres_back_sub`), and right-preconditioned solution update
 *   (`dk_gmres_update_solution`).
 */

/**
 * Computes the dot product `sum_{i=0}^{n-1} a[i] * b[i]`.
 */
export function dk_dot(n: i32, aPtr: usize, bPtr: usize): f64 {
  let sum: f64 = 0.0;
  for (let i: i32 = 0; i < n; i++) {
    const off = (<usize>i) << 3;
    sum += load<f64>(aPtr + off) * load<f64>(bPtr + off);
  }
  return sum;
}

/**
 * Computes the Euclidean 2-norm `sqrt(sum_{i=0}^{n-1} v[i]^2)`.
 */
export function dk_norm2(n: i32, vPtr: usize): f64 {
  let sum: f64 = 0.0;
  for (let i: i32 = 0; i < n; i++) {
    const val = load<f64>(vPtr + ((<usize>i) << 3));
    sum += val * val;
  }
  return Math.sqrt(sum);
}

/**
 * Computes `y[i] += alpha * x[i]` for `i in [0, n)`.
 */
export function dk_axpy(n: i32, alpha: f64, xPtr: usize, yPtr: usize): void {
  for (let i: i32 = 0; i < n; i++) {
    const off = (<usize>i) << 3;
    store<f64>(yPtr + off, load<f64>(yPtr + off) + alpha * load<f64>(xPtr + off));
  }
}

/**
 * Computes full CSR sparse matrix-vector product `y = A * x` for rows `0 .. n - 1`.
 */
export function dk_csr_spmv(
  n: i32,
  rowPtrPtr: usize,
  colIdxPtr: usize,
  valuesPtr: usize,
  xPtr: usize,
  yPtr: usize,
): void {
  for (let row: i32 = 0; row < n; row++) {
    const rOff = (<usize>row) << 2;
    const start = load<i32>(rowPtrPtr + rOff);
    const end = load<i32>(rowPtrPtr + rOff + 4);
    let sum: f64 = 0.0;
    for (let c: i32 = start; c < end; c++) {
      const col = load<i32>(colIdxPtr + ((<usize>c) << 2));
      sum += load<f64>(valuesPtr + ((<usize>c) << 3)) * load<f64>(xPtr + ((<usize>col) << 3));
    }
    store<f64>(yPtr + ((<usize>row) << 3), sum);
  }
}

/**
 * Computes CSR sparse matrix-vector product `y[row] = (A * x)[row]` over a subset of
 * interior rows `rows[0 .. numRows - 1]` belonging to a domain-decomposition subdomain.
 */
export function dk_csr_spmv_rows(
  numRows: i32,
  rowsPtr: usize,
  rowPtrPtr: usize,
  colIdxPtr: usize,
  valuesPtr: usize,
  xPtr: usize,
  yPtr: usize,
): void {
  for (let idx: i32 = 0; idx < numRows; idx++) {
    const row = load<i32>(rowsPtr + ((<usize>idx) << 2));
    const rOff = (<usize>row) << 2;
    const start = load<i32>(rowPtrPtr + rOff);
    const end = load<i32>(rowPtrPtr + rOff + 4);
    let sum: f64 = 0.0;
    for (let c: i32 = start; c < end; c++) {
      const col = load<i32>(colIdxPtr + ((<usize>c) << 2));
      sum += load<f64>(valuesPtr + ((<usize>c) << 3)) * load<f64>(xPtr + ((<usize>col) << 3));
    }
    store<f64>(yPtr + ((<usize>row) << 3), sum);
  }
}

/**
 * Computes dense row-major matrix-vector product `y = A * x` where `A` is `rows x cols`.
 */
export function dk_dense_matvec(
  rows: i32,
  cols: i32,
  aPtr: usize,
  xPtr: usize,
  yPtr: usize,
): void {
  for (let i: i32 = 0; i < rows; i++) {
    const rowBase = i * cols;
    let sum: f64 = 0.0;
    for (let j: i32 = 0; j < cols; j++) {
      sum += load<f64>(aPtr + ((<usize>(rowBase + j)) << 3)) * load<f64>(xPtr + ((<usize>j) << 3));
    }
    store<f64>(yPtr + ((<usize>i) << 3), sum);
  }
}

/**
 * In-place dense LU factorization with partial pivoting for an `m x m` row-major matrix
 * stored at `luPtr`. Writes pivot permutation indices `[0 .. m - 1]` to `permPtr`.
 */
export function dk_dense_lu_factor(m: i32, luPtr: usize, permPtr: usize): void {
  for (let i: i32 = 0; i < m; i++) {
    store<i32>(permPtr + ((<usize>i) << 2), i);
  }

  for (let k: i32 = 0; k < m; k++) {
    const kRow = k * m;
    let maxVal = Math.abs(load<f64>(luPtr + ((<usize>(kRow + k)) << 3)));
    let pivotRow: i32 = k;

    for (let i: i32 = k + 1; i < m; i++) {
      const v = Math.abs(load<f64>(luPtr + ((<usize>(i * m + k)) << 3)));
      if (v > maxVal) {
        maxVal = v;
        pivotRow = i;
      }
    }

    if (pivotRow != k) {
      const pRow = pivotRow * m;
      for (let j: i32 = 0; j < m; j++) {
        const offK = (<usize>(kRow + j)) << 3;
        const offP = (<usize>(pRow + j)) << 3;
        const tmp = load<f64>(luPtr + offK);
        store<f64>(luPtr + offK, load<f64>(luPtr + offP));
        store<f64>(luPtr + offP, tmp);
      }
      const pOffK = (<usize>k) << 2;
      const pOffP = (<usize>pivotRow) << 2;
      const tmpP = load<i32>(permPtr + pOffK);
      store<i32>(permPtr + pOffK, load<i32>(permPtr + pOffP));
      store<i32>(permPtr + pOffP, tmpP);
    }

    const diagOff = (<usize>(kRow + k)) << 3;
    const diag = load<f64>(luPtr + diagOff);
    const safeDiag: f64 = Math.abs(diag) < 1e-15 ? (diag >= 0.0 ? 1e-15 : -1e-15) : diag;
    store<f64>(luPtr + diagOff, safeDiag);

    for (let i: i32 = k + 1; i < m; i++) {
      const iRow = i * m;
      const factorOff = (<usize>(iRow + k)) << 3;
      const factor = load<f64>(luPtr + factorOff) / safeDiag;
      store<f64>(luPtr + factorOff, factor);
      for (let j: i32 = k + 1; j < m; j++) {
        const ijOff = (<usize>(iRow + j)) << 3;
        const kjOff = (<usize>(kRow + j)) << 3;
        store<f64>(luPtr + ijOff, load<f64>(luPtr + ijOff) - factor * load<f64>(luPtr + kjOff));
      }
    }
  }
}

/**
 * Solves `A x = rhs` using a precomputed dense LU factorization (`luPtr`, `permPtr`)
 * of dimension `m`, writing the solution into `xPtr`.
 */
export function dk_dense_lu_solve(
  m: i32,
  luPtr: usize,
  permPtr: usize,
  rhsPtr: usize,
  xPtr: usize,
): void {
  // Permute RHS and forward-substitute L y = P rhs
  for (let i: i32 = 0; i < m; i++) {
    const p = load<i32>(permPtr + ((<usize>i) << 2));
    let sum = load<f64>(rhsPtr + ((<usize>p) << 3));
    const iRow = i * m;
    for (let j: i32 = 0; j < i; j++) {
      sum -= load<f64>(luPtr + ((<usize>(iRow + j)) << 3)) * load<f64>(xPtr + ((<usize>j) << 3));
    }
    store<f64>(xPtr + ((<usize>i) << 3), sum);
  }

  // Backward-substitute U x = y
  for (let i: i32 = m - 1; i >= 0; i--) {
    let sum = load<f64>(xPtr + ((<usize>i) << 3));
    const iRow = i * m;
    for (let j: i32 = i + 1; j < m; j++) {
      sum -= load<f64>(luPtr + ((<usize>(iRow + j)) << 3)) * load<f64>(xPtr + ((<usize>j) << 3));
    }
    store<f64>(xPtr + ((<usize>i) << 3), sum / load<f64>(luPtr + ((<usize>(iRow + i)) << 3)));
  }
}

/**
 * Executes one Modified Gram-Schmidt (MGS) Arnoldi orthogonalization step for Krylov
 * column `k` in restart dimension `m`:
 * - Orthogonalizes `w` (length `n`, modified in place) against basis vectors `V[0 .. k]`
 *   stored contiguously at `vBasisPtr` (each of length `n`).
 * - Writes column `k` entries `H[0 .. k + 1, k]` into row-major `(m + 1) x m` Hessenberg
 *   matrix `hPtr`.
 * - Normalizes `w` into `V[k + 1]` (or zeroes `V[k + 1]` on happy breakdown `hNext <= 1e-15`).
 *
 * Returns `hNext = ||w||_2`.
 */
export function dk_mgs_arnoldi_step(
  n: i32,
  k: i32,
  m: i32,
  vBasisPtr: usize,
  wPtr: usize,
  hPtr: usize,
): f64 {
  for (let i: i32 = 0; i <= k; i++) {
    const viPtr = vBasisPtr + ((<usize>(i * n)) << 3);
    const hij = dk_dot(n, wPtr, viPtr);
    store<f64>(hPtr + ((<usize>(i * m + k)) << 3), hij);
    dk_axpy(n, -hij, viPtr, wPtr);
  }

  const hNext = dk_norm2(n, wPtr);
  store<f64>(hPtr + ((<usize>((k + 1) * m + k)) << 3), hNext);

  const vNextPtr = vBasisPtr + ((<usize>((k + 1) * n)) << 3);
  if (hNext > 1e-15) {
    const invH = 1.0 / hNext;
    for (let j: i32 = 0; j < n; j++) {
      const off = (<usize>j) << 3;
      store<f64>(vNextPtr + off, load<f64>(wPtr + off) * invH);
    }
  } else {
    memory.fill(vNextPtr, 0, (<usize>n) << 3);
  }

  return hNext;
}

/**
 * Applies previous Givens rotations `0 .. k - 1` to column `k` of the `(m + 1) x m`
 * row-major Hessenberg matrix `H`, computes and stores the new rotation `(cs[k], sn[k])`
 * eliminating `H[k + 1, k]`, and updates the rotated RHS vector `g[k], g[k + 1]`.
 *
 * Returns the updated GMRES residual norm `|g[k + 1]|`.
 */
export function dk_gmres_givens_step(
  k: i32,
  m: i32,
  hPtr: usize,
  csPtr: usize,
  snPtr: usize,
  gPtr: usize,
): f64 {
  for (let i: i32 = 0; i < k; i++) {
    const c = load<f64>(csPtr + ((<usize>i) << 3));
    const s = load<f64>(snPtr + ((<usize>i) << 3));
    const hiOff = (<usize>(i * m + k)) << 3;
    const hi1Off = (<usize>((i + 1) * m + k)) << 3;
    const hi = load<f64>(hPtr + hiOff);
    const hi1 = load<f64>(hPtr + hi1Off);
    store<f64>(hPtr + hiOff, c * hi + s * hi1);
    store<f64>(hPtr + hi1Off, -s * hi + c * hi1);
  }

  const hkOff = (<usize>(k * m + k)) << 3;
  const hk1Off = (<usize>((k + 1) * m + k)) << 3;
  const a = load<f64>(hPtr + hkOff);
  const bVal = load<f64>(hPtr + hk1Off);
  const rho = Math.hypot(a, bVal);
  const c: f64 = rho > 0.0 ? a / rho : 1.0;
  const s: f64 = rho > 0.0 ? bVal / rho : 0.0;

  const kOff = (<usize>k) << 3;
  store<f64>(csPtr + kOff, c);
  store<f64>(snPtr + kOff, s);

  store<f64>(hPtr + hkOff, c * a + s * bVal);
  store<f64>(hPtr + hk1Off, 0.0);

  const gk = load<f64>(gPtr + kOff);
  const gk1 = -s * gk;
  store<f64>(gPtr + kOff, c * gk);
  store<f64>(gPtr + ((<usize>(k + 1)) << 3), gk1);

  return Math.abs(gk1);
}

/**
 * Solves the `k x k` upper-triangular system `H[0 .. k - 1, 0 .. k - 1] * y = g[0 .. k - 1]`
 * where `H` is stored row-major with row stride `m`.
 */
export function dk_gmres_back_sub(
  k: i32,
  m: i32,
  hPtr: usize,
  gPtr: usize,
  yPtr: usize,
): void {
  for (let i: i32 = k - 1; i >= 0; i--) {
    let sum = load<f64>(gPtr + ((<usize>i) << 3));
    const iRow = i * m;
    for (let j: i32 = i + 1; j < k; j++) {
      sum -= load<f64>(hPtr + ((<usize>(iRow + j)) << 3)) * load<f64>(yPtr + ((<usize>j) << 3));
    }
    const diag = load<f64>(hPtr + ((<usize>(iRow + i)) << 3));
    store<f64>(yPtr + ((<usize>i) << 3), Math.abs(diag) > 1e-15 ? sum / diag : 0.0);
  }
}

/**
 * Accumulates the right-preconditioned GMRES solution update
 * `x += sum_{i=0}^{k-1} y[i] * Z[i]` where `Z` is stored contiguously as `k` vectors
 * of length `n` at `zBasisPtr`.
 */
export function dk_gmres_update_solution(
  n: i32,
  k: i32,
  zBasisPtr: usize,
  yPtr: usize,
  xPtr: usize,
): void {
  for (let i: i32 = 0; i < k; i++) {
    const yi = load<f64>(yPtr + ((<usize>i) << 3));
    const ziPtr = zBasisPtr + ((<usize>(i * n)) << 3);
    dk_axpy(n, yi, ziPtr, xPtr);
  }
}
