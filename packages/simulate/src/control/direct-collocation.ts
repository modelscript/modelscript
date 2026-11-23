// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Hermite-Simpson Direct Collocation & Hybrid A* Kinematic Planner.
 *
 * Serves aerospace trajectory optimization (`jsbsim`, `rocets`, `ccsds`) and
 * autonomous vehicle path planning (`opendrive`, `openscenario`, `urdf`).
 */

import { IndexedMinHeap } from "@modelscript/runtime";

export interface DirectCollocationProblem {
  readonly f: (x: readonly number[], u: readonly number[]) => number[];
  readonly stageCost: (x: readonly number[], u: readonly number[]) => number;
  readonly x0: readonly number[];
  readonly xGoal: readonly number[];
  readonly uDim: number;
  readonly horizon: number;
  readonly numSegments: number;
}

export interface DirectCollocationResult {
  readonly times: number[];
  readonly xs: number[][];
  readonly us: number[][];
  readonly defectNorm: number;
  readonly objectiveCost: number;
}

/**
 * Hermite-Simpson Direct Collocation via penalty-augmented gradient descent over knot states & controls.
 */
export function solveDirectCollocation(prob: DirectCollocationProblem, maxIterations = 250): DirectCollocationResult {
  const N = prob.numSegments;
  const nx = prob.x0.length;
  const nu = prob.uDim;
  const dt = prob.horizon / N;

  // Linearly interpolate initial state trajectory from x0 to xGoal
  const xs: number[][] = Array.from({ length: N + 1 }, (_, k) => {
    const alpha = k / N;
    return Array.from({ length: nx }, (_, i) => (1 - alpha) * prob.x0[i]! + alpha * prob.xGoal[i]!);
  });
  const us: number[][] = Array.from({ length: N + 1 }, () => new Array<number>(nu).fill(0));

  const penalty = 50.0;
  const evalTotal = (xTraj: number[][], uTraj: number[][]): { total: number; defect2: number; cost: number } => {
    let cost = 0;
    let defect2 = 0;
    for (let k = 0; k < N; k++) {
      const xk = xTraj[k]!;
      const xk1 = xTraj[k + 1]!;
      const uk = uTraj[k]!;
      const uk1 = uTraj[k + 1]!;
      const fk = prob.f(xk, uk);
      const fk1 = prob.f(xk1, uk1);

      // Hermite midpoint state x_mid = 0.5*(xk + xk1) + (dt/8)*(fk - fk1)
      const xMid = Array.from({ length: nx }, (_, i) => 0.5 * (xk[i]! + xk1[i]!) + (dt / 8) * (fk[i]! - fk1[i]!));
      const uMid = Array.from({ length: nu }, (_, i) => 0.5 * (uk[i]! + uk1[i]!));
      const fMid = prob.f(xMid, uMid);

      // Simpson defect: x_{k+1} - x_k - (dt/6)*(f_k + 4*f_mid + f_{k+1}) = 0
      for (let i = 0; i < nx; i++) {
        const d = xk1[i]! - xk[i]! - (dt / 6) * (fk[i]! + 4 * fMid[i]! + fk1[i]!);
        defect2 += d * d;
      }
      cost += (dt / 6) * (prob.stageCost(xk, uk) + 4 * prob.stageCost(xMid, uMid) + prob.stageCost(xk1, uk1));
    }
    return { total: cost + penalty * defect2, defect2, cost };
  };

  const eps = 1e-5;
  let lr = 0.005;
  let cur = evalTotal(xs, us);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Coordinate finite-diff gradient on interior states xs[1..N-1] and all controls us[0..N]
    const gx = xs.map((row) => new Float64Array(row.length));
    const gu = us.map((row) => new Float64Array(row.length));

    for (let k = 1; k < N; k++) {
      for (let i = 0; i < nx; i++) {
        const orig = xs[k]![i]!;
        xs[k]![i] = orig + eps;
        const fp = evalTotal(xs, us).total;
        xs[k]![i] = orig - eps;
        const fm = evalTotal(xs, us).total;
        xs[k]![i] = orig;
        gx[k]![i] = (fp - fm) / (2 * eps);
      }
    }
    for (let k = 0; k <= N; k++) {
      for (let i = 0; i < nu; i++) {
        const orig = us[k]![i]!;
        us[k]![i] = orig + eps;
        const fp = evalTotal(xs, us).total;
        us[k]![i] = orig - eps;
        const fm = evalTotal(xs, us).total;
        us[k]![i] = orig;
        gu[k]![i] = (fp - fm) / (2 * eps);
      }
    }

    // Backtracking step
    let accepted = false;
    for (let b = 0; b < 6; b++) {
      const cx = xs.map((row, k) => row.map((v, i) => v - lr * gx[k]![i]!));
      const cu = us.map((row, k) => row.map((v, i) => v - lr * gu[k]![i]!));
      const cand = evalTotal(cx, cu);
      if (cand.total < cur.total) {
        for (let k = 0; k <= N; k++) {
          xs[k] = cx[k]!;
          us[k] = cu[k]!;
        }
        cur = cand;
        lr = Math.min(0.05, lr * 1.1);
        accepted = true;
        break;
      }
      lr *= 0.5;
    }
    if (!accepted || lr < 1e-7) break;
  }

  return {
    times: Array.from({ length: N + 1 }, (_, k) => k * dt),
    xs,
    us,
    defectNorm: Math.sqrt(cur.defect2),
    objectiveCost: cur.cost,
  };
}

