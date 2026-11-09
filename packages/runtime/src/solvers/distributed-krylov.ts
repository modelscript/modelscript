// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Domain-Decomposed Parallel Krylov & Restricted Additive Schwarz (RAS) Solver.
 *
 * Implements overlapping graph partitioning, halo-exchange sparse matrix-vector products,
 * and Restricted Additive Schwarz (RAS) domain-decomposition preconditioning for large-scale
 * sparse and Jacobian-Free Newton-Krylov (JFNK) linear systems:
 *
 * $$M_{\text{RAS}}^{-1} = \sum_{k=1}^{P} \tilde{R}_k^\top A_k^{-1} R_k, \quad A_k = R_k A R_k^\top$$
 *
 * where $R_k$ restricts global vectors to the $\delta$-overlapping subdomain $\Omega_k^\delta$,
 * $A_k^{-1}$ solves the local subdomain problem via pivoted LU factorization, and $\tilde{R}_k^\top$
 * prolongates only the disjoint interior unknowns $\Omega_k^\circ$ back to the global domain.
 *
 * Academic Citations:
 * - Cai, X.-C., & Sarkis, M. (1999). "A restricted additive Schwarz preconditioner for general
 *   sparse linear systems." SIAM Journal on Scientific Computing, 21(2), 792-797.
 *   https://doi.org/10.1137/S106482759732678X
 * - Saad, Y. (2003). Iterative Methods for Sparse Linear Systems (2nd ed.). SIAM.
 *   ISBN: 978-0-898715-34-7.
 * - Dolean, V., Jolivet, P., & Nataf, F. (2015). An Introduction to Domain Decomposition Methods:
 *   Algorithms, Theory, and Parallel Implementation. SIAM.
 */

export interface DenseLUFactorization {
  /** Combined L (unit lower) and U (upper) factors of dimension m x m. */
  lu: Float64Array;
  /** Pivot permutation array of length m. */
  perm: Int32Array;
  /** Subdomain dimension m = |Omega_k^delta|. */
  m: number;
}

export interface SubdomainPartition {
  /** Subdomain index k in 0 .. P-1. */
  subdomainId: number;
  /** Disjoint non-overlapping interior nodes Omega_k^0. */
  interiorIndices: Int32Array;
  /** Overlapping subdomain nodes Omega_k^delta (interior + halo). */
  overlapIndices: Int32Array;
  /** Halo nodes Omega_k^delta \ Omega_k^0 received from neighboring subdomains. */
  haloIndices: Int32Array;
  /** Map from global variable index to local index in [0 .. overlapIndices.length - 1]. */
  globalToLocal: Map<number, number>;
  /** Optional pre-factored local matrix A_k = R_k A R_k^T. */
  localLU?: DenseLUFactorization | undefined;
}

export interface DistributedGMRESOptions {
  /** System dimension N. */
  n: number;
  /** CSR row pointer array of length N + 1. */
  rowPtr: Int32Array | number[];
  /** CSR column index array of length nnz. */
  colIdx: Int32Array | number[];
  /** CSR non-zero values array of length nnz. */
  values: Float64Array | number[];
  /** Right-hand side vector b of length N. */
  b: Float64Array | number[];
  /** Initial guess x0 of length N (default: zero vector). */
  x0?: Float64Array | number[] | undefined;
  /** Number of domain-decomposition subdomains P (default: 4). */
  numSubdomains?: number | undefined;
  /** Algebraic overlap width delta in graph hops (default: 1). */
  overlapHops?: number | undefined;
  /** Relative residual convergence tolerance (default: 1e-10). */
  rtol?: number | undefined;
  /** Absolute residual convergence tolerance (default: 1e-12). */
  atol?: number | undefined;
  /** Krylov restart dimension m (default: 30). */
  restart?: number | undefined;
  /** Maximum total Krylov iterations (default: 200). */
  maxIterations?: number | undefined;
  /** Optional custom matrix-vector operator (e.g. JFNK directional derivative). */
  customMatVec?: ((x: Float64Array) => Float64Array) | undefined;
}

export interface DistributedGMRESResult {
  /** Solution vector x of length N. */
  solution: Float64Array;
  /** Final Euclidean residual norm ||b - A x||_2. */
  residualNorm: number;
  /** Total Krylov iterations executed. */
  iterations: number;
  /** True if residualNorm <= atol + rtol * ||b||_2. */
  converged: boolean;
  /** Number of subdomains used in the RAS partition. */
  numSubdomains: number;
  /** Total halo boundary scalar values exchanged across subdomain MatVecs. */
  haloMessagesExchanged: number;
  /** Monotonically decreasing residual norm history per Krylov step. */
  residualHistory: number[];
  /** Constructed domain partitions. */
  partitions: SubdomainPartition[];
}

