// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Sampling-Based Motion Planning (RRT*) & Trajectory Optimization (iLQR).
 *
 * Connects ModelScript's CAD BVH/clearance checks and robotics/aerospace models (`urdf`, `opendrive`,
 * `openscenario`, `jsbsim`, `rocets`) to collision-free path planning and optimal control.
 */

import { solveDenseLinear } from "@modelscript/runtime";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface RrtStarOptions {
  readonly maxIterations?: number | undefined;
  readonly stepSize?: number | undefined;
  readonly goalBias?: number | undefined;
  readonly goalTolerance?: number | undefined;
  readonly rewireRadius?: number | undefined;
  readonly seed?: number | undefined;
}

export interface RrtStarResult {
  readonly found: boolean;
  readonly path: number[][];
  readonly cost: number;
  readonly treeSize: number;
}

/**
 * RRT* (Karaman & Frazzoli 2011) asymptotically optimal sampling-based motion planner.
 */
export function planRrtStar(
  start: readonly number[],
  goal: readonly number[],
  boundsMin: readonly number[],
  boundsMax: readonly number[],
  isCollisionFree: (q: readonly number[]) => boolean,
  opts?: RrtStarOptions,
): RrtStarResult {
  const dim = start.length;
  const maxIter = opts?.maxIterations ?? 800;
  const stepSize = opts?.stepSize ?? 0.5;
  const goalBias = opts?.goalBias ?? 0.1;
  const goalTol = opts?.goalTolerance ?? stepSize;
  const rewireR = opts?.rewireRadius ?? stepSize * 2.2;
  const rng = lcg(opts?.seed ?? 7);

  const dist = (a: readonly number[], b: readonly number[]): number => {
    let s = 0;
    for (let i = 0; i < dim; i++) {
      const d = a[i]! - b[i]!;
      s += d * d;
    }
    return Math.sqrt(s);
  };

  const segmentFree = (a: readonly number[], b: readonly number[]): boolean => {
    const d = dist(a, b);
    const checks = Math.max(2, Math.ceil(d / (stepSize * 0.25)));
    const q = new Array<number>(dim);
    for (let k = 1; k <= checks; k++) {
      const t = k / checks;
      for (let i = 0; i < dim; i++) q[i] = a[i]! + t * (b[i]! - a[i]!);
      if (!isCollisionFree(q)) return false;
    }
    return true;
  };

  const nodes: number[][] = [[...start]];
  const parent: number[] = [-1];
  const cost: number[] = [0];
  let bestGoalIdx = -1;
  let bestGoalCost = Infinity;

  for (let iter = 0; iter < maxIter; iter++) {
    const sample =
      rng() < goalBias
        ? [...goal]
        : Array.from({ length: dim }, (_, i) => boundsMin[i]! + rng() * (boundsMax[i]! - boundsMin[i]!));

    // Nearest node
    let nearest = 0;
    let bestD = dist(nodes[0]!, sample);
    for (let i = 1; i < nodes.length; i++) {
      const d = dist(nodes[i]!, sample);
      if (d < bestD) {
        bestD = d;
        nearest = i;
      }
    }

    // Steer toward sample
    const qNear = nodes[nearest]!;
    const qNew =
      bestD <= stepSize
        ? sample
        : Array.from({ length: dim }, (_, i) => qNear[i]! + (stepSize / bestD) * (sample[i]! - qNear[i]!));

    if (!isCollisionFree(qNew) || !segmentFree(qNear, qNew)) continue;

    // Choose best parent within rewire radius
    const neighbors: number[] = [];
    let bestParent = nearest;
    let minCost = cost[nearest]! + dist(qNear, qNew);
    for (let i = 0; i < nodes.length; i++) {
      const d = dist(nodes[i]!, qNew);
      if (d <= rewireR) {
        neighbors.push(i);
        const candCost = cost[i]! + d;
        if (candCost < minCost && segmentFree(nodes[i]!, qNew)) {
          minCost = candCost;
          bestParent = i;
        }
      }
    }

    const newIdx = nodes.length;
    nodes.push(qNew);
    parent.push(bestParent);
    cost.push(minCost);

    // Rewire nearby nodes
    for (const nbr of neighbors) {
      const d = dist(qNew, nodes[nbr]!);
      if (minCost + d < cost[nbr]! && segmentFree(qNew, nodes[nbr]!)) {
        parent[nbr] = newIdx;
        cost[nbr] = minCost + d;
      }
    }

    // Check goal connection
    const dGoal = dist(qNew, goal);
    if (dGoal <= goalTol && segmentFree(qNew, goal)) {
      const totalCost = minCost + dGoal;
      if (totalCost < bestGoalCost) {
        bestGoalCost = totalCost;
        bestGoalIdx = newIdx;
      }
    }
  }

  if (bestGoalIdx === -1) {
    return { found: false, path: [], cost: Infinity, treeSize: nodes.length };
  }

  const path: number[][] = [[...goal]];
  for (let cur = bestGoalIdx; cur !== -1; cur = parent[cur]!) {
    path.push([...nodes[cur]!]);
  }
  path.reverse();
  return { found: true, path, cost: bestGoalCost, treeSize: nodes.length };
}

