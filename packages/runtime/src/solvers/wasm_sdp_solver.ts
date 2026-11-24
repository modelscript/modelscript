// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Native Primal-Dual Interior-Point Semidefinite Programming (SDP) Solver.
 *
 * Solves standard form SDP:
 *   min  <C, X>
 *   s.t. <A_i, X> = b_i,  i = 1...m
 *        X \succeq 0  (symmetric positive semidefinite)
 *
 * Academic Citations:
 *   - Vandenberghe, L., & Boyd, S. (1996). "Semidefinite Programming."
 *     SIAM Review, 38(1), pp. 49–95. DOI: 10.1137/1038003.
 *   - Helmberg, C., Rendl, F., Vanderbei, R. J., & Wolkowicz, H. (1996).
 *     "An interior-point method for semidefinite programming."
 *     SIAM Journal on Optimization, 6(2), pp. 342–361. DOI: 10.1137/0806018.
 *   - Alizadeh, F., Haeberly, J. P. A., & Overton, M. L. (1998). "Primal-dual interior-point methods
 *     for semidefinite programming: convergence rates, stability and numerical results."
 *     SIAM Journal on Optimization, 8(3), pp. 746–768. DOI: 10.1137/S105262349528701X.
 *   - Parrilo, P. A. (2003). "Semidefinite programming relaxations for semialgebraic problems."
 *     Mathematical Programming, 96(2), pp. 293–320. DOI: 10.1007/s10107-003-0387-5. (SOS Programming)
 *
 * ModelScript Architectural Rationale:
 *   Continuous safety verification of non-linear physical models requires certifying that state
 *   trajectories never breach safety envelopes. Synthesizing polynomial Lyapunov functions and
 *   barrier certificates reduces to Sum-of-Squares (SOS) polynomial decompositions. By casting
 *   SOS constraints into semidefinite programs over positive semidefinite Gram matrices, SdpSolver
 *   provides formal safety certificates natively in the browser and CLI without relying on external
 *   monolithic solvers like Mosek or SeDuMi.
 *
 * Modifications:
 *   - Standalone in-process interior-point solver with zero external C/Fortran shared library dependencies.
 *   - In-WASM Cholesky factorization and Sylvester criterion positive definiteness testing.
 *   - Primal-Dual central path following with damped backtracking step lengths.
 *   - Direct extraction of Gram matrix SOS witness certificates for Nelson-Oppen theory propagation.
 */

import { WasmScratchPool } from "@modelscript/solve";
import { getDefaultWasmExports } from "../dae/wasm_dae.js";

