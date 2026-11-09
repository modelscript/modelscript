// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Physics-Informed Neural Network (PINN) Collocation Point Generators.
 *
 * Provides continuous-time domain sampling strategies for physical residual evaluation:
 * - **Uniform Random**: Baseline uniform random sampling across $[t_0, t_{\text{end}}]$.
 * - **Sobol / Halton Quasi-Monte Carlo**: Low-discrepancy sequence ensuring uniform domain coverage without clustering.
 * - **Chebyshev / Gauss-Lobatto Nodes**: Clustered near domain boundaries to minimize Runge phenomenon.
 * - **Residual-Based Adaptive Refinement (RAR)**: Greedily samples candidate points with highest DAE residual magnitude.
 *
 * Academic Citations:
 * - Raissi, M., Perdikaris, P., & Karniadakis, G. E. (2019). "Physics-informed neural networks:
 *   A deep learning framework for solving forward and inverse problems involving nonlinear
 *   partial differential equations." Journal of Computational Physics, 378, 686-707.
 * - Lu, L., Meng, X., Mao, Z., & Karniadakis, G. E. (2021). "DeepXDE: A deep learning library
 *   for solving differential equations." SIAM Review, 63(1), 208-228. (RAR algorithm)
 */

export type CollocationStrategy = "uniform" | "sobol" | "chebyshev" | "latin-hypercube";

export interface CollocationConfig {
  tSpan: [number, number];
  count: number;
  strategy?: CollocationStrategy | undefined;
  seed?: number | undefined;
  includeEndpoints?: boolean | undefined;
}

/**
 * Generates low-discrepancy Van der Corput sequence (Base-2 Sobol in 1D).
 */
export function vanDerCorput(n: number, base: number = 2): number {
  let q = 0.0;
  let bk = 1.0 / base;
  while (n > 0) {
    q += (n % base) * bk;
    n = Math.floor(n / base);
    bk /= base;
  }
  return q;
}

/**
 * Generates collocation points in $[t_0, t_{\text{end}}]$ using the specified strategy.
 */
export function generateCollocationPoints(config: CollocationConfig): number[] {
  const [t0, tEnd] = config.tSpan;
  const duration = tEnd - t0;
  const count = Math.max(2, config.count);
  const strategy = config.strategy ?? "sobol";
  const points: number[] = [];

  switch (strategy) {
    case "chebyshev": {
      // Chebyshev-Gauss-Lobatto nodes: x_k = -cos(pi * k / (N - 1)) for k = 0...N-1
      for (let k = 0; k < count; k++) {
        const theta = (Math.PI * k) / (count - 1);
        const x = -Math.cos(theta); // in [-1, 1]
        const t = t0 + 0.5 * (x + 1.0) * duration;
        points.push(t);
      }
      break;
    }
    case "sobol": {
      if (config.includeEndpoints !== false) {
        points.push(t0);
      }
      for (let i = 1; i <= count; i++) {
        const u = vanDerCorput(i, 2);
        points.push(t0 + u * duration);
      }
      if (config.includeEndpoints !== false && !points.includes(tEnd)) {
        points.push(tEnd);
      }
      points.sort((a, b) => a - b);
      break;
    }
    case "latin-hypercube": {
      // 1D Latin Hypercube: Stratified sampling across `count` bins
      let s = config.seed ?? 42;
      const prng = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };

      const binSize = duration / count;
      for (let i = 0; i < count; i++) {
        const u = prng();
        points.push(t0 + (i + u) * binSize);
      }
      if (config.includeEndpoints !== false) {
        if (!points.includes(t0)) points.unshift(t0);
        if (!points.includes(tEnd)) points.push(tEnd);
      }
      points.sort((a, b) => a - b);
      break;
    }
    case "uniform":
    default: {
      const step = duration / (count - 1);
      for (let i = 0; i < count; i++) {
        points.push(t0 + i * step);
      }
      break;
    }
  }

  return points;
}

/**
 * Residual-Based Adaptive Refinement (RAR).
 *
 * Evaluates candidate points in the domain, sorts by residual error, and appends
 * the `countToAdd` worst points to the active collocation set.
 */
export function refineCollocationRAR(
  currentPoints: readonly number[],
  tSpan: [number, number],
  residualFn: (t: number) => number,
  countToAdd: number = 10,
  candidatePoolSize: number = 200,
): number[] {
  const [t0, tEnd] = tSpan;
  const duration = tEnd - t0;

  // Generate candidate pool using Sobol
  const candidates: { t: number; residual: number }[] = [];
  for (let i = 1; i <= candidatePoolSize; i++) {
    const t = t0 + vanDerCorput(i * 3 + 7, 3) * duration;
    const res = Math.abs(residualFn(t));
    candidates.push({ t, residual: res });
  }

  // Sort candidates in descending order of residual error
  candidates.sort((a, b) => b.residual - a.residual);

  const existingSet = new Set(currentPoints.map((p) => p.toFixed(8)));
  const refined = [...currentPoints];

  let added = 0;
  for (const cand of candidates) {
    const key = cand.t.toFixed(8);
    if (!existingSet.has(key)) {
      refined.push(cand.t);
      existingSet.add(key);
      added++;
      if (added >= countToAdd) break;
    }
  }

  refined.sort((a, b) => a - b);
  return refined;
}

const HALTON_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29];

/**
 * Generates multi-dimensional low-discrepancy collocation points in $\Omega = \prod_{k=0}^{d-1} [a_k, b_k]$
 * for spatio-temporal PDE Physics-Informed Neural Networks (e.g., $\mathbf{x} = (t, x, y, z)$).
 */
export function generateMultiDimCollocationPoints(
  bounds: readonly [number, number][],
  count: number,
  strategy: "halton" | "uniform" = "halton",
  seed: number = 42,
): number[][] {
  const dim = bounds.length;
  const nPts = Math.max(1, count);
  const points: number[][] = [];

  if (strategy === "halton") {
    for (let i = 1; i <= nPts; i++) {
      const pt = new Array<number>(dim);
      for (let d = 0; d < dim; d++) {
        const [lo, hi] = bounds[d]!;
        const base = HALTON_PRIMES[d % HALTON_PRIMES.length]!;
        const u = vanDerCorput(i, base);
        pt[d] = lo + u * (hi - lo);
      }
      points.push(pt);
    }
    return points;
  }

  let s = seed >>> 0;
  const prng = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  for (let i = 0; i < nPts; i++) {
    const pt = new Array<number>(dim);
    for (let d = 0; d < dim; d++) {
      const [lo, hi] = bounds[d]!;
      pt[d] = lo + prng() * (hi - lo);
    }
    points.push(pt);
  }
  return points;
}
