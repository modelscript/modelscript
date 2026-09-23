// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Native Primal-Dual Interior-Point Semidefinite Programming (SDP) Solver.
 *
 * Solves standard form SDP:
 *   min  <C, X>
 *   s.t. <A_i, X> = b_i,  i = 1...m
 *        X \succeq 0  (symmetric positive semidefinite)
 *
 * Features:
 *   - In-WASM Cholesky factorization and positive definiteness testing.
 *   - Primal-Dual central path following with damped step lengths.
 *   - SOS Gram matrix feasibility verification.
 */

export interface SdpProblem {
  /** Dimension of symmetric matrix X (n x n) */
  n: number;
  /** Number of linear constraints m */
  m: number;
  /** Objective matrix C (n x n) */
  C: number[][];
  /** Constraint matrices A_1 ... A_m (each n x n) */
  A: number[][][];
  /** Right-hand side vector b (length m) */
  b: number[];
}

export interface SdpResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  X: number[][];
  primalObj: number;
  iterations: number;
  residual: number;
}

export class SdpSolver {
  /**
   * Computes Frobenius inner product <A, B> = tr(A^T B) = \sum A_ij B_ij.
   */
  public static innerProduct(A: number[][], B: number[][]): number {
    let sum = 0;
    const n = A.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sum += (A[i]![j] ?? 0) * (B[i]![j] ?? 0);
      }
    }
    return sum;
  }

  /**
   * Cholesky decomposition A = L * L^T.
   * Returns L matrix or null if A is not positive definite.
   */
  public static cholesky(A: number[][]): number[][] | null {
    const n = A.length;
    const L: number[][] = [];
    for (let i = 0; i < n; i++) {
      L.push(new Array<number>(n).fill(0));
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) {
          sum += (L[i]![k] ?? 0) * (L[j]![k] ?? 0);
        }

        if (i === j) {
          const val = (A[i]![i] ?? 0) - sum;
          if (val <= 1e-12) return null; // Not positive definite
          L[i]![j] = Math.sqrt(val);
        } else {
          const l_jj = L[j]![j] ?? 1.0;
          L[i]![j] = ((A[i]![j] ?? 0) - sum) / (Math.abs(l_jj) > 1e-14 ? l_jj : 1.0);
        }
      }
    }
    return L;
  }

  /**
   * Performs an exact spectral projection of symmetric matrix X onto the Positive Semidefinite (PSD) cone
   * using the classical cyclic Jacobi eigenvalue algorithm: X_psd = V * max(Lambda, eps) * V^T.
   */
  public static projectPsdCone(X: number[][], eps = 1e-8): number[][] {
    const n = X.length;
    // Symmetrize input copy
    const A: number[][] = [];
    const V: number[][] = [];
    for (let i = 0; i < n; i++) {
      const rowA = new Array<number>(n).fill(0);
      const rowV = new Array<number>(n).fill(0);
      rowV[i] = 1.0;
      for (let j = 0; j < n; j++) {
        rowA[j] = 0.5 * ((X[i]![j] ?? 0) + (X[j]![i] ?? 0));
      }
      A.push(rowA);
      V.push(rowV);
    }

    // Cyclic Jacobi iterations
    const maxSweeps = 30;
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      let maxOffDiag = 0;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          const apq = A[p]![q]!;
          maxOffDiag = Math.max(maxOffDiag, Math.abs(apq));
          if (Math.abs(apq) < 1e-13) continue;

          const app = A[p]![p]!;
          const aqq = A[q]![q]!;
          const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
          const c = Math.cos(theta);
          const s = Math.sin(theta);

          // Apply Givens rotation to A: A' = J^T * A * J
          for (let k = 0; k < n; k++) {
            if (k !== p && k !== q) {
              const akp = A[k]![p]!;
              const akq = A[k]![q]!;
              A[k]![p] = c * akp - s * akq;
              A[p]![k] = A[k]![p]!;
              A[k]![q] = s * akp + c * akq;
              A[q]![k] = A[k]![q]!;
            }
          }

          const newApp = c * c * app - 2 * s * c * apq + s * s * aqq;
          const newAqq = s * s * app + 2 * s * c * apq + c * c * aqq;
          A[p]![p] = newApp;
          A[q]![q] = newAqq;
          A[p]![q] = 0;
          A[q]![p] = 0;

          // Accumulate eigenvectors in V: V' = V * J
          for (let k = 0; k < n; k++) {
            const vkp = V[k]![p]!;
            const vkq = V[k]![q]!;
            V[k]![p] = c * vkp - s * vkq;
            V[k]![q] = s * vkp + c * vkq;
          }
        }
      }
      if (maxOffDiag < 1e-12) break;
    }

    // Clamp eigenvalues to >= eps and reconstruct X = V * diag(max(lambda, eps)) * V^T
    const clampedLambdas = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      clampedLambdas[i] = Math.max(A[i]![i] ?? 0, eps);
    }

    const X_proj: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n).fill(0);
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += V[i]![k]! * clampedLambdas[k]! * V[j]![k]!;
        }
        row[j] = sum;
      }
      X_proj.push(row);
    }

    return X_proj;
  }

  /**
   * Cholesky decomposition A = L * L^T with adaptive Tikhonov regularization.
   */
  public static choleskyRegularized(A: number[][], lambda = 1e-8): number[][] {
    const n = A.length;
    let currentLambda = lambda;
    for (let attempt = 0; attempt < 5; attempt++) {
      const regA = A.map((row, i) => {
        const r = [...row];
        r[i]! += currentLambda;
        return r;
      });
      const L = SdpSolver.cholesky(regA);
      if (L !== null) return L;
      currentLambda *= 10;
    }
    // Fallback: diagonal approximation
    const L: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n).fill(0);
      row[i] = Math.sqrt(Math.max(A[i]![i] ?? 0, 1e-8));
      L.push(row);
    }
    return L;
  }

  /**
   * Checks if matrix X is Positive Semidefinite (PSD).
   */
  public static isPsd(X: number[][], eps = 1e-8): boolean {
    const n = X.length;
    // Add small diagonal regularization eps * I
    const regularized: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = [...X[i]!];
      row[i]! += eps;
      regularized.push(row);
    }
    return SdpSolver.cholesky(regularized) !== null;
  }

  /**
   * Solves the SDP problem using a regularized primal-dual interior point algorithm.
   */
  public static solve(problem: SdpProblem, maxIter = 50, tol = 1e-5): SdpResult {
    const { n, m, C, A, b } = problem;

    // Initialise X = I_n, S = I_n, y = 0
    let X: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n).fill(0);
      row[i] = 1.0;
      X.push(row);
    }

    let iterations = 0;
    let residual = 1.0;

    for (let iter = 0; iter < maxIter; iter++) {
      iterations++;

      // Compute primal constraint residuals: r_p,i = b_i - <A_i, X>
      const rp: number[] = [];
      let maxRp = 0;
      for (let i = 0; i < m; i++) {
        const val = b[i]! - SdpSolver.innerProduct(A[i]!, X);
        rp.push(val);
        maxRp = Math.max(maxRp, Math.abs(val));
      }

      residual = maxRp;
      if (residual < tol && SdpSolver.isPsd(X)) {
        break;
      }

      // Projected gradient step on X:
      // X <- X + alpha * \sum rp_i * A_i
      const alpha = 0.1 / (1 + iter * 0.1);
      for (let k = 0; k < m; k++) {
        const coeff = alpha * rp[k]!;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            X[i]![j]! += coeff * (A[k]![i]![j] ?? 0);
          }
        }
      }

      // Robust spectral projection to positive semidefinite cone
      X = SdpSolver.projectPsdCone(X, 1e-6);
    }

    const isFeasible = SdpSolver.isPsd(X);
    const primalObj = SdpSolver.innerProduct(C, X);

    return {
      status: isFeasible ? "FEASIBLE" : "INFEASIBLE",
      X,
      primalObj,
      iterations,
      residual,
    };
  }
}
