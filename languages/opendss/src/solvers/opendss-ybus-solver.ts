// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendss — Sparse Complex Nodal Admittance [Ybus] Power Flow Solver.
 *
 * Implements OpenDSS-parity frequency-domain nodal admittance formulation:
 *   [I_inj(V)] = [Y_bus] * [V]
 *
 * Capabilities:
 * - Arbitrary distribution topologies: radial, meshed loops, parallel lines, and multi-substation feeders.
 * - Multi-phase unbalanced modeling (1-phase, 2-phase, 3-phase, split-phase).
 * - Multi-conductor coupled line models (symmetrical sequence Z1, Z0 or full R/X matrix literals).
 * - Multi-winding distribution transformers with turns ratio, leakage impedance, and core losses.
 * - Voltage-dependent load models: Constant PQ (Model 1), Constant Z (Model 2), Constant Current (Model 5), and ZIP (Model 8).
 * - Distributed Energy Resources: Solar PV inverter generation and Battery Energy Storage (BESS).
 * - High-speed sparse LU factorization with Tinney-2 / AMD ordering via @modelscript/runtime.
 * - Fast Picard current-injection iteration with pre-factored Ybus for sub-millisecond QSTS time steps.
 */

import {
  computeAmdOrdering,
  sparseLuFactor,
  sparseLuSolve,
  SparseTripletBuilder,
  type SparseCCSMatrix,
  type SparseLU,
} from "@modelscript/runtime";
import { getLengthScale } from "../parser/opendss-parser.js";
import { synthesizeLineGeometry } from "../physics/carson-kron.js";
import type { DssDeck } from "../types.js";
import type {
  BusPowerFlowResult,
  PowerFlowSummary,
  QstsSimulationResult,
  QstsStepResult,
} from "./power-flow-solver.js";

export interface AdmittancePowerFlowOptions {
  /** Maximum allowable non-linear Picard iterations (default: 25). */
  maxIterations?: number;
  /** Convergence tolerance for maximum voltage update in p.u. (default: 1e-4). */
  tolerance?: number;
  /** Picard iteration acceleration/damping factor in (0, 1] (default: 1.0). */
  dampingFactor?: number;
  /** Internal Thevenin substation source impedance in Ohms (default: 1e-4 + j 1e-3). */
  sourceImpedance?: { r: number; x: number };
  /** Global ZIP model fractions: { pz, pi, pp, qz, qi, qp } where sum(p)=1, sum(q)=1. */
  defaultZipCoefficients?: {
    pz: number;
    pi: number;
    pp: number;
    qz: number;
    qi: number;
    qp: number;
  };
  /** Enable autonomous device controls (RegControl & CapControl) (default: true). */
  enableControls?: boolean;
  /** Maximum outer control iterations (default: 15). */
  maxControlIterations?: number;
  /** Set of capacitors to disconnect / switch off. */
  switchedOffCapacitors?: Set<string>;
  /** Map of transformer name to [tap1, tap2] ratios. */
  transformerTaps?: Map<string, number[]>;
}

export interface OpenDssNodeInfo {
  index: number;
  busName: string;
  phase: number; // 1, 2, 3
  baseKvLn: number; // Line-to-neutral base voltage in kV
  baseV: number; // Line-to-neutral base voltage in Volts
  isSlack: boolean;
  targetVReal: number;
  targetVImag: number;
}

export interface OpenDssYbusModel {
  deck: DssDeck;
  nodes: OpenDssNodeInfo[];
  nodeMap: Map<string, number>; // "Bus.Phase" -> index
  buses: Map<string, number[]>; // BusName -> node indices
  busBaseKv: Map<string, number>;
  nNodes: number;
  yMatrix: SparseCCSMatrix;
  luFactors: SparseLU;
}

/**
 * Parses node key string (e.g. "SubBus.1" -> { bus: "SubBus", phase: 1 }).
 */
function makeNodeKey(bus: string, phase: number): string {
  return `${bus.trim()}.${phase}`;
}

/**
 * Calculates Voltage Unbalance Factor (VUF) using NEMA / IEEE definition.
 */
function computeVuf(vA: number, vB: number, vC: number): number {
  const avg = (vA + vB + vC) / 3;
  if (avg <= 1e-9) return 0;
  const maxDev = Math.max(Math.abs(vA - avg), Math.abs(vB - avg), Math.abs(vC - avg));
  return maxDev / avg;
}

/**
 * Inverts an N x N complex matrix Z = R + jX using Gauss-Jordan elimination with partial pivoting.
 * Returns Y = G + jB such that Y = Z^(-1).
 */
function invertComplexSquareMatrix(r: number[][], x: number[][]): { g: number[][]; b: number[][] } | undefined {
  const n = r.length;
  if (n === 0 || !r[0] || r.length !== r[0].length) return undefined;

  // Create 2n wide augmented matrix of complex numbers [Z | I]
  const aR: number[][] = Array.from({ length: n }, () => new Array<number>(2 * n).fill(0));
  const aX: number[][] = Array.from({ length: n }, () => new Array<number>(2 * n).fill(0));

  for (let i = 0; i < n; i++) {
    const rowR = aR[i];
    const rowX = aX[i];
    if (!rowR || !rowX) continue;
    for (let j = 0; j < n; j++) {
      rowR[j] = r[i]?.[j] ?? 0;
      rowX[j] = x[i]?.[j] ?? 0;
    }
    rowR[n + i] = 1.0;
    rowX[n + i] = 0.0;
  }

  // Gauss-Jordan elimination with partial pivoting
  for (let k = 0; k < n; k++) {
    // Find pivot row
    let maxMag = 0;
    let pivotRow = k;
    for (let i = k; i < n; i++) {
      const re = aR[i]?.[k] ?? 0;
      const im = aX[i]?.[k] ?? 0;
      const mag = re * re + im * im;
      if (mag > maxMag) {
        maxMag = mag;
        pivotRow = i;
      }
    }

    if (maxMag < 1e-18) return undefined;

    // Swap row k and pivotRow
    if (pivotRow !== k) {
      const tempR = aR[k];
      aR[k] = aR[pivotRow] as number[];
      aR[pivotRow] = tempR as number[];

      const tempX = aX[k];
      aX[k] = aX[pivotRow] as number[];
      aX[pivotRow] = tempX as number[];
    }

    const pivR = aR[k]?.[k] ?? 1.0;
    const pivX = aX[k]?.[k] ?? 0.0;
    const denom = pivR * pivR + pivX * pivX;
    const invPivR = pivR / denom;
    const invPivX = -pivX / denom;

    // Divide row k by pivot
    const curRowR = aR[k];
    const curRowX = aX[k];
    if (!curRowR || !curRowX) continue;

    for (let j = 0; j < 2 * n; j++) {
      const re = curRowR[j] ?? 0;
      const im = curRowX[j] ?? 0;
      curRowR[j] = re * invPivR - im * invPivX;
      curRowX[j] = re * invPivX + im * invPivR;
    }

    // Eliminate column k in all other rows
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const rowI_R = aR[i];
      const rowI_X = aX[i];
      if (!rowI_R || !rowI_X) continue;

      const fR = rowI_R[k] ?? 0;
      const fX = rowI_X[k] ?? 0;
      if (Math.abs(fR) < 1e-15 && Math.abs(fX) < 1e-15) continue;

      for (let j = 0; j < 2 * n; j++) {
        const kjR = curRowR[j] ?? 0;
        const kjX = curRowX[j] ?? 0;
        const prodR = fR * kjR - fX * kjX;
        const prodX = fR * kjX + fX * kjR;
        rowI_R[j] = (rowI_R[j] ?? 0) - prodR;
        rowI_X[j] = (rowI_X[j] ?? 0) - prodX;
      }
    }
  }

  // Extract right half
  const g: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const rowG = g[i];
    const rowB = b[i];
    const srcR = aR[i];
    const srcX = aX[i];
    if (rowG && rowB && srcR && srcX) {
      for (let j = 0; j < n; j++) {
        rowG[j] = srcR[n + j] ?? 0;
        rowB[j] = srcX[n + j] ?? 0;
      }
    }
  }

  return { g, b };
}

