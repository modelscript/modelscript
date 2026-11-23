// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Constraint Programming, Simple Temporal Networks (STN), & RCPSP Scheduler.
 *
 * Provides:
 *   1. Simple Temporal Network (STN) consistency & earliest/latest schedule extraction via
 *      Floyd-Warshall all-pairs shortest paths (negative cycle detection = temporal conflict).
 *   2. Resource-Constrained Project Scheduling Problem (RCPSP) solver via Serial Schedule
 *      Generation Scheme (SSGS) with Critical-Path / Latest-Finish-Time priority rules.
 */

export interface StnConstraint {
  /** Enforces t[to] - t[from] <= upperBound. */
  readonly from: number;
  readonly to: number;
  readonly upperBound: number;
}

export interface StnResult {
  readonly consistent: boolean;
  readonly earliestTimes: Float64Array;
  readonly latestTimes: Float64Array;
  readonly distanceMatrix: Float64Array;
}

/** Checks Simple Temporal Network (STN) consistency and extracts earliest/latest schedules. */
export function solveStn(numTimepoints: number, constraints: readonly StnConstraint[]): StnResult {
  const n = numTimepoints;
  const dist = new Float64Array(n * n).fill(Infinity);
  for (let i = 0; i < n; i++) dist[i * n + i] = 0;

  for (const c of constraints) {
    const idx = c.from * n + c.to;
    if (c.upperBound < dist[idx]!) dist[idx] = c.upperBound;
  }

  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const dik = dist[i * n + k]!;
      if (!Number.isFinite(dik)) continue;
      for (let j = 0; j < n; j++) {
        const dkj = dist[k * n + j]!;
        if (!Number.isFinite(dkj)) continue;
        const cand = dik + dkj;
        if (cand < dist[i * n + j]!) {
          dist[i * n + j] = cand;
        }
      }
    }
  }

  let consistent = true;
  for (let i = 0; i < n; i++) {
    if (dist[i * n + i]! < -1e-9) {
      consistent = false;
      break;
    }
  }

  // Reference timepoint 0 is anchored at t[0] = 0
  const earliestTimes = new Float64Array(n);
  const latestTimes = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    earliestTimes[i] = -dist[i * n + 0]!;
    latestTimes[i] = dist[0 * n + i]!;
  }

  return { consistent, earliestTimes, latestTimes, distanceMatrix: dist };
}

export interface RcpspTask {
  readonly id: string;
  readonly duration: number;
  readonly predecessors?: readonly string[] | undefined;
  readonly resourceDemand?: readonly number[] | undefined;
}

export interface RcpspResult {
  readonly feasible: boolean;
  readonly makespan: number;
  readonly startTimes: Record<string, number>;
  readonly finishTimes: Record<string, number>;
}

/**
 * Solves Resource-Constrained Project Scheduling (RCPSP) using Critical-Path prioritized
 * Serial Schedule Generation Scheme (SSGS).
 */
export function solveRcpsp(tasks: readonly RcpspTask[], resourceCapacities: readonly number[] = []): RcpspResult {
  const n = tasks.length;
  const idxById = new Map<string, number>();
  for (let i = 0; i < n; i++) idxById.set(tasks[i]!.id, i);

  const preds: number[][] = Array.from({ length: n }, () => []);
  const succs: number[][] = Array.from({ length: n }, () => []);
  const inDeg = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    for (const pid of tasks[i]!.predecessors ?? []) {
      const pIdx = idxById.get(pid);
      if (pIdx !== undefined) {
        preds[i]!.push(pIdx);
        succs[pIdx]!.push(i);
        inDeg[i] = inDeg[i]! + 1;
      }
    }
  }

  // Topological order & critical path length (longest path to sink)
  const topo: number[] = [];
  const q: number[] = [];
  for (let i = 0; i < n; i++) if (inDeg[i] === 0) q.push(i);
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi]!;
    topo.push(u);
    for (const v of succs[u]!) {
      inDeg[v] = inDeg[v]! - 1;
      if (inDeg[v] === 0) q.push(v);
    }
  }
  if (topo.length !== n) {
    return { feasible: false, makespan: Infinity, startTimes: {}, finishTimes: {} };
  }

  // Critical path tail length for priority ordering
  const tailLen = new Float64Array(n);
  for (let ti = n - 1; ti >= 0; ti--) {
    const u = topo[ti]!;
    let maxSucc = 0;
    for (const v of succs[u]!) {
      if (tailLen[v]! > maxSucc) maxSucc = tailLen[v]!;
    }
    tailLen[u] = tasks[u]!.duration + maxSucc;
  }

  // Horizon upper bound
  let maxHorizon = 1;
  for (const t of tasks) maxHorizon += Math.ceil(Math.max(1, t.duration));
  const numRes = resourceCapacities.length;

  // Validate individual task demands against capacities
  for (const t of tasks) {
    for (let r = 0; r < numRes; r++) {
      if ((t.resourceDemand?.[r] ?? 0) > resourceCapacities[r]!) {
        return { feasible: false, makespan: Infinity, startTimes: {}, finishTimes: {} };
      }
    }
  }

  const usage = Array.from({ length: numRes }, () => new Float64Array(maxHorizon + 1));
  const scheduled = new Uint8Array(n);
  const start = new Int32Array(n);
  const finish = new Int32Array(n);

  for (let count = 0; count < n; count++) {
    // Select eligible task with largest critical-path tail length
    let chosen = -1;
    let bestPriority = -1;
    for (let i = 0; i < n; i++) {
      if (scheduled[i]) continue;
      let ready = true;
      for (const p of preds[i]!) {
        if (!scheduled[p]) {
          ready = false;
          break;
        }
      }
      if (ready && tailLen[i]! > bestPriority) {
        bestPriority = tailLen[i]!;
        chosen = i;
      }
    }

    if (chosen === -1) {
      return { feasible: false, makespan: Infinity, startTimes: {}, finishTimes: {} };
    }

    let est = 0;
    for (const p of preds[chosen]!) {
      if (finish[p]! > est) est = finish[p]!;
    }
    const dur = Math.max(0, Math.ceil(tasks[chosen]!.duration));
    const demands = tasks[chosen]!.resourceDemand ?? [];

    let tStart = est;
    while (tStart + dur <= maxHorizon) {
      let ok = true;
      for (let r = 0; r < numRes && ok; r++) {
        const dem = demands[r] ?? 0;
        if (dem <= 0) continue;
        const cap = resourceCapacities[r]!;
        const uArr = usage[r]!;
        for (let tau = tStart; tau < tStart + dur; tau++) {
          if (uArr[tau]! + dem > cap + 1e-9) {
            ok = false;
            break;
          }
        }
      }
      if (ok) break;
      tStart++;
    }

    start[chosen] = tStart;
    finish[chosen] = tStart + dur;
    scheduled[chosen] = 1;
    for (let r = 0; r < numRes; r++) {
      const dem = demands[r] ?? 0;
      if (dem <= 0) continue;
      const uArr = usage[r]!;
      for (let tau = tStart; tau < tStart + dur; tau++) {
        uArr[tau] = uArr[tau]! + dem;
      }
    }
  }

  let makespan = 0;
  const startTimes: Record<string, number> = {};
  const finishTimes: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const id = tasks[i]!.id;
    startTimes[id] = start[i]!;
    finishTimes[id] = finish[i]!;
    if (finish[i]! > makespan) makespan = finish[i]!;
  }

  return { feasible: true, makespan, startTimes, finishTimes };
}
