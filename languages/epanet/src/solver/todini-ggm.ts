// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Todini Global Gradient Method (GGM) Hydraulic Solver.
 *
 * Implements the standard Todini & Pilati (1988) Global Gradient Algorithm
 * for steady-state pressure and flow convergence in municipal water networks.
 */

import type { EpanetNetwork } from "../types.js";

export interface EpanetHydraulicResult {
  converged: boolean;
  iterations: number;
  maxFlowChange: number;
  nodeHeads: Map<string, number>; // Total head H [m]
  nodePressures: Map<string, number>; // Pressure head P = H - Elev [m]
  linkFlows: Map<string, number>; // Flow rate Q [L/s or SI unit]
  linkVelocities: Map<string, number>; // Velocity v [m/s]
  linkHeadLosses: Map<string, number>; // Head loss delta H [m]
}

export interface EpanetSolverOptions {
  maxIterations?: number | undefined;
  tolerance?: number | undefined;
}

export function solveHydraulics(
  net: EpanetNetwork,
  options?: EpanetSolverOptions | number,
  tolParam?: number,
): EpanetHydraulicResult {
  let maxIterations = 50;
  let tolerance = 1e-4;

  if (typeof options === "number") {
    maxIterations = options;
    if (typeof tolParam === "number") tolerance = tolParam;
  } else if (options && typeof options === "object") {
    if (options.maxIterations !== undefined) maxIterations = options.maxIterations;
    if (options.tolerance !== undefined) tolerance = options.tolerance;
  }
  const junctions = net.junctions;
  const reservoirs = net.reservoirs;
  const pipes = net.pipes.filter((p) => p.status !== "CLOSED");

  const numJunctions = junctions.length;
  const numPipes = pipes.length;

  if (numJunctions === 0) {
    return {
      converged: true,
      iterations: 0,
      maxFlowChange: 0,
      nodeHeads: new Map(),
      nodePressures: new Map(),
      linkFlows: new Map(),
      linkVelocities: new Map(),
      linkHeadLosses: new Map(),
    };
  }

  // Node Index Mapping
  const juncIndex = new Map<string, number>();
  junctions.forEach((j, idx) => juncIndex.set(j.id.toLowerCase(), idx));

  const resMap = new Map<string, number>();
  reservoirs.forEach((r) => resMap.set(r.id.toLowerCase(), r.totalHead));
  net.tanks.forEach((t) => resMap.set(t.id.toLowerCase(), t.elevation + t.initLevel));

  // Determine nominal head for initialization
  let refHead = 100.0;
  if (reservoirs.length > 0) {
    refHead = reservoirs[0]!.totalHead;
  } else if (net.tanks.length > 0) {
    refHead = net.tanks[0]!.elevation + net.tanks[0]!.initLevel;
  }

  // Unknown heads vector H (dimension numJunctions)
  const H = new Float64Array(numJunctions);
  for (let i = 0; i < numJunctions; i++) {
    H[i] = refHead;
  }

  // Unknown pipe flows vector Q (dimension numPipes)
  const Q = new Float64Array(numPipes);
  for (let p = 0; p < numPipes; p++) {
    Q[p] = 10.0; // initial seed flow 10 L/s
  }

  // Pipe Resistance coefficients r_p: h_L = r_p * |Q|^1.852
  // Hazen-Williams formula: r_p = 10.67 * L / (C^1.852 * D^4.87)
  const rCoeff = new Float64Array(numPipes);
  const nExp = 1.852;

  for (let p = 0; p < numPipes; p++) {
    const pipe = pipes[p]!;
    const L = Math.max(1.0, pipe.length);
    // Convert D from mm to m if metric (assume D > 5 means mm, else m)
    const D = pipe.diameter > 5.0 ? pipe.diameter / 1000.0 : pipe.diameter;
    const C = Math.max(10.0, pipe.roughness);
    // r in (m / (m^3/s)^1.852)
    const rSI = (10.67 * L) / (Math.pow(C, 1.852) * Math.pow(D, 4.87));
    // Flow Q in L/s -> convert m^3/s to L/s scaling
    // Q_m3s = Q_Lps / 1000 => r_scaled = rSI / (1000^1.852)
    rCoeff[p] = rSI / Math.pow(1000.0, nExp);
  }

  // Demands vector q_demand (L/s)
  const qDemand = new Float64Array(numJunctions);
  for (let j = 0; j < numJunctions; j++) {
    qDemand[j] = junctions[j]!.demand;
  }

  let converged = false;
  let iter = 0;
  let maxDeltaQ = 0.0;

  // Pre-allocated flat buffers for zero-GC Newton iterations
  const A11_inv = new Float64Array(numPipes);
  const pipeHeadLoss = new Float64Array(numPipes);
  const RHS = new Float64Array(numJunctions);
  const H_new = new Float64Array(numJunctions);
  const M_flat = new Float64Array(numJunctions * numJunctions);
  const LScratch = new Float64Array(numJunctions * numJunctions);
  const yScratch = new Float64Array(numJunctions);

  // Newton-Raphson / Global Gradient Method Iterations
  while (iter < maxIterations) {
    iter++;

    // 1. Build Diagonal matrix A11_inv and gradient flow elements
    // For pipe p: A11[p] = n * r_p * |Q_p|^(n-1)
    for (let p = 0; p < numPipes; p++) {
      const qVal = Q[p] ?? 0;
      const qAbs = Math.max(0.001, Math.abs(qVal));
      const gTerm = nExp * rCoeff[p]! * Math.pow(qAbs, nExp - 1.0);
      A11_inv[p] = 1.0 / Math.max(1e-7, gTerm);
      pipeHeadLoss[p] = Math.sign(qVal) * rCoeff[p]! * Math.pow(qAbs, nExp);
    }

    // 2. Build Junction Matrix M = A12^T * A11_inv * A12 (flat numJunctions x numJunctions)
    M_flat.fill(0);

    // Initial RHS = -qDemand
    for (let j = 0; j < numJunctions; j++) {
      RHS[j] = -qDemand[j]!;
    }

    for (let p = 0; p < numPipes; p++) {
      const pipe = pipes[p]!;
      const dVal = A11_inv[p]!;
      const n1 = pipe.node1.toLowerCase();
      const n2 = pipe.node2.toLowerCase();

      const j1 = juncIndex.get(n1);
      const j2 = juncIndex.get(n2);
      const h1Fixed = resMap.get(n1);
      const h2Fixed = resMap.get(n2);

      const hLoss = pipeHeadLoss[p]!;
      const qFlow = Q[p]!;

      // Contribution to M and RHS
      if (j1 !== undefined && j2 !== undefined) {
        // Both are unknown junctions
        const idx11 = j1 * numJunctions + j1;
        const idx22 = j2 * numJunctions + j2;
        const idx12 = j1 * numJunctions + j2;
        const idx21 = j2 * numJunctions + j1;
        M_flat[idx11] = (M_flat[idx11] ?? 0) + dVal;
        M_flat[idx22] = (M_flat[idx22] ?? 0) + dVal;
        M_flat[idx12] = (M_flat[idx12] ?? 0) - dVal;
        M_flat[idx21] = (M_flat[idx21] ?? 0) - dVal;

        const term = qFlow - dVal * hLoss;
        RHS[j1] = (RHS[j1] ?? 0) - term;
        RHS[j2] = (RHS[j2] ?? 0) + term;
      } else if (j1 !== undefined && h2Fixed !== undefined) {
        // Node 1 is junction, Node 2 is fixed reservoir/tank
        const idx11 = j1 * numJunctions + j1;
        M_flat[idx11] = (M_flat[idx11] ?? 0) + dVal;
        RHS[j1] = (RHS[j1] ?? 0) - (qFlow - dVal * (hLoss + h2Fixed));
      } else if (j2 !== undefined && h1Fixed !== undefined) {
        // Node 2 is junction, Node 1 is fixed reservoir/tank
        const idx22 = j2 * numJunctions + j2;
        M_flat[idx22] = (M_flat[idx22] ?? 0) + dVal;
        RHS[j2] = (RHS[j2] ?? 0) + (qFlow - dVal * (hLoss - h1Fixed));
      }
    }

    // 3. Solve SPD linear system M * H_new = RHS via Cholesky decomposition
    solveCholeskyFlat(M_flat, RHS, H_new, numJunctions, LScratch, yScratch);

    // 4. Update pipe flows Q and check convergence
    maxDeltaQ = 0.0;
    for (let p = 0; p < numPipes; p++) {
      const pipe = pipes[p]!;
      const n1 = pipe.node1.toLowerCase();
      const n2 = pipe.node2.toLowerCase();

      const h1 = juncIndex.has(n1) ? H_new[juncIndex.get(n1)!]! : (resMap.get(n1) ?? refHead);
      const h2 = juncIndex.has(n2) ? H_new[juncIndex.get(n2)!]! : (resMap.get(n2) ?? refHead);

      const deltaH = h1 - h2;
      const dVal = A11_inv[p]!;
      const hLoss = pipeHeadLoss[p]!;
      const newQ = Q[p]! - dVal * (hLoss - deltaH);

      const diff = Math.abs(newQ - Q[p]!);
      if (diff > maxDeltaQ) maxDeltaQ = diff;
      Q[p] = newQ;
    }

    // Update heads
    for (let j = 0; j < numJunctions; j++) {
      H[j] = H_new[j]!;
    }

    if (maxDeltaQ < tolerance) {
      converged = true;
      break;
    }
  }

  // Construct Results Map
  const nodeHeads = new Map<string, number>();
  const nodePressures = new Map<string, number>();
  const linkFlows = new Map<string, number>();
  const linkVelocities = new Map<string, number>();
  const linkHeadLosses = new Map<string, number>();

  for (let j = 0; j < numJunctions; j++) {
    const junc = junctions[j]!;
    const head = H[j]!;
    const press = head - junc.elevation;
    nodeHeads.set(junc.id, head);
    nodePressures.set(junc.id, press);
  }

  for (const r of reservoirs) {
    nodeHeads.set(r.id, r.totalHead);
    nodePressures.set(r.id, 0.0);
  }
  for (const t of net.tanks) {
    const head = t.elevation + t.initLevel;
    nodeHeads.set(t.id, head);
    nodePressures.set(t.id, t.initLevel);
  }

  for (let p = 0; p < numPipes; p++) {
    const pipe = pipes[p]!;
    const flow = Q[p]!;
    const D = pipe.diameter > 5.0 ? pipe.diameter / 1000.0 : pipe.diameter;
    const area = (Math.PI * D * D) / 4.0;
    const flowSI = flow / 1000.0; // m^3/s
    const velocity = area > 0 ? flowSI / area : 0.0;
    const hLoss = Math.sign(flow) * rCoeff[p]! * Math.pow(Math.abs(flow), nExp);

    linkFlows.set(pipe.id, flow);
    linkVelocities.set(pipe.id, velocity);
    linkHeadLosses.set(pipe.id, hLoss);
  }

  return {
    converged,
    iterations: iter,
    maxFlowChange: maxDeltaQ,
    nodeHeads,
    nodePressures,
    linkFlows,
    linkVelocities,
    linkHeadLosses,
  };
}