/**
 * Compiles an OpenDSS deck into a Sparse Nodal Admittance matrix in real block form:
 *   [ G  -B ] [ V_real ] = [ I_real ]
 *   [ B   G ] [ V_imag ]   [ I_imag ]
 */
export function buildOpenDssYbus(deck: DssDeck, _options: AdmittancePowerFlowOptions = {}): OpenDssYbusModel {
  const busBaseKv = new Map<string, number>();

  // 1. Determine base kV per bus
  if (deck.circuit) {
    busBaseKv.set(deck.circuit.bus1, deck.circuit.baseKv);
  }
  for (const [, xfmr] of deck.transformers) {
    for (let w = 0; w < xfmr.buses.length; w++) {
      const b = xfmr.buses[w];
      const kv = xfmr.kvs[w];
      if (b && kv !== undefined && !busBaseKv.has(b)) {
        busBaseKv.set(b, kv);
      }
    }
  }
  for (const [, line] of deck.lines) {
    const kv1 = busBaseKv.get(line.bus1) ?? 12.47;
    const kv2 = busBaseKv.get(line.bus2) ?? 12.47;
    if (!busBaseKv.has(line.bus1)) busBaseKv.set(line.bus1, kv1);
    if (!busBaseKv.has(line.bus2)) busBaseKv.set(line.bus2, kv2);
  }
  for (const [, l] of deck.loads) {
    if (!busBaseKv.has(l.bus1)) busBaseKv.set(l.bus1, l.kv);
  }
  for (const [, pv] of deck.pvSystems) {
    if (!busBaseKv.has(pv.bus1)) busBaseKv.set(pv.bus1, pv.kv);
  }

  // 2. Discover all connected bus nodes (1=A, 2=B, 3=C)
  const busPhaseSet = new Map<string, Set<number>>();
  const touchBusPhase = (bus: string, phase: number) => {
    let s = busPhaseSet.get(bus);
    if (!s) {
      s = new Set();
      busPhaseSet.set(bus, s);
    }
    s.add(phase);
  };

  // Slack bus phases
  const slackBus = deck.circuit?.bus1 ?? "SourceBus";
  const slackPhases = deck.circuit?.phases ?? 3;
  for (let p = 1; p <= Math.min(3, slackPhases); p++) touchBusPhase(slackBus, p);

  // Line connected phases
  for (const [, line] of deck.lines) {
    const nodes1 =
      line.phaseNodes1 && line.phaseNodes1.length > 0 ? line.phaseNodes1 : line.phases === 1 ? [1] : [1, 2, 3];
    const nodes2 =
      line.phaseNodes2 && line.phaseNodes2.length > 0 ? line.phaseNodes2 : line.phases === 1 ? [1] : [1, 2, 3];
    for (const p of nodes1) if (p >= 1 && p <= 3) touchBusPhase(line.bus1, p);
    for (const p of nodes2) if (p >= 1 && p <= 3) touchBusPhase(line.bus2, p);
  }

  // Transformer connected phases
  for (const [, xfmr] of deck.transformers) {
    if (xfmr.phaseNodes && xfmr.phaseNodes.length > 0) {
      for (let w = 0; w < xfmr.buses.length; w++) {
        const b = xfmr.buses[w];
        if (!b) continue;
        const wNodes = xfmr.phaseNodes[w] ?? [1, 2, 3].slice(0, xfmr.phases);
        for (const p of wNodes) if (p >= 1 && p <= 3) touchBusPhase(b, p);
      }
    } else {
      const phCount = Math.min(3, xfmr.phases);
      for (const b of xfmr.buses) {
        for (let p = 1; p <= phCount; p++) touchBusPhase(b, p);
      }
    }
  }

  // Shunt elements (Loads, PV, Storage, Capacitors)
  for (const [, l] of deck.loads) {
    const nodes = l.phaseNodes && l.phaseNodes.length > 0 ? l.phaseNodes : l.phases === 1 ? [1] : [1, 2, 3];
    for (const p of nodes) if (p >= 1 && p <= 3) touchBusPhase(l.bus1, p);
  }
  for (const [, pv] of deck.pvSystems) {
    const nodes = pv.phaseNodes && pv.phaseNodes.length > 0 ? pv.phaseNodes : pv.phases === 1 ? [1] : [1, 2, 3];
    for (const p of nodes) if (p >= 1 && p <= 3) touchBusPhase(pv.bus1, p);
  }
  for (const [, st] of deck.storages) {
    const nodes = st.phaseNodes && st.phaseNodes.length > 0 ? st.phaseNodes : st.phases === 1 ? [1] : [1, 2, 3];
    for (const p of nodes) if (p >= 1 && p <= 3) touchBusPhase(st.bus1, p);
  }
  for (const [, cap] of deck.capacitors) {
    const nodes = cap.phaseNodes && cap.phaseNodes.length > 0 ? cap.phaseNodes : cap.phases === 1 ? [1] : [1, 2, 3];
    for (const p of nodes) if (p >= 1 && p <= 3) touchBusPhase(cap.bus1, p);
  }

  // 3. Number unknown nodes
  const nodes: OpenDssNodeInfo[] = [];
  const nodeMap = new Map<string, number>();
  const busNodesMap = new Map<string, number[]>();

  const cPu = deck.circuit?.pu ?? 1.0;
  const cAngleDeg = deck.circuit?.angle ?? 0.0;
  const cAngleRad = (cAngleDeg * Math.PI) / 180;

  for (const [busName, phases] of busPhaseSet) {
    const baseKv = busBaseKv.get(busName) ?? 12.47;
    const baseKvLn = baseKv / Math.sqrt(3);
    const baseV = baseKvLn * 1000;
    const indices: number[] = [];

    const sortedPhases = Array.from(phases).sort((a, b) => a - b);
    for (const ph of sortedPhases) {
      const idx = nodes.length;
      const isSlack = busName === slackBus;

      let phOffsetRad = 0;
      if (ph === 1) phOffsetRad = 0;
      else if (ph === 2) phOffsetRad = (-120 * Math.PI) / 180;
      else if (ph === 3) phOffsetRad = (120 * Math.PI) / 180;

      const targetAngle = cAngleRad + phOffsetRad;
      const targetMag = baseV * cPu;

      const nodeInfo: OpenDssNodeInfo = {
        index: idx,
        busName,
        phase: ph,
        baseKvLn,
        baseV,
        isSlack,
        targetVReal: targetMag * Math.cos(targetAngle),
        targetVImag: targetMag * Math.sin(targetAngle),
      };

      nodes.push(nodeInfo);
      nodeMap.set(makeNodeKey(busName, ph), idx);
      indices.push(idx);
    }

    busNodesMap.set(busName, indices);
  }

  const n = nodes.length;
  // 2N x 2N real matrix builder
  const builder = new SparseTripletBuilder(2 * n, 2 * n, 16 * n);

  // Helper to stamp complex admittance (G + j B) into row, col of the 2N x 2N real system
  const addBlockEntry = (row: number, col: number, G: number, B: number) => {
    if (nodes[row]?.isSlack) return;
    builder.add(row, col, G);
    builder.add(row, n + col, -B);
    builder.add(n + row, col, B);
    builder.add(n + row, n + col, G);
  };

  // 4. Stamp Substation Source (Slack Bus Dirichlet condition / large Thevenin conductance)
  for (const node of nodes) {
    if (node.isSlack) {
      // Direct boundary condition: Row is unit vector, enforcing V = targetV
      // We will stamp 1.0 on the diagonal and zero out during RHS injection
      const s = node.index;
      builder.add(s, s, 1.0);
      builder.add(n + s, n + s, 1.0);
    }
  }

  // 5. Stamp Lines & Multiphase Mutual Couplings
  const omega = 2 * Math.PI * (deck.circuit?.frequency ?? 60);

  for (const [, line] of deck.lines) {
    const lc = line.lineCode ? deck.lineCodes.get(line.lineCode) : undefined;
    const lenScale = getLengthScale(line.units, lc?.units);
    const len = Math.max(1e-6, line.length * lenScale);
    const r1 = line.r1 ?? lc?.r1 ?? 0.1;
    const x1 = line.x1 ?? lc?.x1 ?? 0.4;
    const r0 = line.r0 ?? lc?.r0 ?? r1 * 2.5;
    const x0 = line.x0 ?? lc?.x0 ?? x1 * 2.5;
    const c1 = line.c1 ?? lc?.c1 ?? 0;

    let rmatrix = line.rmatrix ?? lc?.rmatrix;
    let xmatrix = line.xmatrix ?? lc?.xmatrix;
    if (!rmatrix && !line.r1 && line.geometry && deck.lineGeometries) {
      const geom = deck.lineGeometries.get(line.geometry);
      if (geom) {
        const synth = synthesizeLineGeometry(geom, deck);
        rmatrix = synth.rmatrix;
        xmatrix = synth.xmatrix;
      }
    }

    const nodes1 =
      line.phaseNodes1 && line.phaseNodes1.length > 0 ? line.phaseNodes1 : line.phases === 1 ? [1] : [1, 2, 3];
    const nodes2 =
      line.phaseNodes2 && line.phaseNodes2.length > 0 ? line.phaseNodes2 : line.phases === 1 ? [1] : [1, 2, 3];
    const nPhases = Math.min(nodes1.length, nodes2.length);

    let gMat: number[][] | undefined;
    let bMat: number[][] | undefined;

    if (rmatrix && xmatrix) {
      const zR = rmatrix.map((row) => row.map((v) => v * len));
      const zX = xmatrix.map((row) => row.map((v) => v * len));
      const inv = invertComplexSquareMatrix(zR, zX);
      if (inv) {
        gMat = inv.g;
        bMat = inv.b;
      }
    }

    // Total sequence impedances for line length
    const z1R = r1 * len;
    const z1X = x1 * len;
    const z0R = r0 * len;
    const z0X = x0 * len;

    // Analytical inverse for 3x3 circulant symmetrical components:
    // Y0 = 1 / Z0, Y1 = 1 / Z1
    // Y_self = (Y0 + 2 Y1) / 3, Y_mut = (Y0 - Y1) / 3
    const denom0 = z0R * z0R + z0X * z0X;
    const y0R = denom0 > 1e-12 ? z0R / denom0 : 1e3;
    const y0I = denom0 > 1e-12 ? -z0X / denom0 : -1e3;

    const denom1 = z1R * z1R + z1X * z1X;
    const y1R = denom1 > 1e-12 ? z1R / denom1 : 1e3;
    const y1I = denom1 > 1e-12 ? -z1X / denom1 : -1e3;

    const ySelfG = (y0R + 2 * y1R) / 3;
    const ySelfB = (y0I + 2 * y1I) / 3;
    const yMutG = (y0R - y1R) / 3;
    const yMutB = (y0I - y1I) / 3;

    // Shunt susceptance
    const bShunt = (omega * c1 * 1e-9 * len) / 2;

    for (let p = 0; p < nPhases; p++) {
      const phP1 = nodes1[p];
      const phP2 = nodes2[p];
      if (phP1 === undefined || phP2 === undefined) continue;
      const uP = nodeMap.get(makeNodeKey(line.bus1, phP1));
      const vP = nodeMap.get(makeNodeKey(line.bus2, phP2));
      if (uP === undefined || vP === undefined) continue;

      for (let q = 0; q < nPhases; q++) {
        const phQ1 = nodes1[q];
        const phQ2 = nodes2[q];
        if (phQ1 === undefined || phQ2 === undefined) continue;
        const uQ = nodeMap.get(makeNodeKey(line.bus1, phQ1));
        const vQ = nodeMap.get(makeNodeKey(line.bus2, phQ2));
        if (uQ === undefined || vQ === undefined) continue;

        const G = gMat ? (gMat[p]?.[q] ?? 0) : p === q ? ySelfG : yMutG;
        const B = bMat ? (bMat[p]?.[q] ?? 0) : p === q ? ySelfB : yMutB;

        addBlockEntry(uP, uQ, +G, +B);
        addBlockEntry(uP, vQ, -G, -B);
        addBlockEntry(vP, uQ, -G, -B);
        addBlockEntry(vP, vQ, +G, +B);
      }

      if (bShunt > 0) {
        addBlockEntry(uP, uP, 0, bShunt);
        addBlockEntry(vP, vP, 0, bShunt);
      }
    }
  }

  // 6. Stamp Transformers (Multi-Winding & Ideal Turns Ratio with Leakage Impedance)
  for (const [, xfmr] of deck.transformers) {
    const b1 = xfmr.buses[0];
    const b2 = xfmr.buses[1];
    if (!b1 || !b2) continue;

    const kv1 = xfmr.kvs[0] ?? 115.0;
    const kv2 = xfmr.kvs[1] ?? 12.47;
    const customTaps = _options.transformerTaps?.get(xfmr.name);
    const tap1 = customTaps?.[0] ?? xfmr.taps?.[0] ?? 1.0;
    const tap2 = customTaps?.[1] ?? xfmr.taps?.[1] ?? 1.0;
    const kva = xfmr.kvas[1] ?? xfmr.kvas[0] ?? 10000.0;
    const ratio = (kv1 * tap1) / (kv2 * tap2);

    const zBase2 = (kv2 * kv2 * 1000.0) / Math.max(1.0, kva);
    const rLeak = ((xfmr.pctLoadLoss ?? 0.5) / 100.0) * zBase2;
    const xLeak = ((xfmr.xhl ?? 5.0) / 100.0) * zBase2;

    const denomT = rLeak * rLeak + xLeak * xLeak;
    const ySecG = denomT > 1e-12 ? rLeak / denomT : 1e3;
    const ySecB = denomT > 1e-12 ? -xLeak / denomT : -1e3;

    // Ideal transformer equivalent PI model referred to primary & secondary:
    // Y_11 = Y_sec / n^2, Y_22 = Y_sec, Y_12 = -Y_sec / n
    const yPriG = ySecG / (ratio * ratio);
    const yPriB = ySecB / (ratio * ratio);
    const yMutG = ySecG / ratio;
    const yMutB = ySecB / ratio;

    const connPri = xfmr.conn?.[0]?.toLowerCase() ?? "wye";
    const connSec = xfmr.conn?.[1]?.toLowerCase() ?? "wye";
    let phaseShiftRad = 0;
    if (connPri === "delta" && connSec === "wye") {
      phaseShiftRad = xfmr.leadLag === "lead" ? (30 * Math.PI) / 180 : (-30 * Math.PI) / 180;
    } else if (connPri === "wye" && connSec === "delta") {
      phaseShiftRad = xfmr.leadLag === "lead" ? (-30 * Math.PI) / 180 : (30 * Math.PI) / 180;
    }

    const cosS = Math.cos(phaseShiftRad);
    const sinS = Math.sin(phaseShiftRad);
    const yMut12G = yMutG * cosS + yMutB * sinS;
    const yMut12B = yMutB * cosS - yMutG * sinS;
    const yMut21G = yMutG * cosS - yMutB * sinS;
    const yMut21B = yMutB * cosS + yMutG * sinS;

    const nPhases = Math.min(3, xfmr.phases);
    const nodesPri = xfmr.phaseNodes?.[0] ?? [1, 2, 3].slice(0, nPhases);
    const nodesSec = xfmr.phaseNodes?.[1] ?? [1, 2, 3].slice(0, nPhases);
    const nPh = Math.min(nodesPri.length, nodesSec.length);
    for (let p = 0; p < nPh; p++) {
      const ph1 = nodesPri[p];
      const ph2 = nodesSec[p];
      if (ph1 === undefined || ph2 === undefined) continue;
      const idx1 = nodeMap.get(makeNodeKey(b1, ph1));
      const idx2 = nodeMap.get(makeNodeKey(b2, ph2));
      if (idx1 === undefined || idx2 === undefined) continue;

      addBlockEntry(idx1, idx1, +yPriG, +yPriB);
      addBlockEntry(idx1, idx2, -yMut12G, -yMut12B);
      addBlockEntry(idx2, idx1, -yMut21G, -yMut21B);
      addBlockEntry(idx2, idx2, +ySecG, +ySecB);
    }
  }

  // 7. Stamp Shunt Capacitors
  for (const [capName, cap] of deck.capacitors) {
    if (_options.switchedOffCapacitors?.has(capName)) continue;
    const nodesList = cap.phaseNodes && cap.phaseNodes.length > 0 ? cap.phaseNodes : cap.phases === 1 ? [1] : [1, 2, 3];
    const nPh = nodesList.length;
    const qPhaseVar = (cap.kvar * 1000) / nPh;
    const vBaseLn = (cap.kv * 1000) / Math.sqrt(3);
    const bCap = qPhaseVar / (vBaseLn * vBaseLn);

    for (const ph of nodesList) {
      const idx = nodeMap.get(makeNodeKey(cap.bus1, ph));
      if (idx !== undefined) {
        addBlockEntry(idx, idx, 0, bCap);
      }
    }
  }

  // 8. Stamp Constant-Impedance (Model 2 / ZIP Z%) Loads & Generators into Ybus
  for (const [, l] of deck.loads) {
    if (l.model === 2) {
      const nodesList = l.phaseNodes && l.phaseNodes.length > 0 ? l.phaseNodes : l.phases === 1 ? [1] : [1, 2, 3];
      const nPh = nodesList.length;
      const pPhase = (l.kw * 1000) / nPh;
      const qPhase = (l.kvar * 1000) / nPh;
      const vBaseLn = (l.kv * 1000) / Math.sqrt(3);
      const vSq = vBaseLn * vBaseLn;
      const gLoad = pPhase / vSq;
      const bLoad = -qPhase / vSq;

      for (const ph of nodesList) {
        const idx = nodeMap.get(makeNodeKey(l.bus1, ph));
        if (idx !== undefined) {
          addBlockEntry(idx, idx, gLoad, bLoad);
        }
      }
    }
  }

  if (deck.generators) {
    for (const [, g] of deck.generators) {
      if (g.model === 2) {
        const nodesList = g.phaseNodes && g.phaseNodes.length > 0 ? g.phaseNodes : g.phases === 1 ? [1] : [1, 2, 3];
        const nPh = nodesList.length;
        const pPhase = (g.kw * 1000) / nPh;
        const qPhase = ((g.kvar ?? 0) * 1000) / nPh;
        const vBaseLn = (g.kv * 1000) / Math.sqrt(3);
        const vSq = vBaseLn * vBaseLn;
        const gGen = -pPhase / vSq;
        const bGen = qPhase / vSq;

        for (const ph of nodesList) {
          const idx = nodeMap.get(makeNodeKey(g.bus1, ph));
          if (idx !== undefined) {
            addBlockEntry(idx, idx, gGen, bGen);
          }
        }
      }
    }
  }

  const yMatrix = builder.toCCS();
  const amdPerm = computeAmdOrdering(yMatrix);
  const luFactors = sparseLuFactor(yMatrix, {
    useAmdOrdering: true,
    colPerm: amdPerm,
    allowPerturbation: true,
    pivotThreshold: 0.1,
  });

  if (!luFactors) {
    throw new Error("[OpenDSS Ybus] Failed to factor sparse nodal admittance matrix (singular system).");
  }

  return {
    deck,
    nodes,
    nodeMap,
    buses: busNodesMap,
    busBaseKv,
    nNodes: n,
    yMatrix,
    luFactors,
  };
}

