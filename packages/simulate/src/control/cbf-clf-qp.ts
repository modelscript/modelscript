// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Control Barrier Function (CBF) / Control Lyapunov Function (CLF) QP Safety Filter.
 *
 * Solves the minimum-deviation safety-critical quadratic program at each control step:
 *   min_u  0.5 * ||u - u_nom||^2
 *   s.t.   Lg_h(x) * u >= -Lf_h(x) - alpha * h(x)   (for each barrier constraint i)
 *          u_min <= u <= u_max
 *
 * Uses projected dual-ascent / Hildreth's QP algorithm for deterministic real-time execution.
 */

export interface CbfConstraint {
  /** Barrier value h(x) (safe set is h(x) >= 0). */
  readonly h: number;
  /** Lie derivative L_f h(x). */
  readonly Lf_h: number;
  /** Lie derivative row vector L_g h(x) (length = uDim). */
  readonly Lg_h: readonly number[];
  /** Class-K decay rate alpha > 0. */
  readonly alpha: number;
}

export interface CbfQpResult {
  readonly uSafe: Float64Array;
  readonly feasible: boolean;
  readonly activeConstraints: number[];
  readonly deviationNorm: number;
  readonly iterations: number;
}

/**
 * Computes the minimum-norm safe control input `uSafe` satisfying all CBF inequalities
 * via Hildreth's dual coordinate-ascent QP solver with box-bound projection.
 */
export function solveCbfClfQp(
  uNom: readonly number[],
  barriers: readonly CbfConstraint[],
  opts?: {
    uMin?: readonly number[] | undefined;
    uMax?: readonly number[] | undefined;
    maxIterations?: number | undefined;
    tol?: number | undefined;
  },
): CbfQpResult {
  const m = uNom.length;
  const k = barriers.length;
  const maxIter = opts?.maxIterations ?? 200;
  const tol = opts?.tol ?? 1e-9;

  const clampU = (u: Float64Array): void => {
    for (let j = 0; j < m; j++) {
      if (opts?.uMin && u[j]! < opts.uMin[j]!) u[j] = opts.uMin[j]!;
      if (opts?.uMax && u[j]! > opts.uMax[j]!) u[j] = opts.uMax[j]!;
    }
  };

  const uSafe = Float64Array.from(uNom);
  clampU(uSafe);
  if (k === 0) {
    return { uSafe, feasible: true, activeConstraints: [], deviationNorm: 0, iterations: 0 };
  }

  // Rewrite constraints in standard form A * u <= b:
  //   -Lg_h * u <= Lf_h + alpha * h
  const A = new Float64Array(k * m);
  const b = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const c = barriers[i]!;
    for (let j = 0; j < m; j++) A[i * m + j] = -(c.Lg_h[j] ?? 0);
    b[i] = c.Lf_h + c.alpha * c.h;
  }

  // Dual matrix P = A * A^T (k x k) and d = b - A * uNom
  const P = new Float64Array(k * k);
  const d = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    let au = 0;
    for (let j = 0; j < m; j++) au += A[i * m + j]! * uNom[j]!;
    d[i] = b[i]! - au;
    for (let r = 0; r < k; r++) {
      let dot = 0;
      for (let j = 0; j < m; j++) dot += A[i * m + j]! * A[r * m + j]!;
      P[i * k + r] = dot;
    }
  }

  const lambda = new Float64Array(k);
  let iter = 0;
  for (; iter < maxIter; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < k; i++) {
      const pii = P[i * k + i]!;
      if (pii <= 1e-14) continue;
      let sum = d[i]!;
      for (let r = 0; r < k; r++) {
        if (r !== i) sum += P[i * k + r]! * lambda[r]!;
      }
      const nextLam = Math.max(0, -sum / pii);
      const diff = Math.abs(nextLam - lambda[i]!);
      if (diff > maxDelta) maxDelta = diff;
      lambda[i] = nextLam;
    }
    if (maxDelta < tol) break;
  }

  // Recover primal u* = uNom - A^T * lambda
  for (let j = 0; j < m; j++) {
    let corr = 0;
    for (let i = 0; i < k; i++) corr += A[i * m + j]! * lambda[i]!;
    uSafe[j] = uNom[j]! - corr;
  }
  clampU(uSafe);

  // Verify feasibility of final clamped control
  let feasible = true;
  const activeConstraints: number[] = [];
  for (let i = 0; i < k; i++) {
    let lhs = 0;
    for (let j = 0; j < m; j++) lhs += A[i * m + j]! * uSafe[j]!;
    if (lhs > b[i]! + 1e-5) feasible = false;
    if (lambda[i]! > 1e-8) activeConstraints.push(i);
  }

  let dev2 = 0;
  for (let j = 0; j < m; j++) {
    const diff = uSafe[j]! - uNom[j]!;
    dev2 += diff * diff;
  }

  return {
    uSafe,
    feasible,
    activeConstraints,
    deviationNorm: Math.sqrt(dev2),
    iterations: iter,
  };
}