/**
 * Computes an in-place dense LU factorization with partial pivoting for an $m \times m$ matrix.
 */
export function factorDenseLU(matrix: Float64Array, m: number): DenseLUFactorization {
  const lu = new Float64Array(matrix);
  const perm = new Int32Array(m);
  for (let i = 0; i < m; i++) perm[i] = i;

  for (let k = 0; k < m; k++) {
    // Find pivot row
    let maxVal = Math.abs(lu[k * m + k]!);
    let pivotRow = k;
    for (let i = k + 1; i < m; i++) {
      const v = Math.abs(lu[i * m + k]!);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = i;
      }
    }

    if (pivotRow !== k) {
      // Swap rows in lu
      for (let j = 0; j < m; j++) {
        const tmp = lu[k * m + j]!;
        lu[k * m + j] = lu[pivotRow * m + j]!;
        lu[pivotRow * m + j] = tmp;
      }
      const tmpP = perm[k]!;
      perm[k] = perm[pivotRow]!;
      perm[pivotRow] = tmpP;
    }

    const diag = lu[k * m + k]!;
    const safeDiag = Math.abs(diag) < 1e-15 ? (diag >= 0 ? 1e-15 : -1e-15) : diag;
    lu[k * m + k] = safeDiag;

    for (let i = k + 1; i < m; i++) {
      const factor = lu[i * m + k]! / safeDiag;
      lu[i * m + k] = factor;
      for (let j = k + 1; j < m; j++) {
        lu[i * m + j] = lu[i * m + j]! - factor * lu[k * m + j]!;
      }
    }
  }

  return { lu, perm, m };
}

/**
 * Solves $A_k u = r_k$ using a precomputed dense LU factorization.
 */
export function solveDenseLU(fact: DenseLUFactorization, rhs: Float64Array): Float64Array {
  const { lu, perm, m } = fact;
  const x = new Float64Array(m);

  // Permute RHS and forward substitute L y = P rhs
  for (let i = 0; i < m; i++) {
    let sum = rhs[perm[i]!]!;
    for (let j = 0; j < i; j++) {
      sum -= lu[i * m + j]! * x[j]!;
    }
    x[i] = sum;
  }

  // Backward substitute U x = y
  for (let i = m - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let j = i + 1; j < m; j++) {
      sum -= lu[i * m + j]! * x[j]!;
    }
    x[i] = sum / lu[i * m + i]!;
  }

  return x;
}

/**
 * Partitions a sparse CSR graph of dimension $N$ into $P$ disjoint interior subdomains $\Omega_k^\circ$
 * and expands each by $\delta$ algebraic graph hops to form overlapping subdomains $\Omega_k^\delta$.
 * If CSR `values` are supplied, extracts and LU-factors each local subdomain matrix $A_k = R_k A R_k^\top$.
 */
export function partitionDomainGraph(
  n: number,
  rowPtr: Int32Array | number[],
  colIdx: Int32Array | number[],
  numSubdomains: number,
  overlapHops = 1,
  values?: Float64Array | number[],
): SubdomainPartition[] {
  const P = Math.max(1, Math.min(n, Math.floor(numSubdomains)));
  const hops = Math.max(0, Math.floor(overlapHops));

  // Build undirected adjacency list for algebraic hop expansion
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const start = rowPtr[i]!;
    const end = rowPtr[i + 1]!;
    for (let idx = start; idx < end; idx++) {
      const j = colIdx[idx]!;
      if (j !== i && j >= 0 && j < n) {
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }
  }

  const partitions: SubdomainPartition[] = [];
  const baseSize = Math.floor(n / P);
  const remainder = n % P;

  let offset = 0;
  for (let k = 0; k < P; k++) {
    const count = baseSize + (k < remainder ? 1 : 0);
    const interior: number[] = [];
    const interiorSet = new Set<number>();
    for (let idx = 0; idx < count; idx++) {
      const node = offset + idx;
      interior.push(node);
      interiorSet.add(node);
    }
    offset += count;

    // BFS expansion by `hops` algebraic graph hops
    const overlapSet = new Set<number>(interior);
    let frontier = [...interior];
    for (let h = 0; h < hops; h++) {
      const nextFrontier: number[] = [];
      for (const u of frontier) {
        for (const v of adj[u]!) {
          if (!overlapSet.has(v)) {
            overlapSet.add(v);
            nextFrontier.push(v);
          }
        }
      }
      frontier = nextFrontier;
    }

    // Order overlap indices with interior first, then sorted halo indices
    const halo = Array.from(overlapSet)
      .filter((idx) => !interiorSet.has(idx))
      .sort((a, b) => a - b);
    const overlap = [...interior, ...halo];

    const globalToLocal = new Map<number, number>();
    for (let loc = 0; loc < overlap.length; loc++) {
      globalToLocal.set(overlap[loc]!, loc);
    }

    let localLU: DenseLUFactorization | undefined = undefined;
    if (values !== undefined) {
      const m = overlap.length;
      const denseBlock = new Float64Array(m * m);
      for (let locRow = 0; locRow < m; locRow++) {
        const globRow = overlap[locRow]!;
        const start = rowPtr[globRow]!;
        const end = rowPtr[globRow + 1]!;
        for (let c = start; c < end; c++) {
          const globCol = colIdx[c]!;
          const locCol = globalToLocal.get(globCol);
          if (locCol !== undefined) {
            const idx = locRow * m + locCol;
            denseBlock[idx] = denseBlock[idx]! + values[c]!;
          }
        }
      }
      localLU = factorDenseLU(denseBlock, m);
    }

    partitions.push({
      subdomainId: k,
      interiorIndices: new Int32Array(interior),
      overlapIndices: new Int32Array(overlap),
      haloIndices: new Int32Array(halo),
      globalToLocal,
      localLU,
    });
  }

  return partitions;
}

