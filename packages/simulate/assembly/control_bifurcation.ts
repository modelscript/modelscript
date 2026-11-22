// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Control Synthesis & Bifurcation Continuation Kernels:
 * - Continuous-Time Lyapunov Solver: A^T X + X A + Q = 0
 * - Continuous-Time Algebraic Riccati Equation (CARE) Newton-Kleinman Solver + LQR Gain K = R^-1 B^T P
 * - Bordered Pseudo-Arclength Continuation (PALC) Newton Corrector Linear Solver
 */

function solveDense(aPtr: usize, bPtr: usize, n: i32, outXPtr: usize): bool {
  for (let k: i32 = 0; k < n; k++) {
    let pivotRow = k;
    let pivotVal = Math.abs(load<f64>(aPtr + (<usize>(k * n + k) << 3)));
    for (let i: i32 = k + 1; i < n; i++) {
      const v = Math.abs(load<f64>(aPtr + (<usize>(i * n + k) << 3)));
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = i;
      }
    }
    if (pivotVal < 1e-14) return false;
    if (pivotRow != k) {
      for (let j: i32 = k; j < n; j++) {
        const o1 = aPtr + (<usize>(k * n + j) << 3);
        const o2 = aPtr + (<usize>(pivotRow * n + j) << 3);
        const tmp = load<f64>(o1);
        store<f64>(o1, load<f64>(o2));
        store<f64>(o2, tmp);
      }
      const r1 = bPtr + (<usize>k << 3);
      const r2 = bPtr + (<usize>pivotRow << 3);
      const tr = load<f64>(r1);
      store<f64>(r1, load<f64>(r2));
      store<f64>(r2, tr);
    }

    const diag = load<f64>(aPtr + (<usize>(k * n + k) << 3));
    for (let i: i32 = k + 1; i < n; i++) {
      const factor = load<f64>(aPtr + (<usize>(i * n + k) << 3)) / diag;
      store<f64>(aPtr + (<usize>(i * n + k) << 3), 0.0);
      for (let j: i32 = k + 1; j < n; j++) {
        const oij = aPtr + (<usize>(i * n + j) << 3);
        store<f64>(oij, load<f64>(oij) - factor * load<f64>(aPtr + (<usize>(k * n + j) << 3)));
      }
      const ri = bPtr + (<usize>i << 3);
      store<f64>(ri, load<f64>(ri) - factor * load<f64>(bPtr + (<usize>k << 3)));
    }
  }

  for (let i: i32 = n - 1; i >= 0; i--) {
    let sum = load<f64>(bPtr + (<usize>i << 3));
    for (let j: i32 = i + 1; j < n; j++) {
      sum -= load<f64>(aPtr + (<usize>(i * n + j) << 3)) * load<f64>(outXPtr + (<usize>j << 3));
    }
    store<f64>(outXPtr + (<usize>i << 3), sum / load<f64>(aPtr + (<usize>(i * n + i) << 3)));
  }
  return true;
}

/**
 * Solves the Continuous-Time Lyapunov Equation: A^T X + X A + Q = 0
 * via Kronecker vectorization (I ⊗ A^T + A^T ⊗ I) vec(X) = -vec(Q).
 * Returns 1 on success, 0 if singular.
 */
export function ctrl_lyapunovSolve(aPtr: usize, qPtr: usize, n: i32, outXPtr: usize): i32 {
  const nn = n * n;
  if (n <= 0) return 0;

  const kronPtr = heap.alloc(<usize>(nn * nn) << 3);
  const rhsPtr = heap.alloc(<usize>nn << 3);
  memory.fill(kronPtr, 0, <usize>(nn * nn) << 3);

  // For row (i, j): sum_k A[k, i] * X[k, j] + sum_k X[i, k] * A[k, j] = -Q[i, j]
  for (let i: i32 = 0; i < n; i++) {
    for (let j: i32 = 0; j < n; j++) {
      const row = i * n + j;
      store<f64>(rhsPtr + (<usize>row << 3), -load<f64>(qPtr + (<usize>row << 3)));
      for (let k: i32 = 0; k < n; k++) {
        // A^T[i, k] = A[k, i] multiplies X[k, j]
        const col1 = k * n + j;
        const o1 = kronPtr + (<usize>(row * nn + col1) << 3);
        store<f64>(o1, load<f64>(o1) + load<f64>(aPtr + (<usize>(k * n + i) << 3)));

        // A[k, j] multiplies X[i, k]
        const col2 = i * n + k;
        const o2 = kronPtr + (<usize>(row * nn + col2) << 3);
        store<f64>(o2, load<f64>(o2) + load<f64>(aPtr + (<usize>(k * n + j) << 3)));
      }
    }
  }

  const ok = solveDense(kronPtr, rhsPtr, nn, outXPtr);
  heap.free(kronPtr);
  heap.free(rhsPtr);
  return ok ? 1 : 0;
}