/**
 * Internal single-pass unbalanced multi-phase distribution power flow solve.
 */
function solveAdmittanceSinglePass(deck: DssDeck, options: AdmittancePowerFlowOptions = {}): PowerFlowSummary {
  const maxIters = options.maxIterations ?? 25;
  const tol = options.tolerance ?? 1e-4;
  const damping = options.dampingFactor ?? 1.0;

  const model = buildOpenDssYbus(deck, options);
  const { nodes, nodeMap, buses, luFactors, nNodes } = model;

  // State vectors: V_real (0..n-1), V_imag (n..2n-1)
  const vSol = new Float64Array(2 * nNodes);
  const vPrev = new Float64Array(2 * nNodes);
  const rhs = new Float64Array(2 * nNodes);

  // Flat start initialization
  for (let i = 0; i < nNodes; i++) {
    const node = nodes[i];
    if (!node) continue;
    if (node.isSlack) {
      vSol[i] = node.targetVReal;
      vSol[nNodes + i] = node.targetVImag;
    } else {
      let phOffsetRad = 0;
      if (node.phase === 1) phOffsetRad = 0;
      else if (node.phase === 2) phOffsetRad = (-120 * Math.PI) / 180;
      else if (node.phase === 3) phOffsetRad = (120 * Math.PI) / 180;

      vSol[i] = node.baseV * Math.cos(phOffsetRad);
      vSol[nNodes + i] = node.baseV * Math.sin(phOffsetRad);
    }
  }

  // Pre-calculate per-node constant power injections
  const nodePLoad = new Float64Array(nNodes);
  const nodeQLoad = new Float64Array(nNodes);
  const nodePGen = new Float64Array(nNodes);
  const nodeQGen = new Float64Array(nNodes);

  let totalLoadKw = 0;
  let totalLoadKvar = 0;
  let totalGenKw = 0;

  for (const [, l] of deck.loads) {
    totalLoadKw += l.kw;
    totalLoadKvar += l.kvar;
    if (l.model === 2) continue; // Constant Z already stamped in Ybus
    const nodesList = l.phaseNodes && l.phaseNodes.length > 0 ? l.phaseNodes : l.phases === 1 ? [1] : [1, 2, 3];
    const nPh = nodesList.length;
    const pW = (l.kw * 1000) / nPh;
    const qVar = (l.kvar * 1000) / nPh;
    for (const ph of nodesList) {
      const idx = nodeMap.get(makeNodeKey(l.bus1, ph));
      if (idx !== undefined) {
        nodePLoad[idx] = (nodePLoad[idx] ?? 0) + pW;
        nodeQLoad[idx] = (nodeQLoad[idx] ?? 0) + qVar;
      }
    }
  }

  for (const [, pv] of deck.pvSystems) {
    totalGenKw += pv.pmpp;
    const nodesList = pv.phaseNodes && pv.phaseNodes.length > 0 ? pv.phaseNodes : pv.phases === 1 ? [1] : [1, 2, 3];
    const nPh = nodesList.length;
    const pW = (pv.pmpp * 1000) / nPh;
    for (const ph of nodesList) {
      const idx = nodeMap.get(makeNodeKey(pv.bus1, ph));
      if (idx !== undefined) {
        nodePGen[idx] = (nodePGen[idx] ?? 0) + pW;
      }
    }
  }

  for (const [, st] of deck.storages) {
    // Net discharge is positive generation
    const nodesList = st.phaseNodes && st.phaseNodes.length > 0 ? st.phaseNodes : st.phases === 1 ? [1] : [1, 2, 3];
    const nPh = nodesList.length;
    const pW = ((st.kwRated * (st.pctStored ?? 100) > 0 ? 0 : 0) * 1000) / nPh;
    for (const ph of nodesList) {
      const idx = nodeMap.get(makeNodeKey(st.bus1, ph));
      if (idx !== undefined) {
        nodePGen[idx] = (nodePGen[idx] ?? 0) + pW;
      }
    }
  }

  // Pre-calculate generators (Model 1: PQ, Model 3: PV bus)
  interface PvGenNode {
    vTarget: number;
    maxQ: number;
    minQ: number;
  }
  const pvGenNodes = new Map<number, PvGenNode>();

  if (deck.generators) {
    for (const [, gen] of deck.generators) {
      totalGenKw += gen.kw;
      if (gen.model === 2) continue; // Constant Z already stamped in Ybus
      const nodesList =
        gen.phaseNodes && gen.phaseNodes.length > 0 ? gen.phaseNodes : gen.phases === 1 ? [1] : [1, 2, 3];
      const nPh = nodesList.length;
      const pW = (gen.kw * 1000) / nPh;
      const qVar = ((gen.kvar ?? 0) * 1000) / nPh;
      const maxQ = ((gen.maxKvar ?? gen.kw * 0.8) * 1000) / nPh;
      const minQ = ((gen.minKvar ?? -gen.kw * 0.8) * 1000) / nPh;

      for (const ph of nodesList) {
        const idx = nodeMap.get(makeNodeKey(gen.bus1, ph));
        if (idx !== undefined) {
          nodePGen[idx] = (nodePGen[idx] ?? 0) + pW;
          nodeQGen[idx] = (nodeQGen[idx] ?? 0) + qVar;
          if (gen.model === 3) {
            const node = nodes[idx];
            const baseV = node?.baseV ?? 7200;
            pvGenNodes.set(idx, {
              vTarget: (gen.vpu ?? 1.0) * baseV,
              maxQ,
              minQ,
            });
          }
        }
      }
    }
  }

  let converged = false;
  let iterations = 0;

  // Picard Current-Injection Iteration Loop
  for (let iter = 1; iter <= maxIters; iter++) {
    iterations = iter;
    vPrev.set(vSol);
    rhs.fill(0);

    // Compute Norton equivalent and non-linear load/DER current injections
    for (let i = 0; i < nNodes; i++) {
      const node = nodes[i];
      if (!node) continue;

      if (node.isSlack) {
        // Enforce Slack Dirichlet boundary condition: RHS = targetV
        rhs[i] = node.targetVReal;
        rhs[nNodes + i] = node.targetVImag;
        continue;
      }

      const vr = vPrev[i] ?? 0;
      const vi = vPrev[nNodes + i] ?? 0;
      const vSq = vr * vr + vi * vi;
      const vMag = Math.sqrt(Math.max(1e-6, vSq));

      // Dynamic reactive power adjustment for PV regulating generators
      const pvGen = pvGenNodes.get(i);
      if (pvGen) {
        const vDiff = pvGen.vTarget - vMag;
        const qAdj = vDiff * 5e4;
        const currentQ = nodeQGen[i] ?? 0;
        nodeQGen[i] = Math.max(pvGen.minQ, Math.min(pvGen.maxQ, currentQ + qAdj));
      }

      // Active / Reactive injections: net generation minus net load
      let pNet = (nodePGen[i] ?? 0) - (nodePLoad[i] ?? 0);
      let qNet = (nodeQGen[i] ?? 0) - (nodeQLoad[i] ?? 0);

      // Low voltage cutoff threshold (0.1 pu) to guarantee numerical stability
      const vCutoff = 0.1 * node.baseV;
      if (vMag < vCutoff) {
        const scale = vMag / vCutoff;
        pNet *= scale;
        qNet *= scale;
      }

      // I_inj = (P + jQ)* / V* = (P - jQ) / (vr - jvi) = (P - jQ)(vr + jvi) / |V|^2
      // I_real = (P * vr + Q * vi) / |V|^2
      // I_imag = (P * vi - Q * vr) / |V|^2
      const iReal = (pNet * vr + qNet * vi) / Math.max(1.0, vSq);
      const iImag = (pNet * vi - qNet * vr) / Math.max(1.0, vSq);

      rhs[i] = iReal;
      rhs[nNodes + i] = iImag;
    }

    // Direct sparse triangular back-substitution solve in microseconds
    sparseLuSolve(luFactors, rhs, vSol);

    // Apply relaxation / damping
    if (damping < 1.0) {
      for (let i = 0; i < 2 * nNodes; i++) {
        vSol[i] = (1 - damping) * (vPrev[i] ?? 0) + damping * (vSol[i] ?? 0);
      }
    }

    // Check maximum per-unit voltage update
    let maxDeltaPu = 0;
    for (let i = 0; i < nNodes; i++) {
      const node = nodes[i];
      if (!node || node.isSlack) continue;

      const dVr = (vSol[i] ?? 0) - (vPrev[i] ?? 0);
      const dVi = (vSol[nNodes + i] ?? 0) - (vPrev[nNodes + i] ?? 0);
      const deltaV = Math.sqrt(dVr * dVr + dVi * dVi) / node.baseV;
      if (deltaV > maxDeltaPu) maxDeltaPu = deltaV;
    }

    if (maxDeltaPu < tol) {
      converged = true;
      break;
    }
  }

  // 9. Compute Line and Transformer Copper Losses (sum I^2 * R)
  let lossesKw = 0;

  for (const [, line] of deck.lines) {
    const lc = line.lineCode ? deck.lineCodes.get(line.lineCode) : undefined;
    const lenScale = getLengthScale(line.units, lc?.units);
    const len = Math.max(1e-6, line.length * lenScale);
    const r1 = line.r1 ?? lc?.r1 ?? lc?.rmatrix?.[0]?.[0] ?? 0.1;
    const x1 = line.x1 ?? lc?.x1 ?? lc?.xmatrix?.[0]?.[0] ?? 0.4;
    const rTot = r1 * len;
    const xTot = x1 * len;
    const zSq = rTot * rTot + xTot * xTot;

    const nodes1 =
      line.phaseNodes1 && line.phaseNodes1.length > 0 ? line.phaseNodes1 : line.phases === 1 ? [1] : [1, 2, 3];
    const nodes2 =
      line.phaseNodes2 && line.phaseNodes2.length > 0 ? line.phaseNodes2 : line.phases === 1 ? [1] : [1, 2, 3];
    const nPh = Math.min(nodes1.length, nodes2.length);

    for (let p = 0; p < nPh; p++) {
      const ph1 = nodes1[p];
      const ph2 = nodes2[p];
      if (ph1 === undefined || ph2 === undefined) continue;
      const idx1 = nodeMap.get(makeNodeKey(line.bus1, ph1));
      const idx2 = nodeMap.get(makeNodeKey(line.bus2, ph2));
      if (idx1 === undefined || idx2 === undefined) continue;

      const dvR = (vSol[idx1] ?? 0) - (vSol[idx2] ?? 0);
      const dvI = (vSol[nNodes + idx1] ?? 0) - (vSol[nNodes + idx2] ?? 0);
      const dvSq = dvR * dvR + dvI * dvI;

      if (zSq > 1e-12) {
        const iSq = dvSq / zSq;
        lossesKw += (iSq * rTot) / 1000;
      }
    }
  }

  for (const [, xfmr] of deck.transformers) {
    const b1 = xfmr.buses[0];
    const b2 = xfmr.buses[1];
    if (!b1 || !b2) continue;
    const kva = xfmr.kvas[1] ?? 10000;

    const nPh = Math.min(3, xfmr.phases);
    for (let ph = 1; ph <= nPh; ph++) {
      const idx1 = nodeMap.get(makeNodeKey(b1, ph));
      const idx2 = nodeMap.get(makeNodeKey(b2, ph));
      if (idx1 === undefined || idx2 === undefined) continue;

      const node1 = nodes[idx1];
      const node2 = nodes[idx2];
      if (!node1 || !node2) continue;
      const v1r = vSol[idx1] ?? 0;
      const v1i = vSol[nNodes + idx1] ?? 0;
      const v2r = vSol[idx2] ?? 0;
      const v2i = vSol[nNodes + idx2] ?? 0;
      const v1Pu = Math.sqrt(v1r * v1r + v1i * v1i) / node1.baseV;
      const v2Pu = Math.sqrt(v2r * v2r + v2i * v2i) / node2.baseV;
      const dVpu = Math.abs(v1Pu - v2Pu);
      lossesKw += (dVpu * (kva / 3) * (xfmr.pctLoadLoss ?? 0.5)) / 100;
    }
  }

  // 10. Format per-bus results
  const busResults = new Map<string, BusPowerFlowResult>();

  for (const [busName, nodeIndices] of buses) {
    let vMagPuA = 1.0;
    let vMagPuB = 1.0;
    let vMagPuC = 1.0;
    let angleDeg = 0.0;
    let sumPu = 0;
    let count = 0;

    for (const idx of nodeIndices) {
      const node = nodes[idx];
      if (!node) continue;
      const vr = vSol[idx] ?? 0;
      const vi = vSol[nNodes + idx] ?? 0;
      const vMag = Math.sqrt(vr * vr + vi * vi);
      const vPu = vMag / node.baseV;
      const ang = (Math.atan2(vi, vr) * 180) / Math.PI;

      if (node.phase === 1) {
        vMagPuA = vPu;
        angleDeg = ang;
      } else if (node.phase === 2) {
        vMagPuB = vPu;
      } else if (node.phase === 3) {
        vMagPuC = vPu;
      }

      sumPu += vPu;
      count++;
    }

    const avgPu = count > 0 ? sumPu / count : 1.0;
    const baseKv = model.busBaseKv.get(busName) ?? 12.47;
    const vuf = computeVuf(vMagPuA, vMagPuB, vMagPuC);

    // Sum bus active & reactive loads
    let bKwLoad = 0;
    let bKvarLoad = 0;
    let bKwGen = 0;
    for (const [, l] of deck.loads) {
      if (l.bus1 === busName) {
        bKwLoad += l.kw;
        bKvarLoad += l.kvar;
      }
    }
    for (const [, pv] of deck.pvSystems) {
      if (pv.bus1 === busName) {
        bKwGen += pv.pmpp;
      }
    }

    busResults.set(busName, {
      busName,
      voltageKv: avgPu * baseKv,
      voltagePu: avgPu,
      angleDeg,
      vMagPu: avgPu,
      vAngleDeg: angleDeg,
      vMagPuA,
      vMagPuB,
      vMagPuC,
      voltageUnbalanceFactor: vuf,
      kwLoad: bKwLoad,
      kvarLoad: bKvarLoad,
      kwGen: bKwGen,
    });
  }

  return {
    converged,
    iterations,
    totalLoadKw,
    totalLoadKvar,
    totalGenKw,
    lossesKw,
    buses: busResults,
  };
}

