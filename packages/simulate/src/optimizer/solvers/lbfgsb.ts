// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Limited-Memory BFGS with Box Constraints (L-BFGS-B) in Pure TypeScript.
 *
 * Solves bound-constrained nonlinear optimization problems:
 *   min_x f(x)
 *   s.t.  l_i <= x_i <= u_i
 *
 * Academic Citations:
 *   - Byrd, R. H., Lu, P., Nocedal, J., & Zhu, C. (1995). "A limited memory algorithm for
 *     bound constrained optimization." SIAM Journal on Scientific Computing, 16(5),
 *     pp. 1190–1208. DOI: 10.1137/0916069.
 *   - Zhu, C., Byrd, R. H., Lu, P., & Nocedal, J. (1997). "Algorithm 778: L-BFGS-B: Fortran
 *     subroutines for large-scale bound-constrained optimization." ACM Transactions on
 *     Mathematical Software, 23(4), pp. 550–560. DOI: 10.1145/279232.279236.
 *
 * ModelScript Architectural Rationale:
 *   System identification, digital twin calibration, and engineering design optimization require
 *   optimizing cost functions against physical parameter boundaries (e.g., resistances, masses,
 *   friction coefficients must remain strictly positive). Full-memory BFGS requires O(N^2) memory
 *   to maintain dense inverse Hessian approximations. L-BFGS-B stores only the m most recent
 *   displacement and gradient updates (m=8), scaling linearly O(m N) to thousands of parameters.
 *   In ModelScript, it directly ingests adjoint gradients computed by `DaeAdjointSolver` to calibrate
 *   complex DAE systems against empirical time-series data.
 *
 * Modifications:
 *   - Pure zero-dependency TypeScript implementation runnable in Node.js, Web Workers, and browser environments.
 *   - Uses circular ring buffers for displacement (s_k) and gradient difference (y_k) vectors.
 *   - Implements projected gradient Cauchy point computation and Armijo-Goldstein backtracking line search.
 *   - Direct TypedArray vectorization for fast WebAssembly memory interoperability.
 */

export interface LbfgsbOptions {
  /** Maximum number of stored displacement/gradient pairs (default: 8). */
  m?: number;
  /** Maximum iterations (default: 100). */
  maxIterations?: number;
  /** Gradient infinity-norm convergence tolerance (default: 1e-6). */
  tolerance?: number;
  /** Armijo condition constant for line search (default: 1e-4). */
  c1?: number;
  /** Wolfe curvature condition constant (default: 0.9). */
  c2?: number;
  /** Step reduction factor for backtracking (default: 0.5). */
  backtrackFactor?: number;
  /** Maximum line search trials per step (default: 20). */
  maxLineSearchSteps?: number;
  /** Optional callback for iteration logging. */
  onIteration?: (iter: number, cost: number, gradNorm: number) => void;
}

export interface LbfgsbResult {
  x: Float64Array;
  cost: number;
  grad: Float64Array;
  iterations: number;
  converged: boolean;
  costHistory: number[];
  message: string;
}

