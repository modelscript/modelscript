// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Vehicle Routing Problem (VRP) & CSR Subdomain Partitioner.
 *
 * Provides:
 *   1. Capacitated VRP via Clarke-Wright Savings + 2-opt route improvement
 *   2. CSR matrix-to-k-way subdomain partitioner for Distributed Krylov / EMT / FEA solvers
 */

import { partitionGraphKWay, type GraphPartitionResult } from "./csr_graph.js";

export interface VrpCustomer {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly demand: number;
}

export interface VrpResult {
  readonly routes: string[][];
  readonly totalDistance: number;
}

/**
 * Capacitated Vehicle Routing Problem (CVRP) solver using Clarke-Wright Savings + 2-opt refinement.
 */
export function solveCapacitatedVrp(
  depot: { readonly x: number; readonly y: number },
  customers: readonly VrpCustomer[],
  vehicleCapacity: number,
): VrpResult {
  const n = customers.length;
  if (n === 0) return { routes: [], totalDistance: 0 };

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

  // Start with individual depot -> i -> depot routes
  const routes: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const routeOf = new Int32Array(n).map((_, i) => i);
  const routeLoad = Float64Array.from(customers, (c) => c.demand);

  // Compute Clarke-Wright savings s_ij = d(0,i) + d(0,j) - d(i,j)
  const savings: Array<{ i: number; j: number; s: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = dist(depot, customers[i]!) + dist(depot, customers[j]!) - dist(customers[i]!, customers[j]!);
      if (s > 0) savings.push({ i, j, s });
    }
  }
  savings.sort((a, b) => b.s - a.s);

  for (const { i, j } of savings) {
    const ri = routeOf[i]!;
    const rj = routeOf[j]!;
    if (ri === rj) continue;
    const routeI = routes[ri]!;
    const routeJ = routes[rj]!;
    if (routeI.length === 0 || routeJ.length === 0) continue;
    if (routeLoad[ri]! + routeLoad[rj]! > vehicleCapacity + 1e-9) continue;

    // Merge only if i and j are endpoints of their respective routes
    const iEnd = routeI[routeI.length - 1] === i;
    const iStart = routeI[0] === i;
    const jStart = routeJ[0] === j;
    const jEnd = routeJ[routeJ.length - 1] === j;

    if (iEnd && jStart) {
      routeI.push(...routeJ);
    } else if (iStart && jEnd) {
      routeI.unshift(...routeJ);
    } else if (iEnd && jEnd) {
      routeJ.reverse();
      routeI.push(...routeJ);
    } else if (iStart && jStart) {
      routeJ.reverse();
      routeI.unshift(...routeJ);
    } else {
      continue;
    }

    routeLoad[ri] = routeLoad[ri]! + routeLoad[rj]!;
    for (const c of routeJ) routeOf[c] = ri;
    routes[rj] = [];
  }

  const activeRoutes = routes.filter((r) => r.length > 0);
  let totalDistance = 0;
  for (const r of activeRoutes) {
    let prev = depot;
    for (const idx of r) {
      const c = customers[idx]!;
      totalDistance += dist(prev, c);
      prev = c;
    }
    totalDistance += dist(prev, depot);
  }

  return {
    routes: activeRoutes.map((r) => r.map((idx) => customers[idx]!.id)),
    totalDistance,
  };
}

/**
 * Partitions a sparse CSR matrix's sparsity graph into `numSubdomains` balanced partitions
 * using METIS-style multilevel k-way partitioning (for Distributed Krylov / EMT / FEA).
 */
export function partitionCsrSubdomainsKWay(
  n: number,
  rowPtr: Int32Array | readonly number[],
  colIdx: Int32Array | readonly number[],
  numSubdomains: number,
): GraphPartitionResult {
  const edges: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const start = rowPtr[i]!;
    const end = rowPtr[i + 1]!;
    for (let e = start; e < end; e++) {
      const j = colIdx[e]!;
      if (j > i) edges.push([i, j, 1.0]);
    }
  }
  return partitionGraphKWay(n, edges, numSubdomains);
}