/**
 * In-place Cholesky decomposition LL^T = M and solve LL^T x = b
 * for symmetric positive-definite hydraulic matrix M in flat row-major order.
 * L and y are scratch buffers to eliminate heap allocations.
 */
function solveCholeskyFlat(
  M: Float64Array,
  b: Float64Array,
  x: Float64Array,
  n: number,
  L: Float64Array,
  y: Float64Array,
): void {
  L.fill(0);
  // Factorization: compute L row by row
  for (let i = 0; i < n; i++) {
    const rowOffset = i * n;
    for (let j = 0; j <= i; j++) {
      let sum = 0.0;
      const jRowOffset = j * n;
      for (let k = 0; k < j; k++) {
        sum += L[rowOffset + k]! * L[jRowOffset + k]!;
      }

      if (i === j) {
        const val = M[rowOffset + i]! - sum;
        // Protect against numerical zero / near singular isolated nodes
        L[rowOffset + j] = Math.sqrt(Math.max(1e-12, val));
      } else {
        const diag = L[jRowOffset + j]!;
        L[rowOffset + j] = diag > 1e-12 ? (M[rowOffset + j]! - sum) / diag : 0.0;
      }
    }
  }

  // Forward substitution: L * y = b
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    const rowOffset = i * n;
    for (let j = 0; j < i; j++) {
      sum -= L[rowOffset + j]! * y[j]!;
    }
    const diag = L[rowOffset + i]!;
    y[i] = diag > 1e-12 ? sum / diag : 0.0;
  }

  // Back substitution: L^T * x = y
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= L[j * n + i]! * x[j]!;
    }
    const diag = L[i * n + i]!;
    x[i] = diag > 1e-12 ? sum / diag : 0.0;
  }
}