/**
 * Applies the Restricted Additive Schwarz (RAS) preconditioner:
 *
 * $$z = M_{\text{RAS}}^{-1} r = \sum_{k=1}^{P} \tilde{R}_k^\top A_k^{-1} R_k r$$
 *
 * Each subdomain restricts $r$ to $\Omega_k^\delta$, solves the local problem $A_k u_k = R_k r$,
 * and writes only its disjoint interior components $\Omega_k^\circ$ into the global output $z$.
 */
export function applyRASPreconditioner(partitions: SubdomainPartition[], r: Float64Array): Float64Array {
  const z = new Float64Array(r.length);

  for (const part of partitions) {
    if (!part.localLU) {
      throw new Error(`applyRASPreconditioner: Subdomain ${part.subdomainId} has no factored localLU block.`);
    }
    const m = part.overlapIndices.length;
    const rLocal = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      rLocal[i] = r[part.overlapIndices[i]!]!;
    }

    const uLocal = solveDenseLU(part.localLU, rLocal);

    // Prolongate only interior nodes Omega_k^0 (which occupy indices 0 .. interiorIndices.length - 1)
    const nInterior = part.interiorIndices.length;
    for (let i = 0; i < nInterior; i++) {
      const globIdx = part.interiorIndices[i]!;
      z[globIdx] = uLocal[i]!;
    }
  }

  return z;
}

/**
 * Performs a distributed domain-decomposed sparse matrix-vector product $y = A x$
 * with explicit halo boundary exchange accounting across subdomains.
 */
export function haloExchangeMatVec(
  partitions: SubdomainPartition[],
  rowPtr: Int32Array | number[],
  colIdx: Int32Array | number[],
  values: Float64Array | number[],
  x: Float64Array,
): { y: Float64Array; haloMessagesExchanged: number } {
  const y = new Float64Array(x.length);
  let haloMessagesExchanged = 0;

  for (const part of partitions) {
    // Gather halo buffer from neighboring subdomains
    haloMessagesExchanged += part.haloIndices.length;

    // Compute interior rows owned by this subdomain
    const interior = part.interiorIndices;
    for (let idx = 0; idx < interior.length; idx++) {
      const row = interior[idx]!;
      let sum = 0.0;
      const start = rowPtr[row]!;
      const end = rowPtr[row + 1]!;
      for (let c = start; c < end; c++) {
        sum += values[c]! * x[colIdx[c]!]!;
      }
      y[row] = sum;
    }
  }

  return { y, haloMessagesExchanged };
}

function norm2(v: Float64Array): number {
  let sum = 0.0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!;
  }
  return Math.sqrt(sum);
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0.0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * Solves $A x = b$ using Right-Preconditioned Distributed GMRES with Restricted Additive Schwarz
 * ($M_{\text{RAS}}^{-1}$) domain-decomposition preconditioning.
 */