export interface Pose2D {
  readonly x: number;
  readonly y: number;
  readonly theta: number;
}

export interface HybridAStarResult {
  readonly found: boolean;
  readonly path: Pose2D[];
  readonly expandedNodes: number;
}

/**
 * Hybrid A* Kinematic Bicycle Path Planner (continuous (x, y, theta) lattice over discretized bins).
 */
export function planHybridAStar(
  start: Pose2D,
  goal: Pose2D,
  isFree: (x: number, y: number) => boolean,
  opts?: {
    wheelbase?: number | undefined;
    stepLength?: number | undefined;
    maxSteerRad?: number | undefined;
    goalTolerance?: number | undefined;
    maxExpansions?: number | undefined;
  },
): HybridAStarResult {
  const L = opts?.wheelbase ?? 2.5;
  const ds = opts?.stepLength ?? 0.8;
  const maxSteer = opts?.maxSteerRad ?? 0.55;
  const goalTol = opts?.goalTolerance ?? 1.0;
  const maxExp = opts?.maxExpansions ?? 2000;
  const steers = [-maxSteer, 0, maxSteer];

  const poses: Pose2D[] = [start];
  const gCost: number[] = [0];
  const parent: number[] = [-1];
  const visited = new Map<string, number>();

  const binKey = (p: Pose2D): string => {
    const bx = Math.round(p.x / (ds * 0.5));
    const by = Math.round(p.y / (ds * 0.5));
    const normT = ((p.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const bt = Math.round((normT / (2 * Math.PI)) * 16) % 16;
    return `${bx}:${by}:${bt}`;
  };

  const heap = new IndexedMinHeap(256);
  const h0 = Math.hypot(goal.x - start.x, goal.y - start.y);
  heap.push(0, h0);
  visited.set(binKey(start), 0);

  let expanded = 0;
  let goalId = -1;

  while (heap.length > 0 && expanded < maxExp) {
    const { id: curId } = heap.pop();
    const cur = poses[curId]!;
    expanded++;

    if (Math.hypot(cur.x - goal.x, cur.y - goal.y) <= goalTol) {
      goalId = curId;
      break;
    }

    for (const delta of steers) {
      const nextTheta = cur.theta + (ds / L) * Math.tan(delta);
      const nextPose: Pose2D = {
        x: cur.x + ds * Math.cos(nextTheta),
        y: cur.y + ds * Math.sin(nextTheta),
        theta: nextTheta,
      };
      if (!isFree(nextPose.x, nextPose.y)) continue;

      const candG = gCost[curId]! + ds * (delta === 0 ? 1.0 : 1.05);
      const key = binKey(nextPose);
      const prevBest = visited.get(key);
      if (prevBest !== undefined && prevBest <= candG) continue;

      visited.set(key, candG);
      const nid = poses.length;
      poses.push(nextPose);
      gCost.push(candG);
      parent.push(curId);
      const h = Math.hypot(goal.x - nextPose.x, goal.y - nextPose.y);
      heap.push(nid, candG + h);
    }
  }

  if (goalId === -1) {
    return { found: false, path: [], expandedNodes: expanded };
  }

  const path: Pose2D[] = [];
  for (let cur = goalId; cur !== -1; cur = parent[cur]!) {
    path.push(poses[cur]!);
  }
  path.reverse();
  return { found: true, path, expandedNodes: expanded };
}