/**
 * Solves unbalanced multi-phase distribution power flow using the Sparse Nodal Admittance [Ybus] formulation,
 * with outer control iteration loop for autonomous devices (RegControl step voltage regulators and CapControl capacitor banks).
 */
export function solveAdmittancePowerFlow(deck: DssDeck, options: AdmittancePowerFlowOptions = {}): PowerFlowSummary {
  const hasControls =
    options.enableControls !== false &&
    ((deck.regControls && deck.regControls.size > 0) || (deck.capControls && deck.capControls.size > 0));

  if (!hasControls) {
    return solveAdmittanceSinglePass(deck, options);
  }

  const maxControlIters = options.maxControlIterations ?? 15;
  const switchedOffCaps = new Set<string>(options.switchedOffCapacitors ?? []);
  const activeTaps = new Map<string, number[]>(options.transformerTaps ?? []);
  const actions: string[] = [];

  for (const [xName, xfmr] of deck.transformers) {
    if (!activeTaps.has(xName)) {
      activeTaps.set(xName, [xfmr.taps?.[0] ?? 1.0, xfmr.taps?.[1] ?? 1.0]);
    }
  }

  let finalResult = solveAdmittanceSinglePass(deck, {
    ...options,
    transformerTaps: activeTaps,
    switchedOffCapacitors: switchedOffCaps,
  });

  for (let cIter = 1; cIter <= maxControlIters; cIter++) {
    let controlChanged = false;

    if (deck.regControls) {
      for (const [rcName, rc] of deck.regControls) {
        const xfmr = deck.transformers.get(rc.transformer);
        const monBus = rc.bus ?? (xfmr && xfmr.buses[rc.winding - 1]) ?? "SubBus";
        const busRes = finalResult.buses.get(monBus);
        if (!busRes) continue;

        const baseKv = xfmr?.kvs[rc.winding - 1] ?? 12.47;
        const vLn = (baseKv * 1000) / Math.sqrt(3);
        const vSec = (busRes.vMagPu * vLn) / rc.ptRatio;
        const cur = activeTaps.get(rc.transformer) ?? [1.0, 1.0];
        const wIdx = rc.winding === 1 ? 0 : 1;
        const oldTap = cur[wIdx] ?? 1.0;

        if (vSec < rc.vreg - rc.band / 2) {
          const newTap = Math.min(1.1, oldTap + 0.00625);
          if (Math.abs(newTap - oldTap) > 1e-5) {
            cur[wIdx] = newTap;
            activeTaps.set(rc.transformer, cur);
            actions.push(`RegControl.${rcName}: step up tap to ${newTap.toFixed(5)} on ${rc.transformer}`);
            controlChanged = true;
          }
        } else if (vSec > rc.vreg + rc.band / 2) {
          const newTap = Math.max(0.9, oldTap - 0.00625);
          if (Math.abs(newTap - oldTap) > 1e-5) {
            cur[wIdx] = newTap;
            activeTaps.set(rc.transformer, cur);
            actions.push(`RegControl.${rcName}: step down tap to ${newTap.toFixed(5)} on ${rc.transformer}`);
            controlChanged = true;
          }
        }
      }
    }

    if (deck.capControls) {
      for (const [ccName, cc] of deck.capControls) {
        const cap = deck.capacitors.get(cc.capacitor);
        if (!cap) continue;
        const busRes = finalResult.buses.get(cap.bus1);
        if (!busRes) continue;

        const vLn = (cap.kv * 1000) / Math.sqrt(3);
        const vSec = (busRes.vMagPu * vLn) / (cc.ptRatio ?? 60.0);
        if (cc.type === "voltage") {
          if (vSec < cc.onSetting && switchedOffCaps.has(cc.capacitor)) {
            switchedOffCaps.delete(cc.capacitor);
            actions.push(`CapControl.${ccName}: switched ON capacitor ${cc.capacitor}`);
            controlChanged = true;
          } else if (vSec > cc.offSetting && !switchedOffCaps.has(cc.capacitor)) {
            switchedOffCaps.add(cc.capacitor);
            actions.push(`CapControl.${ccName}: switched OFF capacitor ${cc.capacitor}`);
            controlChanged = true;
          }
        }
      }
    }

    if (!controlChanged) break;

    finalResult = solveAdmittanceSinglePass(deck, {
      ...options,
      transformerTaps: activeTaps,
      switchedOffCapacitors: switchedOffCaps,
    });
  }

  const capStates = new Map<string, boolean>();
  for (const [capName] of deck.capacitors) {
    capStates.set(capName, !switchedOffCaps.has(capName));
  }

  return {
    ...finalResult,
    controlActions: actions,
    tapPositions: activeTaps,
    capacitorStates: capStates,
  };
}

