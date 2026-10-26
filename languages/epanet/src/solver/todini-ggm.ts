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

  // Newton-Raphson / Global Gradient Method Iterations
  while (iter < maxIterations) {
    iter++;

    // 1. Build Diagonal matrix A11_inv and gradient flow elements
    // For pipe p: A11[p] = n * r_p * |Q_p|^(n-1)
    const A11_inv = new Float64Array(numPipes);
    const pipeHeadLoss = new Float64Array(numPipes);

    for (let p = 0; p < numPipes; p++) {
      const qVal = Q[p] ?? 0;
      const qAbs = Math.max(0.001, Math.abs(qVal));
      const gTerm = nExp * rCoeff[p]! * Math.pow(qAbs, nExp - 1.0);
      A11_inv[p] = 1.0 / Math.max(1e-7, gTerm);
      pipeHeadLoss[p] = Math.sign(qVal) * rCoeff[p]! * Math.pow(qAbs, nExp);
    }

    // 2. Build Junction Matrix M = A12^T * A11_inv * A12 (numJunctions x numJunctions)
    // and RHS vector
    const M: number[][] = Array.from({ length: numJunctions }, () => new Array(numJunctions).fill(0));
    const RHS = new Float64Array(numJunctions);

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
        M[j1]![j1]! += dVal;
        M[j2]![j2]! += dVal;
        M[j1]![j2]! -= dVal;
        M[j2]![j1]! -= dVal;

        const term = qFlow - dVal * hLoss;
        RHS[j1] = (RHS[j1] ?? 0) - term;
        RHS[j2] = (RHS[j2] ?? 0) + term;
      } else if (j1 !== undefined && h2Fixed !== undefined) {
        // Node 1 is junction, Node 2 is fixed reservoir/tank
        M[j1]![j1]! += dVal;
        RHS[j1] = (RHS[j1] ?? 0) - (qFlow - dVal * (hLoss + h2Fixed));
      } else if (j2 !== undefined && h1Fixed !== undefined) {
        // Node 2 is junction, Node 1 is fixed reservoir/tank
        M[j2]![j2]! += dVal;
        RHS[j2] = (RHS[j2] ?? 0) + (qFlow - dVal * (hLoss - h1Fixed));
      }
    }

    // 3. Solve linear system M * H_new = RHS via Gaussian elimination
    const H_new = solveLinearSystem(M, RHS);

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
 * Standard Gaussian elimination with partial pivoting for small-to-medium SPD hydraulic matrices.
 */
function solveLinearSystem(A: number[][], b: Float64Array): Float64Array {
  const n = b.length;
  // Copy A and b
  const M: number[][] = A.map((row) => [...row]);
  const x = new Float64Array(b);

  for (let k = 0; k < n; k++) {
    // Partial pivot
    let maxRow = k;
    let maxVal = Math.abs(M[k]![k]!);
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i]![k]!) > maxVal) {
        maxVal = Math.abs(M[i]![k]!);
        maxRow = i;
      }
    }

    if (maxRow !== k) {
      const tempRow = M[k]!;
      M[k] = M[maxRow]!;
      M[maxRow] = tempRow;
      const tempB = x[k]!;
      x[k] = x[maxRow]!;
      x[maxRow] = tempB;
    }

    const diag = M[k]![k]!;
    if (Math.abs(diag) < 1e-12) continue; // Singular or decoupled node

    for (let i = k + 1; i < n; i++) {
      const factor = M[i]![k]! / diag;
      for (let j = k; j < n; j++) {
        M[i]![j]! -= factor * M[k]![j]!;
      }
      x[i] = (x[i] ?? 0) - factor * (x[k] ?? 0);
    }
  }

  // Back substitution
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= M[i]![j]! * x[j]!;
    }
    const diag = M[i]![i]!;
    x[i] = Math.abs(diag) > 1e-12 ? sum / diag : 0.0;
  }

  return x;
}