const _sdpScratchPools = new WeakMap<object, WasmScratchPool>();
function getSdpPool(wasm: any): WasmScratchPool {
  let pool = _sdpScratchPools.get(wasm);
  if (!pool) {
    pool = new WasmScratchPool(wasm, 65536);
    _sdpScratchPools.set(wasm, pool);
  }
  return pool;
}

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
  /** Dual multiplier vector y (length m). */
  dualY?: number[] | undefined;
  /** Dual slack matrix S = C - sum(y_i A_i) >= 0. */
  dualS?: number[][] | undefined;
  /** Complementarity / duality gap <X, S>. */
  dualityGap?: number | undefined;
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
   * Cholesky decomposition A = L * L^T via AssemblyScript `sdp_cholesky`.
   * Returns L matrix or null if A is not positive definite.
   */
  public static cholesky(A: number[][]): number[][] | null {
    const n = A.length;
    if (n === 0) return [];

    const wasm = getDefaultWasmExports();
    if (wasm && typeof wasm.sdp_cholesky === "function" && typeof wasm.__new === "function") {
      const scope = getSdpPool(wasm).scope();
      try {
        const aSlice = scope.allocF64(n * n);
        const lSlice = scope.allocF64(n * n);
        const aView = aSlice.view();
        for (let i = 0; i < n; i++) {
          const row = A[i];
          const off = i * n;
          for (let j = 0; j < n; j++) aView[off + j] = row?.[j] ?? 0;
        }
        const ok: number = wasm.sdp_cholesky(n, aSlice.ptr, lSlice.ptr);
        if (ok !== 1) return null;
        const lView = lSlice.view();
        const L: number[][] = new Array(n);
        for (let i = 0; i < n; i++) {
          const off = i * n;
          L[i] = Array.from(lView.subarray(off, off + n));
        }
        return L;
      } finally {
        scope.dispose();
      }
    }

    const L: number[][] = [];
    for (let i = 0; i < n; i++) L.push(new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) sum += (L[i]![k] ?? 0) * (L[j]![k] ?? 0);
        if (i === j) {
          const val = (A[i]![i] ?? 0) - sum;
          if (val <= 1e-12) return null;
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
    const wasm = getDefaultWasmExports();
    if (wasm && typeof wasm.sdp_project_psd_cone === "function" && typeof wasm.__new === "function" && n > 0) {
      const scope = getSdpPool(wasm).scope();
      try {
        const xSlice = scope.allocF64(n * n);
        const outSlice = scope.allocF64(n * n);
        const xView = xSlice.view();
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            xView[i * n + j] = X[i]?.[j] ?? 0;
          }
        }
        wasm.sdp_project_psd_cone(n, xSlice.ptr, eps, outSlice.ptr);
        const outView = outSlice.view();
        const X_proj: number[][] = [];
        for (let i = 0; i < n; i++) {
          const row = new Array<number>(n);
          for (let j = 0; j < n; j++) {
            row[j] = outView[i * n + j]!;
          }
          X_proj.push(row);
        }
        return X_proj;
      } finally {
        scope.dispose();
      }
    }

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
   * Checks if symmetric matrix X is Positive Semidefinite (PSD).
   */
  public static isPsd(X: number[][], eps = 0): boolean {
    const n = X.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs((X[i]?.[j] ?? 0) - (X[j]?.[i] ?? 0)) > 1e-8) return false;
      }
    }
    if (eps === 0) {
      return SdpSolver.cholesky(X) !== null;
    }
    const regularized: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = [...X[i]!];
      row[i]! += eps;
      regularized.push(row);
    }
    return SdpSolver.cholesky(regularized) !== null;
  }

  private static invertFromCholesky(L: number[][]): number[][] {
    const n = L.length;
    const invL: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      invL[i]![i] = 1.0 / L[i]![i]!;
      for (let j = 0; j < i; j++) {
        let sum = 0;
        for (let k = j; k < i; k++) sum += L[i]![k]! * invL[k]![j]!;
        invL[i]![j] = -sum / L[i]![i]!;
      }
    }
    const invS: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        let sum = 0;
        for (let k = j; k < n; k++) sum += invL[k]![i]! * invL[k]![j]!;
        invS[i]![j] = sum;
        invS[j]![i] = sum;
      }
    }
    return invS;
  }

  private static matMul(A: number[][], B: number[][]): number[][] {
    const n = A.length;
    const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      const Ai = A[i]!;
      const Oi = out[i]!;
      for (let k = 0; k < n; k++) {
        const aik = Ai[k]!;
        if (aik === 0) continue;
        const Bk = B[k]!;
        for (let j = 0; j < n; j++) Oi[j]! += aik * Bk[j]!;
      }
    }
    return out;
  }

  private static solveLinearSystem(M: number[][], rhs: number[]): number[] | null {
    const m = rhs.length;
    if (m === 0) return [];
    const A = M.map((row) => [...row]);
    const b = [...rhs];
    for (let k = 0; k < m; k++) {
      let maxVal = Math.abs(A[k]![k]!);
      let piv = k;
      for (let i = k + 1; i < m; i++) {
        const v = Math.abs(A[i]![k]!);
        if (v > maxVal) {
          maxVal = v;
          piv = i;
        }
      }
      if (maxVal < 1e-14) return null;
      if (piv !== k) {
        const tmpRow = A[k]!;
        A[k] = A[piv]!;
        A[piv] = tmpRow;
        const tmpB = b[k]!;
        b[k] = b[piv]!;
        b[piv] = tmpB;
      }
      const diag = A[k]![k]!;
      for (let i = k + 1; i < m; i++) {
        const f = A[i]![k]! / diag;
        if (f === 0) continue;
        for (let j = k + 1; j < m; j++) A[i]![j]! -= f * A[k]![j]!;
        b[i]! -= f * b[k]!;
      }
    }
    const x = new Array<number>(m).fill(0);
    for (let i = m - 1; i >= 0; i--) {
      let sum = b[i]!;
      for (let j = i + 1; j < m; j++) sum -= A[i]![j]! * x[j]!;
      x[i] = sum / A[i]![i]!;
    }
    return x;
  }

  private static maxPdStep(M: number[][], dM: number[][]): number {
    let alpha = 1.0;
    const n = M.length;
    const trial: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let back = 0; back < 40; back++) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          trial[i]![j] = M[i]![j]! + alpha * dM[i]![j]!;
        }
      }
      if (SdpSolver.cholesky(trial) !== null) return alpha;
      alpha *= 0.5;
    }
    return 0;
  }

  /**
   * Solves standard-form SDP using a Primal-Dual Interior-Point Method
   * (Helmberg-Rendl-Vanderbei-Wolkowicz / KSH Schur-complement KKT Newton).
   */
  public static solve(problem: SdpProblem, maxIter = 50, tol = 1e-5): SdpResult {
    const { n, m, C, A, b } = problem;
    if (n === 0) {
      return {
        status: "OPTIMAL",
        X: [],
        primalObj: 0,
        iterations: 0,
        residual: 0,
        dualY: [],
        dualS: [],
        dualityGap: 0,
      };
    }

    const wasm = getDefaultWasmExports();
    if (wasm && typeof wasm.sdp_solveAdmmWasm === "function" && typeof wasm.__new === "function") {
      const scope = getSdpPool(wasm).scope();
      try {
        const nn = n * n;
        const cSlice = scope.allocF64(nn);
        const aSlice = scope.allocF64(Math.max(1, m * nn));
        const bSlice = scope.allocF64(Math.max(1, m));
        const xOutSlice = scope.allocF64(nn);
        const yOutSlice = scope.allocF64(Math.max(1, m));
        const sOutSlice = scope.allocF64(nn);
        const statsOutSlice = scope.allocF64(4);

        const cView = cSlice.view();
        for (let i = 0; i < n; i++) {
          const row = C[i];
          const off = i * n;
          for (let j = 0; j < n; j++) cView[off + j] = row?.[j] ?? 0;
        }
        const aView = aSlice.view();
        for (let k = 0; k < m; k++) {
          const Ak = A[k];
          const kOff = k * nn;
          for (let i = 0; i < n; i++) {
            const row = Ak?.[i];
            const off = kOff + i * n;
            for (let j = 0; j < n; j++) aView[off + j] = row?.[j] ?? 0;
          }
        }
        const bView = bSlice.view();
        for (let i = 0; i < m; i++) bView[i] = b[i] ?? 0;

        const statusCode: number = wasm.sdp_solveAdmmWasm(
          n,
          m,
          cSlice.ptr,
          aSlice.ptr,
          bSlice.ptr,
          maxIter,
          tol,
          xOutSlice.ptr,
          yOutSlice.ptr,
          sOutSlice.ptr,
          statsOutSlice.ptr,
        );

        const xView = xOutSlice.view();
        const yView = yOutSlice.view();
        const sView = sOutSlice.view();
        const statsView = statsOutSlice.view();

        const X: number[][] = new Array(n);
        const S: number[][] = new Array(n);
        for (let i = 0; i < n; i++) {
          const off = i * n;
          X[i] = Array.from(xView.subarray(off, off + n));
          S[i] = Array.from(sView.subarray(off, off + n));
        }
        const dualY: number[] = m > 0 ? Array.from(yView.subarray(0, m)) : [];
        const status: SdpResult["status"] = statusCode === 2 ? "OPTIMAL" : statusCode === 1 ? "FEASIBLE" : "INFEASIBLE";

        return {
          status,
          X,
          primalObj: statsView[0]!,
          iterations: statsView[1]!,
          residual: statsView[2]!,
          dualY,
          dualS: S,
          dualityGap: statsView[3]!,
        };
      } finally {
        scope.dispose();
      }
    }

    const Csym: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => 0.5 * ((C[i]?.[j] ?? 0) + (C[j]?.[i] ?? 0))),
    );
    const Asym: number[][][] = A.map((Ak) =>
      Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => 0.5 * ((Ak[i]?.[j] ?? 0) + (Ak[j]?.[i] ?? 0))),
      ),
    );

    let scale = 1.0;
    for (let i = 0; i < m; i++) scale = Math.max(scale, Math.abs(b[i] ?? 0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) scale = Math.max(scale, Math.abs(Csym[i]![j]!));
    }
    const initDiag = Math.max(1.0, Math.sqrt(scale));

    let X: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? initDiag : 0)),
    );
    let S: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? initDiag : 0)),
    );
    const y: number[] = new Array<number>(m).fill(0);

    let iterations = 0;
    let primalRes = Infinity;
    let dualRes = Infinity;
    let gap = SdpSolver.innerProduct(X, S);

    for (let iter = 0; iter < maxIter; iter++) {
      iterations++;

      const rp = new Array<number>(m);
      primalRes = 0;
      for (let i = 0; i < m; i++) {
        const val = (b[i] ?? 0) - SdpSolver.innerProduct(Asym[i]!, X);
        rp[i] = val;
        primalRes = Math.max(primalRes, Math.abs(val));
      }

      const Rd: number[][] = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => Csym[i]![j]! - S[i]![j]!),
      );
      for (let k = 0; k < m; k++) {
        const yk = y[k]!;
        if (yk === 0) continue;
        const Ak = Asym[k]!;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) Rd[i]![j]! -= yk * Ak[i]![j]!;
        }
      }
      dualRes = Math.sqrt(Math.max(0, SdpSolver.innerProduct(Rd, Rd)));

      gap = Math.max(0, SdpSolver.innerProduct(X, S));
      const mu = gap / n;

      if (primalRes < tol && dualRes < tol && gap < tol * Math.max(1, n)) {
        return {
          status: "OPTIMAL",
          X,
          primalObj: SdpSolver.innerProduct(Csym, X),
          iterations,
          residual: primalRes,
          dualY: y,
          dualS: S,
          dualityGap: gap,
        };
      }

      const L = SdpSolver.cholesky(S);
      if (!L) break;
      const Sinv = SdpSolver.invertFromCholesky(L);

      const T: number[][][] = new Array(m);
      for (let j = 0; j < m; j++) {
        T[j] = SdpSolver.matMul(SdpSolver.matMul(X, Asym[j]!), Sinv);
      }

      const M: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
      for (let i = 0; i < m; i++) {
        for (let j = i; j < m; j++) {
          const val = SdpSolver.innerProduct(Asym[i]!, T[j]!);
          M[i]![j] = val;
          M[j]![i] = val;
        }
        M[i]![i]! += 1e-10;
      }

      const sigma = primalRes < tol * 10 && dualRes < tol * 10 ? 0.1 : 0.25;
      const XRdSinv = SdpSolver.matMul(SdpSolver.matMul(X, Rd), Sinv);
      const Rterm: number[][] = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => sigma * mu * Sinv[i]![j]! - X[i]![j]! + XRdSinv[i]![j]!),
      );
      const rhs = new Array<number>(m);
      for (let i = 0; i < m; i++) {
        rhs[i] = rp[i]! - SdpSolver.innerProduct(Asym[i]!, Rterm);
      }

      const dy = SdpSolver.solveLinearSystem(M, rhs);
      if (!dy) break;

      const dS: number[][] = Rd.map((row) => [...row]);
      for (let k = 0; k < m; k++) {
        const dyk = dy[k]!;
        if (dyk === 0) continue;
        const Ak = Asym[k]!;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) dS[i]![j]! -= dyk * Ak[i]![j]!;
        }
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const avg = 0.5 * (dS[i]![j]! + dS[j]![i]!);
          dS[i]![j] = avg;
          dS[j]![i] = avg;
        }
      }

      const XdSSinv = SdpSolver.matMul(SdpSolver.matMul(X, dS), Sinv);
      const dXraw: number[][] = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => sigma * mu * Sinv[i]![j]! - X[i]![j]! - XdSSinv[i]![j]!),
      );
      const dX: number[][] = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => 0.5 * (dXraw[i]![j]! + dXraw[j]![i]!)),
      );

      const alphaP = Math.min(1.0, 0.98 * SdpSolver.maxPdStep(X, dX));
      const alphaD = Math.min(1.0, 0.98 * SdpSolver.maxPdStep(S, dS));
      if (alphaP < 1e-12 && alphaD < 1e-12) break;

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          X[i]![j]! += alphaP * dX[i]![j]!;
          S[i]![j]! += alphaD * dS[i]![j]!;
        }
      }
      for (let k = 0; k < m; k++) y[k]! += alphaD * dy[k]!;
    }

    let finalResidual = 0;
    for (let i = 0; i < m; i++) {
      const val = (b[i] ?? 0) - SdpSolver.innerProduct(Asym[i]!, X);
      finalResidual = Math.max(finalResidual, Math.abs(val));
    }
    gap = Math.max(0, SdpSolver.innerProduct(X, S));
    const primalObj = SdpSolver.innerProduct(Csym, X);
    const isOptimal = finalResidual < tol && dualRes < tol && gap < tol * Math.max(1, n) && SdpSolver.isPsd(X);
    const isFeasible =
      SdpSolver.isPsd(X) && Number.isFinite(finalResidual) && (m === 0 || finalResidual <= Math.max(tol * 10, 1e-4));

    return {
      status: isOptimal ? "OPTIMAL" : isFeasible ? "FEASIBLE" : "INFEASIBLE",
      X,
      primalObj,
      iterations,
      residual: finalResidual,
      dualY: y,
      dualS: S,
      dualityGap: gap,
    };
  }
}