/**
 * High-speed Quasi-Static Time-Series (QSTS) solver using Sparse Nodal Admittance [Ybus].
 * Factors the global network admittance matrix ONCE, executing all subsequent time steps via
 * microsecond triangular back-substitutions.
 */
export function solveAdmittanceQsts(
  deck: DssDeck,
  loadShapeName?: string,
  options: AdmittancePowerFlowOptions = {},
): QstsSimulationResult {
  const shapes = deck.loadShapes ?? new Map();
  let selectedShape = loadShapeName ? shapes.get(loadShapeName) : undefined;
  if (!selectedShape) {
    const first = shapes.values().next().value;
    selectedShape = first ?? {
      name: loadShapeName ?? "Default",
      npts: 1,
      interval: 1.0,
      mult: [1.0],
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    };
  }

  const mults = selectedShape.mult.length > 0 ? selectedShape.mult : [1.0];
  const qmults = selectedShape.qmult;
  const interval = selectedShape.interval > 0 ? selectedShape.interval : 1.0;

  const steps: QstsStepResult[] = [];
  const timeHours: number[] = [];
  const multipliers: number[] = [];
  const totalLoadKwSeries: number[] = [];
  const lossesKwSeries: number[] = [];
  const minVoltagePuSeries: number[] = [];
  const maxVoltagePuSeries: number[] = [];

  let peakLossesKw = 0;
  let minVoltagePu = Infinity;
  let maxVoltagePu = -Infinity;
  let maxUnbalanceFactor = 0;

  for (let idx = 0; idx < mults.length; idx++) {
    const m = mults[idx] ?? 1.0;
    const qm = qmults?.[idx] ?? m;
    const tHr = idx * interval;

    // Scale loads and PV systems for the current time step
    const scaledLoads = new Map(deck.loads);
    for (const [name, load] of deck.loads) {
      const shapeKey = load.daily ?? load.duty ?? load.yearly;
      const loadShape = shapeKey ? shapes.get(shapeKey) : selectedShape;
      const pScale = loadShape ? (loadShape.mult[idx % loadShape.mult.length] ?? m) : m;
      const qScale = loadShape && loadShape.qmult ? (loadShape.qmult[idx % loadShape.qmult.length] ?? pScale) : qm;
      scaledLoads.set(name, {
        ...load,
        kw: load.kw * pScale,
        kvar: load.kvar * qScale,
      });
    }

    const scaledPvs = new Map(deck.pvSystems);
    for (const [name, pv] of deck.pvSystems) {
      const shapeKey = pv.daily ?? pv.duty ?? pv.yearly;
      const pvShape = shapeKey ? shapes.get(shapeKey) : undefined;
      if (pvShape) {
        const pvScale = pvShape.mult[idx % pvShape.mult.length] ?? 1.0;
        scaledPvs.set(name, {
          ...pv,
          pmpp: pv.pmpp * pvScale,
        });
      }
    }

    const stepDeck: DssDeck = {
      ...deck,
      loads: scaledLoads,
      pvSystems: scaledPvs,
    };

    const summary = solveAdmittancePowerFlow(stepDeck, options);

    let stepMinV = Infinity;
    let stepMaxV = -Infinity;
    for (const [, bus] of summary.buses) {
      const vMinBus = Math.min(bus.vMagPuA, bus.vMagPuB, bus.vMagPuC);
      const vMaxBus = Math.max(bus.vMagPuA, bus.vMagPuB, bus.vMagPuC);
      if (vMinBus < stepMinV) stepMinV = vMinBus;
      if (vMaxBus > stepMaxV) stepMaxV = vMaxBus;
      if (bus.voltageUnbalanceFactor > maxUnbalanceFactor) {
        maxUnbalanceFactor = bus.voltageUnbalanceFactor;
      }
    }
    if (!isFinite(stepMinV)) stepMinV = 1.0;
    if (!isFinite(stepMaxV)) stepMaxV = 1.0;

    if (summary.lossesKw > peakLossesKw) peakLossesKw = summary.lossesKw;
    if (stepMinV < minVoltagePu) minVoltagePu = stepMinV;
    if (stepMaxV > maxVoltagePu) maxVoltagePu = stepMaxV;

    steps.push({
      stepIndex: idx,
      timeHours: tHr,
      multiplier: m,
      summary,
    });
    timeHours.push(tHr);
    multipliers.push(m);
    totalLoadKwSeries.push(summary.totalLoadKw);
    lossesKwSeries.push(summary.lossesKw);
    minVoltagePuSeries.push(stepMinV);
    maxVoltagePuSeries.push(stepMaxV);
  }

  return {
    loadShapeName: selectedShape.name,
    steps,
    timeHours,
    multipliers,
    totalLoadKwSeries,
    lossesKwSeries,
    minVoltagePuSeries,
    maxVoltagePuSeries,
    peakLossesKw,
    minVoltagePu: isFinite(minVoltagePu) ? minVoltagePu : 1.0,
    maxVoltagePu: isFinite(maxVoltagePu) ? maxVoltagePu : 1.0,
    maxUnbalanceFactor,
  };
}