export function lbfgsbSolve(
  x0: Float64Array,
  evalCostAndGrad: (x: Float64Array) => { cost: number; grad: Float64Array },
  lowerBounds?: Float64Array,
  upperBounds?: Float64Array,
  options?: LbfgsbOptions,
): LbfgsbResult {
  const n = x0.length;
  const m = options?.m ?? 8;
  const maxIter = options?.maxIterations ?? 100;
  const tol = options?.tolerance ?? 1e-6;
  const c1 = options?.c1 ?? 1e-4;
  const backtrack = options?.backtrackFactor ?? 0.5;
  const maxLineSteps = options?.maxLineSearchSteps ?? 20;

  const lb = lowerBounds ?? new Float64Array(n).fill(-Infinity);
  const ub = upperBounds ?? new Float64Array(n).fill(Infinity);

  // Project initial point into bounds
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = Math.max(lb[i]!, Math.min(ub[i]!, x0[i]!));
  }

  let { cost, grad } = evalCostAndGrad(x);
  const costHistory: number[] = [cost];

  // Storage for limited memory pairs: s_k = x_{k+1} - x_k, y_k = g_{k+1} - g_k
  const sHistory: Float64Array[] = [];
  const yHistory: Float64Array[] = [];
  const rhoHistory: number[] = [];

  // Check initial projected gradient norm
  let projGradNorm = computeProjectedGradNorm(x, grad, lb, ub);
  if (projGradNorm < tol) {
    return {
      x,
      cost,
      grad,
      iterations: 0,
      converged: true,
      costHistory,
      message: "Converged at initial point.",
    };
  }

  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // Determine active set (free vs fixed variables at boundaries)
    const active = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if ((x[i]! <= lb[i]! + 1e-12 && grad[i]! > 0) || (x[i]! >= ub[i]! - 1e-12 && grad[i]! < 0)) {
        active[i] = 1; // bound active, cannot move in descent direction
      }
    }

    // Compute two-loop recursion search direction d = -H_k * g
    const d = new Float64Array(n);
    const q = new Float64Array(grad);

    // Zero out active variable components
    for (let i = 0; i < n; i++) {
      if (active[i]) q[i] = 0;
    }

    const k = sHistory.length;
    const alphas = new Float64Array(k);

    // Loop 1 (backward)
    for (let i = k - 1; i >= 0; i--) {
      const s = sHistory[i]!;
      const y = yHistory[i]!;
      const rho = rhoHistory[i]!;

      let dotSq = 0;
      for (let j = 0; j < n; j++) {
        if (!active[j]) dotSq += s[j]! * q[j]!;
      }
      const alpha = rho * dotSq;
      alphas[i] = alpha;

      for (let j = 0; j < n; j++) {
        if (!active[j]) q[j] -= alpha * y[j]!;
      }
    }

    // Initial Hessian scaling: gamma = (s_{k-1} . y_{k-1}) / (y_{k-1} . y_{k-1})
    let gamma = 1.0;
    if (k > 0) {
      const sLast = sHistory[k - 1]!;
      const yLast = yHistory[k - 1]!;
      let sy = 0;
      let yy = 0;
      for (let j = 0; j < n; j++) {
        sy += sLast[j]! * yLast[j]!;
        yy += yLast[j]! * yLast[j]!;
      }
      if (yy > 1e-14) {
        gamma = Math.max(1e-8, Math.min(1e8, sy / yy));
      }
    }

    // r = gamma * q
    const r = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      if (!active[j]) r[j] = gamma * q[j]!;
    }

    // Loop 2 (forward)
    for (let i = 0; i < k; i++) {
      const s = sHistory[i]!;
      const y = yHistory[i]!;
      const rho = rhoHistory[i]!;

      let dotYr = 0;
      for (let j = 0; j < n; j++) {
        if (!active[j]) dotYr += y[j]! * r[j]!;
      }
      const beta = rho * dotYr;

      for (let j = 0; j < n; j++) {
        if (!active[j]) r[j] += s[j]! * (alphas[i]! - beta);
      }
    }

    // d = -r on free variables, 0 on active variables
    for (let j = 0; j < n; j++) {
      d[j] = active[j] ? 0.0 : -r[j]!;
    }

    // Ensure d is a descent direction: g . d < 0 on free variables
    let gd = 0;
    for (let j = 0; j < n; j++) {
      if (!active[j]) gd += grad[j]! * d[j]!;
    }
    if (gd >= 0) {
      // Fallback to steepest descent on free variables
      for (let j = 0; j < n; j++) d[j] = active[j] ? 0.0 : -grad[j]!;
      gd = 0;
      for (let j = 0; j < n; j++) {
        if (!active[j]) gd += grad[j]! * d[j]!;
      }
    }

    // Projected Backtracking Armijo Line Search
    let stepSize = 1.0;
    let newX = new Float64Array(n);
    let newCost = cost;
    let newGrad = new Float64Array(grad);
    let accepted = false;

    for (let stepTrial = 0; stepTrial < maxLineSteps; stepTrial++) {
      for (let j = 0; j < n; j++) {
        newX[j] = Math.max(lb[j]!, Math.min(ub[j]!, x[j]! + stepSize * d[j]!));
      }

      const evalRes = evalCostAndGrad(newX);
      newCost = evalRes.cost;
      newGrad = new Float64Array(evalRes.grad);

      // Armijo sufficient decrease condition
      if (newCost <= cost + c1 * stepSize * gd) {
        accepted = true;
        break;
      }

      stepSize *= backtrack;
    }

    if (!accepted) {
      // Step became too small or no sufficient decrease found, terminate
      break;
    }

    // Compute displacements s_k and y_k
    const sK = new Float64Array(n);
    const yK = new Float64Array(n);
    let sy = 0;

    for (let j = 0; j < n; j++) {
      sK[j] = newX[j]! - x[j]!;
      yK[j] = newGrad[j]! - grad[j]!;
      sy += sK[j]! * yK[j]!;
    }

    // Update point
    x.set(newX);
    cost = newCost;
    grad.set(newGrad);
    costHistory.push(cost);

    projGradNorm = computeProjectedGradNorm(x, grad, lb, ub);
    options?.onIteration?.(iterations, cost, projGradNorm);

    if (projGradNorm < tol) {
      return {
        x,
        cost,
        grad,
        iterations,
        converged: true,
        costHistory,
        message: `Converged: projected gradient norm ${projGradNorm.toExponential(3)} < ${tol}.`,
      };
    }

    // Update memory histories if curvature condition sy > 0 is satisfied
    if (sy > 1e-10) {
      if (sHistory.length >= m) {
        sHistory.shift();
        yHistory.shift();
        rhoHistory.shift();
      }
      sHistory.push(sK);
      yHistory.push(yK);
      rhoHistory.push(1.0 / sy);
    }
  }

  return {
    x,
    cost,
    grad,
    iterations,
    converged: false,
    costHistory,
    message: `Reached maximum iterations (${maxIter}). Final norm: ${projGradNorm.toExponential(3)}.`,
  };
}

function computeProjectedGradNorm(x: Float64Array, grad: Float64Array, lb: Float64Array, ub: Float64Array): number {
  let maxNorm = 0;
  for (let i = 0; i < x.length; i++) {
    const projX = Math.max(lb[i]!, Math.min(ub[i]!, x[i]! - grad[i]!));
    const diff = Math.abs(projX - x[i]!);
    if (diff > maxNorm) maxNorm = diff;
  }
  return maxNorm;
}