export interface IlqrProblem {
  /** Discrete-time dynamics x_{k+1} = f(x_k, u_k). */
  readonly stepDynamics: (x: readonly number[], u: readonly number[]) => number[];
  readonly stageCost: (x: readonly number[], u: readonly number[]) => number;
  readonly terminalCost: (x: readonly number[]) => number;
  readonly x0: readonly number[];
  readonly uInit: readonly (readonly number[])[];
  readonly maxIterations?: number | undefined;
}

export interface IlqrResult {
  readonly xs: number[][];
  readonly us: number[][];
  readonly totalCost: number;
  readonly iterations: number;
}

/**
 * Iterative Linear Quadratic Regulator (iLQR) for nonlinear trajectory optimization.
 */
export function solveIlqr(prob: IlqrProblem): IlqrResult {
  const N = prob.uInit.length;
  const nx = prob.x0.length;
  const nu = prob.uInit[0]!.length;
  const maxIter = prob.maxIterations ?? 40;
  const eps = 1e-5;

  const rollout = (us: number[][]): { xs: number[][]; cost: number } => {
    const xs: number[][] = [[...prob.x0]];
    let cost = 0;
    for (let k = 0; k < N; k++) {
      cost += prob.stageCost(xs[k]!, us[k]!);
      xs.push(prob.stepDynamics(xs[k]!, us[k]!));
    }
    cost += prob.terminalCost(xs[N]!);
    return { xs, cost };
  };

  let us = prob.uInit.map((u) => [...u]);
  let { xs, cost: curCost } = rollout(us);
  let reg = 1e-4;

  let iter = 0;
  for (; iter < maxIter; iter++) {
    // Backward pass: finite-diff Jacobians and quadratic cost approximations
    const Vx = new Float64Array(nx);
    const Vxx = new Float64Array(nx * nx);
    const xN = xs[N]!;
    const fN = prob.terminalCost(xN);
    for (let i = 0; i < nx; i++) {
      const xp = [...xN];
      const xm = [...xN];
      xp[i] = xp[i]! + eps;
      xm[i] = xm[i]! - eps;
      const fp = prob.terminalCost(xp);
      const fm = prob.terminalCost(xm);
      Vx[i] = (fp - fm) / (2 * eps);
      Vxx[i * nx + i] = Math.max(1e-6, (fp - 2 * fN + fm) / (eps * eps));
    }

    const ks: Float64Array[] = new Array(N);
    const Ks: Float64Array[] = new Array(N);

    for (let k = N - 1; k >= 0; k--) {
      const xk = xs[k]!;
      const uk = us[k]!;
      const fk = prob.stageCost(xk, uk);

      // Dynamics Jacobians A (nx x nx), B (nx x nu)
      const A = new Float64Array(nx * nx);
      const B = new Float64Array(nx * nu);
      for (let j = 0; j < nx; j++) {
        const xp = [...xk];
        const xm = [...xk];
        xp[j] = xp[j]! + eps;
        xm[j] = xm[j]! - eps;
        const dp = prob.stepDynamics(xp, uk);
        const dm = prob.stepDynamics(xm, uk);
        for (let i = 0; i < nx; i++) A[i * nx + j] = (dp[i]! - dm[i]!) / (2 * eps);
      }
      for (let j = 0; j < nu; j++) {
        const up = [...uk];
        const um = [...uk];
        up[j] = up[j]! + eps;
        um[j] = um[j]! - eps;
        const dp = prob.stepDynamics(xk, up);
        const dm = prob.stepDynamics(xk, um);
        for (let i = 0; i < nx; i++) B[i * nu + j] = (dp[i]! - dm[i]!) / (2 * eps);
      }

      // Cost derivatives lx, lu, lxx (diag), luu (diag)
      const lx = new Float64Array(nx);
      const lxx = new Float64Array(nx * nx);
      for (let i = 0; i < nx; i++) {
        const xp = [...xk];
        const xm = [...xk];
        xp[i] = xp[i]! + eps;
        xm[i] = xm[i]! - eps;
        const fp = prob.stageCost(xp, uk);
        const fm = prob.stageCost(xm, uk);
        lx[i] = (fp - fm) / (2 * eps);
        lxx[i * nx + i] = Math.max(0, (fp - 2 * fk + fm) / (eps * eps));
      }
      const lu = new Float64Array(nu);
      const luu = new Float64Array(nu * nu);
      for (let i = 0; i < nu; i++) {
        const up = [...uk];
        const um = [...uk];
        up[i] = up[i]! + eps;
        um[i] = um[i]! - eps;
        const fp = prob.stageCost(xk, up);
        const fm = prob.stageCost(xk, um);
        lu[i] = (fp - fm) / (2 * eps);
        luu[i * nu + i] = Math.max(1e-6, (fp - 2 * fk + fm) / (eps * eps));
      }

      // Qx = lx + A^T Vx, Qu = lu + B^T Vx
      const Qx = Float64Array.from(lx);
      const Qu = Float64Array.from(lu);
      for (let i = 0; i < nx; i++) {
        for (let r = 0; r < nx; r++) Qx[i] = Qx[i]! + A[r * nx + i]! * Vx[r]!;
      }
      for (let i = 0; i < nu; i++) {
        for (let r = 0; r < nx; r++) Qu[i] = Qu[i]! + B[r * nu + i]! * Vx[r]!;
      }

      // Qxx = lxx + A^T Vxx A, Quu = luu + B^T Vxx B + reg*I, Qux = B^T Vxx A
      const Qxx = Float64Array.from(lxx);
      const Quu = Float64Array.from(luu);
      const Qux = new Float64Array(nu * nx);
      for (let i = 0; i < nu; i++) Quu[i * nu + i] = Quu[i * nu + i]! + reg;

      for (let r = 0; r < nx; r++) {
        for (let c = 0; c < nx; c++) {
          const vrc = Vxx[r * nx + c]!;
          if (vrc === 0) continue;
          for (let i = 0; i < nx; i++) {
            const ari = A[r * nx + i]!;
            for (let j = 0; j < nx; j++) Qxx[i * nx + j] = Qxx[i * nx + j]! + ari * vrc * A[c * nx + j]!;
          }
          for (let i = 0; i < nu; i++) {
            const bri = B[r * nu + i]!;
            for (let j = 0; j < nu; j++) Quu[i * nu + j] = Quu[i * nu + j]! + bri * vrc * B[c * nu + j]!;
            for (let j = 0; j < nx; j++) Qux[i * nx + j] = Qux[i * nx + j]! + bri * vrc * A[c * nx + j]!;
          }
        }
      }

      // Feedforward k_ff = -Quu^{-1} Qu, Feedback K_fb = -Quu^{-1} Qux
      const negQu = new Float64Array(nu);
      for (let i = 0; i < nu; i++) negQu[i] = -Qu[i]!;
      const kff = solveDenseLinear(Quu, negQu, nu);
      const Kfb = new Float64Array(nu * nx);
      for (let col = 0; col < nx; col++) {
        const rhs = new Float64Array(nu);
        for (let i = 0; i < nu; i++) rhs[i] = -Qux[i * nx + col]!;
        const sol = solveDenseLinear(Quu, rhs, nu);
        for (let i = 0; i < nu; i++) Kfb[i * nx + col] = sol[i]!;
      }

      ks[k] = kff;
      Ks[k] = Kfb;

      // Update Vx = Qx + K^T Qu, Vxx = Qxx + K^T Qux
      for (let i = 0; i < nx; i++) {
        let s = Qx[i]!;
        for (let j = 0; j < nu; j++) s += Kfb[j * nx + i]! * Qu[j]!;
        Vx[i] = s;
        for (let col = 0; col < nx; col++) {
          let mVal = Qxx[i * nx + col]!;
          for (let j = 0; j < nu; j++) mVal += Kfb[j * nx + i]! * Qux[j * nx + col]!;
          Vxx[i * nx + col] = mVal;
        }
      }
    }

    // Backtracking line search forward pass
    let improved = false;
    for (const alpha of [1.0, 0.5, 0.25, 0.1, 0.02]) {
      const candUs: number[][] = new Array(N);
      const candXs: number[][] = [[...prob.x0]];
      let candCost = 0;
      for (let k = 0; k < N; k++) {
        const uNew = new Array<number>(nu);
        const kff = ks[k]!;
        const Kfb = Ks[k]!;
        for (let i = 0; i < nu; i++) {
          let delta = alpha * kff[i]!;
          for (let j = 0; j < nx; j++) delta += Kfb[i * nx + j]! * (candXs[k]![j]! - xs[k]![j]!);
          uNew[i] = us[k]![i]! + delta;
        }
        candUs[k] = uNew;
        candCost += prob.stageCost(candXs[k]!, uNew);
        candXs.push(prob.stepDynamics(candXs[k]!, uNew));
      }
      candCost += prob.terminalCost(candXs[N]!);
      if (candCost < curCost - 1e-9) {
        us = candUs;
        xs = candXs;
        curCost = candCost;
        reg = Math.max(1e-6, reg * 0.5);
        improved = true;
        break;
      }
    }
    if (!improved) {
      reg *= 10;
      if (reg > 1e6) break;
    }
  }

  return { xs, us, totalCost: curCost, iterations: iter };
}