/**
 * Solves Continuous-Time Algebraic Riccati Equation (CARE):
 *   A^T P + P A - P B R^-1 B^T P + Q = 0
 * and computes optimal LQR state-feedback gain K = R^-1 B^T P (m x n)
 * using Newton-Kleinman iteration starting from a stabilizing initial gain K0 (in outKPtr).
 * Returns iterations taken (> 0) if converged, or -1 on failure.
 */
export function ctrl_careNewton(
  aPtr: usize,
  bPtr: usize,
  qPtr: usize,
  rPtr: usize,
  n: i32,
  m: i32,
  maxIter: i32,
  tol: f64,
  outPPtr: usize,
  outKPtr: usize,
): i32 {
  if (n <= 0 || m <= 0) return -1;

  // Invert R (m x m)
  const rInvPtr = heap.alloc(<usize>(m * m) << 3);
  const rWork = heap.alloc(<usize>(m * m) << 3);
  const rRhs = heap.alloc(<usize>m << 3);
  const rCol = heap.alloc(<usize>m << 3);
  for (let c: i32 = 0; c < m; c++) {
    memory.copy(rWork, rPtr, <usize>(m * m) << 3);
    memory.fill(rRhs, 0, <usize>m << 3);
    store<f64>(rRhs + (<usize>c << 3), 1.0);
    if (!solveDense(rWork, rRhs, m, rCol)) {
      heap.free(rInvPtr);
      heap.free(rWork);
      heap.free(rRhs);
      heap.free(rCol);
      return -1;
    }
    for (let r: i32 = 0; r < m; r++) {
      store<f64>(rInvPtr + (<usize>(r * m + c) << 3), load<f64>(rCol + (<usize>r << 3)));
    }
  }
  heap.free(rWork);
  heap.free(rRhs);
  heap.free(rCol);

  const aClPtr = heap.alloc(<usize>(n * n) << 3);
  const qEffPtr = heap.alloc(<usize>(n * n) << 3);
  const pPrevPtr = heap.alloc(<usize>(n * n) << 3);
  const btPPtr = heap.alloc(<usize>(m * n) << 3);
  memory.fill(pPrevPtr, 0, <usize>(n * n) << 3);

  let convergedIter: i32 = -1;

  for (let iter: i32 = 1; iter <= maxIter; iter++) {
    // A_cl = A - B * K
    for (let i: i32 = 0; i < n; i++) {
      for (let j: i32 = 0; j < n; j++) {
        let val = load<f64>(aPtr + (<usize>(i * n + j) << 3));
        for (let l: i32 = 0; l < m; l++) {
          val -= load<f64>(bPtr + (<usize>(i * m + l) << 3)) * load<f64>(outKPtr + (<usize>(l * n + j) << 3));
        }
        store<f64>(aClPtr + (<usize>(i * n + j) << 3), val);
      }
    }

    // Q_eff = Q + K^T R K
    for (let i: i32 = 0; i < n; i++) {
      for (let j: i32 = 0; j < n; j++) {
        let val = load<f64>(qPtr + (<usize>(i * n + j) << 3));
        for (let a: i32 = 0; a < m; a++) {
          const kai = load<f64>(outKPtr + (<usize>(a * n + i) << 3));
          for (let b: i32 = 0; b < m; b++) {
            val += kai * load<f64>(rPtr + (<usize>(a * m + b) << 3)) * load<f64>(outKPtr + (<usize>(b * n + j) << 3));
          }
        }
        store<f64>(qEffPtr + (<usize>(i * n + j) << 3), val);
      }
    }

    // Solve A_cl^T P + P A_cl + Q_eff = 0
    if (ctrl_lyapunovSolve(aClPtr, qEffPtr, n, outPPtr) == 0) break;

    // Update K = R^-1 B^T P
    for (let l: i32 = 0; l < m; l++) {
      for (let j: i32 = 0; j < n; j++) {
        let sum: f64 = 0.0;
        for (let k: i32 = 0; k < n; k++) {
          sum += load<f64>(bPtr + (<usize>(k * m + l) << 3)) * load<f64>(outPPtr + (<usize>(k * n + j) << 3));
        }
        store<f64>(btPPtr + (<usize>(l * n + j) << 3), sum);
      }
    }
    for (let l: i32 = 0; l < m; l++) {
      for (let j: i32 = 0; j < n; j++) {
        let sum: f64 = 0.0;
        for (let k: i32 = 0; k < m; k++) {
          sum += load<f64>(rInvPtr + (<usize>(l * m + k) << 3)) * load<f64>(btPPtr + (<usize>(k * n + j) << 3));
        }
        store<f64>(outKPtr + (<usize>(l * n + j) << 3), sum);
      }
    }

    // Check ||P - P_prev||_inf
    let maxDiff: f64 = 0.0;
    for (let i: i32 = 0; i < n * n; i++) {
      const pCur = load<f64>(outPPtr + (<usize>i << 3));
      const d = Math.abs(pCur - load<f64>(pPrevPtr + (<usize>i << 3)));
      if (d > maxDiff) maxDiff = d;
      store<f64>(pPrevPtr + (<usize>i << 3), pCur);
    }

    if (maxDiff < tol) {
      convergedIter = iter;
      break;
    }
  }

  heap.free(rInvPtr);
  heap.free(aClPtr);
  heap.free(qEffPtr);
  heap.free(pPrevPtr);
  heap.free(btPPtr);
  return convergedIter;
}

