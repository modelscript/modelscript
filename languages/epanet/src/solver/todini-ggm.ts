// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Todini Global Gradient Method (GGM) Hydraulic Solver.
 *
 * Implements the standard Todini & Pilati (1988) Global Gradient Algorithm
 * for steady-state pressure and flow convergence in municipal water networks.
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
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
  /** Whether to execute Cholesky linear solves via native WebAssembly kernel. Default: false. */
  useWasm?: boolean | undefined;
}

interface WasmCholeskyExports {
  memory?: WebAssembly.Memory | undefined;
  ukf_cholesky?: ((n: number, mPtr: number, lPtr: number) => number) | undefined;
  atomicChunkAlloc?: ((bytes: number) => number) | undefined;
  atomicChunkFree?: ((ptr: number) => void) | undefined;
}

interface HydraulicLink {
  id: string;
  kind: "PIPE" | "PUMP" | "VALVE";
  node1: string;
  node2: string;
  length: number;
  diameterM: number;
  roughness: number;
  minorLoss: number;
  // Precomputed Hazen-Williams coefficient r_p in (m / (L/s)^1.852)
  rHw: number;
  // Minor loss coefficient r_m in (m / (L/s)^2)
  rMinor: number;
  // Pump curve parameters: h_gain(Q) = h0 - rPump * Q^nu (head loss = -h_gain)
  pumpH0: number;
  pumpR: number;
  pumpNu: number;
  pumpPowerKw: number;
  // Valve parameters
  valveType: string;
  valveSetting: number;
}