export function distributedGMRES(options: DistributedGMRESOptions): DistributedGMRESResult {
  const {
    n,
    rowPtr,
    colIdx,
    values,
    b,
    x0,
    numSubdomains = 4,
    overlapHops = 1,
    rtol = 1e-10,
    atol = 1e-12,
    restart = 30,
    maxIterations = 200,
    customMatVec,
  } = options;

  const partitions = partitionDomainGraph(n, rowPtr, colIdx, numSubdomains, overlapHops, values);

  const bVec = b instanceof Float64Array ? b : new Float64Array(b);
  const x = x0 ? new Float64Array(x0) : new Float64Array(n);

  let totalHaloMessages = 0;
  const evalMatVec = (v: Float64Array): Float64Array => {
    if (customMatVec) {
      totalHaloMessages += partitions.reduce((acc, p) => acc + p.haloIndices.length, 0);
      return customMatVec(v);
    }
    const res = haloExchangeMatVec(partitions, rowPtr, colIdx, values, v);
    totalHaloMessages += res.haloMessagesExchanged;
    return res.y;
  };

  const bNorm = norm2(bVec);
  const tol = atol + rtol * bNorm;

  // Initial residual r = b - A x
  const Ax0 = evalMatVec(x);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = bVec[i]! - Ax0[i]!;

  let resNorm = norm2(r);
  const residualHistory: number[] = [resNorm];
  let totalIters = 0;

  if (resNorm <= tol) {
    return {
      solution: x,
      residualNorm: resNorm,
      iterations: 0,
      converged: true,
      numSubdomains: partitions.length,
      haloMessagesExchanged: totalHaloMessages,
      residualHistory,
      partitions,
    };
  }

  const m = Math.min(restart, n);

  while (totalIters < maxIterations && resNorm > tol) {
    const V: Float64Array[] = [];
    const Z: Float64Array[] = [];
    const H = Array.from({ length: m + 1 }, () => new Float64Array(m));
    const cs = new Float64Array(m);
    const sn = new Float64Array(m);
    const g = new Float64Array(m + 1);
    g[0] = resNorm;

    const v0 = new Float64Array(n);
    for (let i = 0; i < n; i++) v0[i] = r[i]! / resNorm;
    V.push(v0);

    let k = 0;
    for (; k < m && totalIters < maxIterations; k++) {
      totalIters++;
      // Right preconditioning: z_k = M_RAS^{-1} v_k, w = A z_k
      const zk = applyRASPreconditioner(partitions, V[k]!);
      Z.push(zk);
      const w = evalMatVec(zk);

      // Modified Gram-Schmidt orthogonalization
      for (let i = 0; i <= k; i++) {
        const hij = dot(w, V[i]!);
        H[i]![k] = hij;
        for (let j = 0; j < n; j++) {
          w[j] = w[j]! - hij * V[i]![j]!;
        }
      }
      const hNext = norm2(w);
      H[k + 1]![k] = hNext;

      if (hNext > 1e-15) {
        const vNext = new Float64Array(n);
        for (let j = 0; j < n; j++) vNext[j] = w[j]! / hNext;
        V.push(vNext);
      } else {
        V.push(new Float64Array(n));
      }

      // Apply previous Givens rotations to column k of H
      for (let i = 0; i < k; i++) {
        const temp = cs[i]! * H[i]![k]! + sn[i]! * H[i + 1]![k]!;
        H[i + 1]![k] = -sn[i]! * H[i]![k]! + cs[i]! * H[i + 1]![k]!;
        H[i]![k] = temp;
      }

      // Compute new Givens rotation for (H[k][k], H[k+1][k])
      const a = H[k]![k]!;
      const bVal = H[k + 1]![k]!;
      const rho = Math.hypot(a, bVal);
      const c = rho > 0 ? a / rho : 1.0;
      const s = rho > 0 ? bVal / rho : 0.0;
      cs[k] = c;
      sn[k] = s;

      H[k]![k] = c * a + s * bVal;
      H[k + 1]![k] = 0.0;

      g[k + 1] = -s * g[k]!;
      g[k] = c * g[k]!;

      resNorm = Math.abs(g[k + 1]!);
      residualHistory.push(resNorm);

      if (resNorm <= tol) {
        k++;
        break;
      }
    }

    // Back-substitution for upper triangular H(0..k-1, 0..k-1) y = g(0..k-1)
    const yCoeff = new Float64Array(k);
    for (let i = k - 1; i >= 0; i--) {
      let sum = g[i]!;
      for (let j = i + 1; j < k; j++) {
        sum -= H[i]![j]! * yCoeff[j]!;
      }
      const diag = H[i]![i]!;
      yCoeff[i] = Math.abs(diag) > 1e-15 ? sum / diag : 0.0;
    }

    // Update global solution x += sum_{i=0}^{k-1} yCoeff[i] * Z[i]
    for (let i = 0; i < k; i++) {
      const yi = yCoeff[i]!;
      const zi = Z[i]!;
      for (let j = 0; j < n; j++) {
        x[j] = x[j]! + yi * zi[j]!;
      }
    }

    // Recompute true residual r = b - A x
    const Ax = evalMatVec(x);
    for (let i = 0; i < n; i++) r[i] = bVec[i]! - Ax[i]!;
    resNorm = norm2(r);
  }

  return {
    solution: x,
    residualNorm: resNorm,
    iterations: totalIters,
    converged: resNorm <= tol,
    numSubdomains: partitions.length,
    haloMessagesExchanged: totalHaloMessages,
    residualHistory,
    partitions,
  };
}