/**
 * Pseudo-Arclength Continuation (PALC) bordered Newton corrector step:
 * Solves [[F_x, F_lambda], [t_x^T, t_lambda]] * [dx; dLambda] = -[F; arcRes].
 * Writes [dx (n), dLambda (1)] into `outSolPtr` (n + 1 f64s).
 */
export function palc_borderedSolve(
  jacPtr: usize,
  dfdLambdaPtr: usize,
  txPtr: usize,
  tLambda: f64,
  resPtr: usize,
  arcRes: f64,
  n: i32,
  outSolPtr: usize,
): i32 {
  const dim = n + 1;
  const matPtr = heap.alloc(<usize>(dim * dim) << 3);
  const rhsPtr = heap.alloc(<usize>dim << 3);

  for (let i: i32 = 0; i < n; i++) {
    for (let j: i32 = 0; j < n; j++) {
      store<f64>(matPtr + (<usize>(i * dim + j) << 3), load<f64>(jacPtr + (<usize>(i * n + j) << 3)));
    }
    store<f64>(matPtr + (<usize>(i * dim + n) << 3), load<f64>(dfdLambdaPtr + (<usize>i << 3)));
    store<f64>(rhsPtr + (<usize>i << 3), -load<f64>(resPtr + (<usize>i << 3)));
  }

  for (let j: i32 = 0; j < n; j++) {
    store<f64>(matPtr + (<usize>(n * dim + j) << 3), load<f64>(txPtr + (<usize>j << 3)));
  }
  store<f64>(matPtr + (<usize>(n * dim + n) << 3), tLambda);
  store<f64>(rhsPtr + (<usize>n << 3), -arcRes);

  const ok = solveDense(matPtr, rhsPtr, dim, outSolPtr);
  heap.free(matPtr);
  heap.free(rhsPtr);
  return ok ? 1 : 0;
}