export function solveHydraulics(
  net: EpanetNetwork,
  options?: EpanetSolverOptions | number,
  tolParam?: number,
): EpanetHydraulicResult {
  let maxIterations = 50;
  let tolerance = 1e-4;
  let useWasm = false;

  if (typeof options === "number") {
    maxIterations = options;
    if (typeof tolParam === "number") tolerance = tolParam;
  } else if (options && typeof options === "object") {
    if (options.maxIterations !== undefined) maxIterations = options.maxIterations;
    if (options.tolerance !== undefined) tolerance = options.tolerance;
    if (options.useWasm !== undefined) useWasm = options.useWasm;
  }
  const wasmExports: WasmCholeskyExports | null = useWasm
    ? (getDefaultWasmExports() as WasmCholeskyExports | null)
    : null;
  const junctions = net.junctions;
  const reservoirs = net.reservoirs;
  const openPipes = net.pipes.filter((p) => p.status !== "CLOSED");
  const openPumps = (net.pumps ?? []).filter((p) => p.status !== "CLOSED");
  const openValves = net.valves ?? [];

  const numJunctions = junctions.length;
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

  const headlossFormula = net.options?.headloss ?? "H-W";
  const viscosity = (net.options?.viscosity ?? 1.0) * 1.004e-6; // m^2/s
  const G_ACCEL = 9.80665;
  const nExp = 1.852;

  const curveMap = new Map<string, { x: number; y: number }[]>();
  for (const c of net.curves ?? []) {
    curveMap.set(c.id.toLowerCase(), c.points);
  }

  const links: HydraulicLink[] = [];

  for (const pipe of openPipes) {
    const L = Math.max(1.0, pipe.length);
    const D = pipe.diameter > 5.0 ? pipe.diameter / 1000.0 : Math.max(0.01, pipe.diameter);
    const C = Math.max(10.0, pipe.roughness);
    const rSI = (10.67 * L) / (Math.pow(C, 1.852) * Math.pow(D, 4.87));
    const rHw = rSI / Math.pow(1000.0, nExp);
    const kMin = Math.max(0.0, pipe.minorLoss ?? 0.0);
    const rMinor = kMin > 0 ? (8.0 * kMin) / (Math.PI * Math.PI * G_ACCEL * Math.pow(D, 4.0) * 1e6) : 0.0;

    links.push({
      id: pipe.id,
      kind: "PIPE",
      node1: pipe.node1,
      node2: pipe.node2,
      length: L,
      diameterM: D,
      roughness: pipe.roughness,
      minorLoss: kMin,
      rHw,
      rMinor,
      pumpH0: 0,
      pumpR: 0,
      pumpNu: 2.0,
      pumpPowerKw: 0,
      valveType: "",
      valveSetting: 0,
    });
  }

  for (const pump of openPumps) {
    const speed = Math.max(0.1, pump.speed ?? 1.0);
    let h0 = 50.0;
    let rPump = 0.005;
    let nu = 2.0;

    if (pump.headCurveId) {
      const pts = curveMap.get(pump.headCurveId.toLowerCase());
      if (pts && pts.length === 1) {
        const qDes = Math.max(1.0, pts[0]!.x);
        const hDes = Math.max(1.0, pts[0]!.y);
        h0 = (4.0 / 3.0) * hDes;
        rPump = hDes / (3.0 * qDes * qDes);
      } else if (pts && pts.length >= 2) {
        const p0 = pts[0]!;
        const pLast = pts[pts.length - 1]!;
        if (p0.x === 0 && pLast.x > 0) {
          h0 = Math.max(1.0, p0.y);
          rPump = Math.max(1e-6, (h0 - pLast.y) / Math.pow(pLast.x, 2.0));
        } else {
          const qMid = Math.max(1.0, p0.x);
          const hMid = Math.max(1.0, p0.y);
          h0 = (4.0 / 3.0) * hMid;
          rPump = hMid / (3.0 * qMid * qMid);
        }
      }
    }

    h0 = h0 * speed * speed;
    rPump = rPump * Math.pow(speed, 2.0 - nu);

    links.push({
      id: pump.id,
      kind: "PUMP",
      node1: pump.node1,
      node2: pump.node2,
      length: 1.0,
      diameterM: 0.2,
      roughness: 100.0,
      minorLoss: 0.0,
      rHw: 0.0,
      rMinor: 0.0,
      pumpH0: h0,
      pumpR: rPump,
      pumpNu: nu,
      pumpPowerKw: pump.power ?? 0.0,
      valveType: "",
      valveSetting: 0,
    });
  }

  for (const valve of openValves) {
    const D = valve.diameter > 5.0 ? valve.diameter / 1000.0 : Math.max(0.01, valve.diameter);
    const kMin = Math.max(0.0, valve.minorLoss ?? 0.0);
    const rMinor = kMin > 0 ? (8.0 * kMin) / (Math.PI * Math.PI * G_ACCEL * Math.pow(D, 4.0) * 1e6) : 0.0;

    links.push({
      id: valve.id,
      kind: "VALVE",
      node1: valve.node1,
      node2: valve.node2,
      length: Math.max(1.0, 2.0 * D),
      diameterM: D,
      roughness: 130.0,
      minorLoss: kMin,
      rHw: 1e-6,
      rMinor,
      pumpH0: 0,
      pumpR: 0,
      pumpNu: 2.0,
      pumpPowerKw: 0,
      valveType: valve.type.toUpperCase(),
      valveSetting: valve.setting,
    });
  }

  const numLinks = links.length;

  // Node Index Mapping
  const juncIndex = new Map<string, number>();
  junctions.forEach((j, idx) => juncIndex.set(j.id.toLowerCase(), idx));

  const juncElevMap = new Map<string, number>();
  junctions.forEach((j) => juncElevMap.set(j.id.toLowerCase(), j.elevation));

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

  // Unknown link flows vector Q (dimension numLinks)
  const Q = new Float64Array(numLinks);
  for (let p = 0; p < numLinks; p++) {
    const lnk = links[p]!;
    if (lnk.kind === "VALVE" && lnk.valveType === "FCV" && lnk.valveSetting > 0) {
      Q[p] = lnk.valveSetting;
    } else {
      Q[p] = 10.0; // initial seed flow 10 L/s
    }
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
  const A11_inv = new Float64Array(numLinks);
  const pipeHeadLoss = new Float64Array(numLinks);
  const RHS = new Float64Array(numJunctions);
  const H_new = new Float64Array(numJunctions);
  const M_flat = new Float64Array(numJunctions * numJunctions);
  const LScratch = new Float64Array(numJunctions * numJunctions);
  const yScratch = new Float64Array(numJunctions);

  const computeLinkHydraulics = (
    lnk: HydraulicLink,
    qVal: number,
    h1Curr: number,
    h2Curr: number,
  ): { hLoss: number; gTerm: number } => {
    const qAbs = Math.max(0.001, Math.abs(qVal));
    const qSign = qVal >= 0 ? 1.0 : -1.0;

    if (lnk.kind === "PUMP") {
      if (lnk.pumpPowerKw > 0 && !lnk.pumpH0) {
        // Constant power pump: h_gain = (1000 * P_kW) / (rho * g * Q_m3s) = (1000 * P_kW) / (9.80665 * Q_Lps)
        const qSafe = Math.max(0.5, qAbs);
        const hGain = (1000.0 * lnk.pumpPowerKw) / (G_ACCEL * qSafe);
        const gTerm = (1000.0 * lnk.pumpPowerKw) / (G_ACCEL * qSafe * qSafe);
        return { hLoss: -hGain, gTerm: Math.max(1e-4, gTerm) };
      }
      // Pump curve: h_gain = h0 - r * |Q|^nu => head loss H1 - H2 = -h0 + r * |Q|^nu
      const hLoss = -lnk.pumpH0 + qSign * lnk.pumpR * Math.pow(qAbs, lnk.pumpNu);
      const gTerm = lnk.pumpNu * lnk.pumpR * Math.pow(qAbs, lnk.pumpNu - 1.0);
      return { hLoss, gTerm: Math.max(1e-4, gTerm) };
    }

    if (lnk.kind === "VALVE") {
      const D = lnk.diameterM;
      if (lnk.valveType === "TCV") {
        const kTot = Math.max(0.1, lnk.valveSetting + lnk.minorLoss);
        const rTcv = (8.0 * kTot) / (Math.PI * Math.PI * G_ACCEL * Math.pow(D, 4.0) * 1e6);
        const hLoss = qSign * rTcv * qAbs * qAbs;
        const gTerm = 2.0 * rTcv * qAbs;
        return { hLoss, gTerm: Math.max(1e-5, gTerm) };
      }
      if (lnk.valveType === "PBV") {
        // Pressure breaker valve: fixed head drop = setting (m)
        const rOpen = Math.max(1e-5, lnk.rMinor + 1e-4);
        const hLoss = lnk.valveSetting + qSign * rOpen * qAbs;
        return { hLoss, gTerm: rOpen };
      }
      if (lnk.valveType === "FCV") {
        // Flow control valve: limits flow to valveSetting (L/s)
        const qSet = Math.max(0.001, lnk.valveSetting);
        if (qVal > qSet) {
          const rHigh = 1e4;
          const hLoss = h1Curr - h2Curr + rHigh * (qVal - qSet);
          return { hLoss, gTerm: rHigh };
        }
        const rOpen = Math.max(1e-5, lnk.rMinor + 1e-4);
        return { hLoss: qSign * rOpen * qAbs * qAbs, gTerm: Math.max(1e-5, 2.0 * rOpen * qAbs) };
      }
      if (lnk.valveType === "PRV") {
        // Pressure reducing valve: limits downstream pressure head P2 = H2 - elev2 <= setting
        const elev2 = juncElevMap.get(lnk.node2.toLowerCase()) ?? 0.0;
        const hSet = elev2 + lnk.valveSetting;
        if (h1Curr > hSet) {
          // Active PRV: introduce head drop so H2 -> hSet
          const targetDrop = Math.max(0.0, h1Curr - hSet);
          const rOpen = Math.max(1e-4, lnk.rMinor + 1e-3);
          const hLoss = targetDrop + rOpen * (qVal - 10.0) * 0.01;
          return { hLoss, gTerm: Math.max(0.05, targetDrop / Math.max(1.0, qAbs)) };
        }
      }
      const rVal = Math.max(1e-5, lnk.rMinor + 1e-5);
      return { hLoss: qSign * rVal * qAbs * qAbs, gTerm: Math.max(1e-5, 2.0 * rVal * qAbs) };
    }

    // PIPE: Hazen-Williams or Darcy-Weisbach + Minor Loss
    let hFric = 0.0;
    let gFric = 0.0;

    if (headlossFormula === "D-W") {
      const D = lnk.diameterM;
      const area = (Math.PI * D * D) / 4.0;
      const v = qAbs / 1000.0 / Math.max(1e-6, area);
      const Re = (v * D) / Math.max(1e-9, viscosity);
      // Roughness epsilon in meters (EPANET D-W roughness is in mm when > 0.05, or m)
      const epsM = lnk.roughness > 0.05 ? lnk.roughness / 1000.0 : lnk.roughness;
      let fDarcy: number;
      if (Re < 2000.0) {
        fDarcy = 64.0 / Math.max(10.0, Re);
      } else {
        // Swamee-Jain approximation for Colebrook-White
        const term = epsM / (3.7 * D) + 5.74 / Math.pow(Re, 0.9);
        const logTerm = Math.log10(Math.max(1e-12, term));
        fDarcy = 0.25 / (logTerm * logTerm);
      }
      const rDw = (8.0 * fDarcy * lnk.length) / (Math.PI * Math.PI * G_ACCEL * Math.pow(D, 5.0) * 1e6);
      hFric = qSign * rDw * qAbs * qAbs;
      gFric = 2.0 * rDw * qAbs;
    } else {
      hFric = qSign * lnk.rHw * Math.pow(qAbs, nExp);
      gFric = nExp * lnk.rHw * Math.pow(qAbs, nExp - 1.0);
    }

    const hMin = qSign * lnk.rMinor * qAbs * qAbs;
    const gMin = 2.0 * lnk.rMinor * qAbs;

    return {
      hLoss: hFric + hMin,
      gTerm: Math.max(1e-7, gFric + gMin),
    };
  };

  // Newton-Raphson / Global Gradient Method Iterations
  while (iter < maxIterations) {
    iter++;

    // 1. Build Diagonal matrix A11_inv and gradient flow elements
    for (let p = 0; p < numLinks; p++) {
      const lnk = links[p]!;
      const n1 = lnk.node1.toLowerCase();
      const n2 = lnk.node2.toLowerCase();
      const h1Curr = juncIndex.has(n1) ? H[juncIndex.get(n1)!]! : (resMap.get(n1) ?? refHead);
      const h2Curr = juncIndex.has(n2) ? H[juncIndex.get(n2)!]! : (resMap.get(n2) ?? refHead);

      const { hLoss, gTerm } = computeLinkHydraulics(lnk, Q[p] ?? 0, h1Curr, h2Curr);
      A11_inv[p] = 1.0 / gTerm;
      pipeHeadLoss[p] = hLoss;
    }

    // 2. Build Junction Matrix M = A12^T * A11_inv * A12 (flat numJunctions x numJunctions)
    M_flat.fill(0);

    // Initial RHS = -qDemand
    for (let j = 0; j < numJunctions; j++) {
      RHS[j] = -qDemand[j]!;
    }

    for (let p = 0; p < numLinks; p++) {
      const lnk = links[p]!;
      const dVal = A11_inv[p]!;
      const n1 = lnk.node1.toLowerCase();
      const n2 = lnk.node2.toLowerCase();

      const j1 = juncIndex.get(n1);
      const j2 = juncIndex.get(n2);
      const h1Fixed = resMap.get(n1);
      const h2Fixed = resMap.get(n2);

      const hLoss = pipeHeadLoss[p]!;
      const qFlow = Q[p]!;

      // Contribution to M and RHS
      if (j1 !== undefined && j2 !== undefined) {
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
        const idx11 = j1 * numJunctions + j1;
        M_flat[idx11] = (M_flat[idx11] ?? 0) + dVal;
        RHS[j1] = (RHS[j1] ?? 0) - (qFlow - dVal * (hLoss + h2Fixed));
      } else if (j2 !== undefined && h1Fixed !== undefined) {
        const idx22 = j2 * numJunctions + j2;
        M_flat[idx22] = (M_flat[idx22] ?? 0) + dVal;
        RHS[j2] = (RHS[j2] ?? 0) + (qFlow - dVal * (hLoss - h1Fixed));
      }
    }

    // 3. Solve SPD linear system M * H_new = RHS via Cholesky decomposition
    let solved = false;
    if (wasmExports) {
      solved = solveCholeskyWasm(wasmExports, M_flat, RHS, H_new, numJunctions, yScratch);
    }
    if (!solved) {
      solveCholeskyFlat(M_flat, RHS, H_new, numJunctions, LScratch, yScratch);
    }

    // Enforce active PRV downstream head cap if PRV discharges directly into a junction
    for (let p = 0; p < numLinks; p++) {
      const lnk = links[p]!;
      if (lnk.kind === "VALVE" && lnk.valveType === "PRV") {
        const n1 = lnk.node1.toLowerCase();
        const n2 = lnk.node2.toLowerCase();
        const h1 = juncIndex.has(n1) ? H_new[juncIndex.get(n1)!]! : (resMap.get(n1) ?? refHead);
        const j2 = juncIndex.get(n2);
        const elev2 = juncElevMap.get(n2) ?? 0.0;
        const hSet = elev2 + lnk.valveSetting;
        if (j2 !== undefined && h1 > hSet && H_new[j2]! > hSet) {
          H_new[j2] = hSet;
        }
      }
    }

    // 4. Update link flows Q and check convergence
    maxDeltaQ = 0.0;
    for (let p = 0; p < numLinks; p++) {
      const lnk = links[p]!;
      const n1 = lnk.node1.toLowerCase();
      const n2 = lnk.node2.toLowerCase();

      const h1 = juncIndex.has(n1) ? H_new[juncIndex.get(n1)!]! : (resMap.get(n1) ?? refHead);
      const h2 = juncIndex.has(n2) ? H_new[juncIndex.get(n2)!]! : (resMap.get(n2) ?? refHead);

      const deltaH = h1 - h2;
      const dVal = A11_inv[p]!;
      const hLoss = pipeHeadLoss[p]!;
      let newQ = Q[p]! - dVal * (hLoss - deltaH);

      if (lnk.kind === "VALVE" && lnk.valveType === "FCV" && lnk.valveSetting > 0 && newQ > lnk.valveSetting) {
        newQ = lnk.valveSetting;
      }

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

  for (let p = 0; p < numLinks; p++) {
    const lnk = links[p]!;
    const flow = Q[p]!;
    const D = lnk.diameterM;
    const area = (Math.PI * D * D) / 4.0;
    const flowSI = flow / 1000.0; // m^3/s
    const velocity = area > 0 ? flowSI / area : 0.0;
    const n1 = lnk.node1.toLowerCase();
    const n2 = lnk.node2.toLowerCase();
    const h1 = juncIndex.has(n1) ? H[juncIndex.get(n1)!]! : (resMap.get(n1) ?? refHead);
    const h2 = juncIndex.has(n2) ? H[juncIndex.get(n2)!]! : (resMap.get(n2) ?? refHead);
    const { hLoss } = computeLinkHydraulics(lnk, flow, h1, h2);

    linkFlows.set(lnk.id, flow);
    linkVelocities.set(lnk.id, velocity);
    linkHeadLosses.set(lnk.id, hLoss);
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

/**
 * Solves SPD linear system M * x = b using WebAssembly Cholesky factorization in linear memory.
 */
function solveCholeskyWasm(
  wasm: WasmCholeskyExports | null,
  M: Float64Array,
  b: Float64Array,
  x: Float64Array,
  n: number,
  yScratch: Float64Array,
): boolean {
  if (!wasm || typeof wasm.ukf_cholesky !== "function" || !wasm.memory) {
    return false;
  }

  const matBytes = (n * n * 8 + 7) & ~7;
  const lBytes = (n * n * 8 + 7) & ~7;
  const totalBytes = matBytes + lBytes;

  const hasAlloc = typeof wasm.atomicChunkAlloc === "function";
  const basePtr = typeof wasm.atomicChunkAlloc === "function" ? wasm.atomicChunkAlloc(totalBytes) : 1024;
  if (!basePtr) return false;

  const mPtr = basePtr;
  const lPtr = mPtr + matBytes;

  try {
    const memory: WebAssembly.Memory = wasm.memory;
    const memF64 = new Float64Array(memory.buffer);
    memF64.set(M, mPtr >>> 3);

    const status = wasm.ukf_cholesky(n, mPtr, lPtr);
    if (status !== 1) return false;

    // Read computed lower-triangular L factor directly from WebAssembly linear memory
    const L = new Float64Array(memory.buffer, lPtr, n * n);

    // Forward substitution: L * y = b
    for (let i = 0; i < n; i++) {
      let sum = b[i]!;
      const rowOffset = i * n;
      for (let j = 0; j < i; j++) {
        sum -= L[rowOffset + j]! * yScratch[j]!;
      }
      const diag = L[rowOffset + i]!;
      yScratch[i] = diag > 1e-12 ? sum / diag : 0.0;
    }

    // Back substitution: L^T * x = y
    for (let i = n - 1; i >= 0; i--) {
      let sum = yScratch[i]!;
      for (let j = i + 1; j < n; j++) {
        sum -= L[j * n + i]! * x[j]!;
      }
      const diag = L[i * n + i]!;
      x[i] = diag > 1e-12 ? sum / diag : 0.0;
    }
    return true;
  } catch {
    return false;
  } finally {
    if (hasAlloc && typeof wasm.atomicChunkFree === "function") {
      wasm.atomicChunkFree(basePtr);
    }
  }
}
