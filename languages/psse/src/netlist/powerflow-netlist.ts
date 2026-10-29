// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PsseCase } from "../types.js";

/**
 * Complex number representation for nodal admittance calculations.
 */
export interface Complex {
  re: number;
  im: number;
}

/**
 * Power flow netlist graph and admittance representation.
 */
export interface PowerFlowNetlist {
  nBuses: number;
  busIndices: Map<number, number>; // Bus number -> 0-based matrix index
  busNumbers: number[]; // 0-based matrix index -> Bus number
  pNetMw: Float64Array; // Net active power injection per bus (P_gen - P_load)
  qNetMvar: Float64Array; // Net reactive power injection per bus (Q_gen - Q_load)
  vNominalKv: Float64Array; // Nominal base kV per bus
  vMagPu: Float64Array; // Initial/specified voltage magnitude (p.u.)
  vAngRad: Float64Array; // Initial/specified voltage angle (radians)
  busTypes: Uint8Array; // 1: PQ, 2: PV, 3: Swing, 4: Isolated
  // Sparse Admittance Matrix Ybus (G + j*B)
  ybus: {
    g: Map<number, Map<number, number>>; // Row -> Col -> Conductance
    b: Map<number, Map<number, number>>; // Row -> Col -> Susceptance
  };
  metrics: {
    totalGenMw: number;
    totalGenMvar: number;
    totalLoadMw: number;
    totalLoadMvar: number;
    totalShuntMvar: number;
  };
}

/**
 * Extracts a structured PowerFlowNetlist and computes the complex nodal admittance matrix (Ybus).
 */
export function extractPowerFlowNetlist(c: PsseCase): PowerFlowNetlist {
  const busNumbers: number[] = [];
  const busIndices = new Map<number, number>();

  let idx = 0;
  for (const b of c.buses.values()) {
    busNumbers.push(b.i);
    busIndices.set(b.i, idx++);
  }

  const n = busNumbers.length;
  const pNetMw = new Float64Array(n);
  const qNetMvar = new Float64Array(n);
  const vNominalKv = new Float64Array(n);
  const vMagPu = new Float64Array(n);
  const vAngRad = new Float64Array(n);
  const busTypes = new Uint8Array(n);

  let totalGenMw = 0;
  let totalGenMvar = 0;
  let totalLoadMw = 0;
  let totalLoadMvar = 0;
  let totalShuntMvar = 0;

  for (let i = 0; i < n; i++) {
    const busNum = busNumbers[i]!;
    const b = c.buses.get(busNum)!;
    vNominalKv[i] = b.baseKv;
    vMagPu[i] = b.vm;
    vAngRad[i] = (b.va * Math.PI) / 180.0;
    busTypes[i] = b.ide;
  }

  // Sum Generators
  for (const g of c.generators) {
    if (g.stat !== 1) continue;
    const bIdx = busIndices.get(g.i);
    if (bIdx !== undefined && bIdx < n) {
      pNetMw[bIdx] = (pNetMw[bIdx] ?? 0) + g.pg;
      qNetMvar[bIdx] = (qNetMvar[bIdx] ?? 0) + g.qg;
      totalGenMw += g.pg;
      totalGenMvar += g.qg;
      if (c.buses.get(g.i)?.ide === 2) {
        vMagPu[bIdx] = g.vs;
      }
    }
  }

  // Subtract Loads
  for (const l of c.loads) {
    if (l.status !== 1) continue;
    const bIdx = busIndices.get(l.i);
    if (bIdx !== undefined && bIdx < n) {
      pNetMw[bIdx] = (pNetMw[bIdx] ?? 0) - l.pl;
      qNetMvar[bIdx] = (qNetMvar[bIdx] ?? 0) - l.ql;
      totalLoadMw += l.pl;
      totalLoadMvar += l.ql;
    }
  }

  // Sparse Ybus Maps
  const gMap = new Map<number, Map<number, number>>();
  const bMap = new Map<number, Map<number, number>>();

  for (let i = 0; i < n; i++) {
    gMap.set(i, new Map());
    bMap.set(i, new Map());
  }

  function addY(row: number, col: number, gVal: number, bVal: number) {
    const rowG = gMap.get(row)!;
    const rowB = bMap.get(row)!;
    rowG.set(col, (rowG.get(col) ?? 0.0) + gVal);
    rowB.set(col, (rowB.get(col) ?? 0.0) + bVal);
  }

  // 1. Add Transmission Branches (pi-model)
  for (const br of c.branches) {
    if (br.st !== 1) continue;
    const from = busIndices.get(br.i);
    const to = busIndices.get(br.j);
    if (from === undefined || to === undefined) continue;

    const denom = br.r * br.r + br.x * br.x;
    if (denom <= 0) continue;

    const gSeries = br.r / denom;
    const bSeries = -br.x / denom;
    const bShunt = br.b / 2.0;

    // Off-diagonal: Y_ij = -y_series
    addY(from, to, -gSeries, -bSeries);
    addY(to, from, -gSeries, -bSeries);

    // Diagonal: Y_ii += y_series + j*b_shunt + shunt_inj
    addY(from, from, gSeries + br.gi, bSeries + bShunt + br.bi);
    addY(to, to, gSeries + br.gj, bSeries + bShunt + br.bj);
  }

  // 2. Add Transformers (2-winding and 3-winding)
  function stampTwoWindingAdmittance(
    from: number,
    to: number,
    r: number,
    x: number,
    windv1: number,
    ang1Deg: number,
    mag1: number,
    mag2: number,
  ) {
    const denom = r * r + x * x;
    if (denom <= 0) return;

    const gSeries = r / denom;
    const bSeries = -x / denom;

    const tap = windv1 > 0 ? windv1 : 1.0;
    const phiRad = (ang1Deg * Math.PI) / 180.0;
    const tapSq = tap * tap;

    const aRe = tap * Math.cos(phiRad);
    const aIm = tap * Math.sin(phiRad);
    const denomA = aRe * aRe + aIm * aIm;

    const yOverAStarRe = (gSeries * aRe - bSeries * aIm) / denomA;
    const yOverAStarIm = (bSeries * aRe + gSeries * aIm) / denomA;

    const yOverARe = (gSeries * aRe + bSeries * aIm) / denomA;
    const yOverAIm = (bSeries * aRe - gSeries * aIm) / denomA;

    addY(from, to, -yOverAStarRe, -yOverAStarIm);
    addY(to, from, -yOverARe, -yOverAIm);

    addY(from, from, (gSeries + mag1) / tapSq, (bSeries + mag2) / tapSq);
    addY(to, to, gSeries, bSeries);
  }

  for (const t of c.transformers) {
    if (t.stat === 0) continue;
    const iIdx = busIndices.get(t.i);
    const jIdx = busIndices.get(t.j);
    if (iIdx === undefined || jIdx === undefined) continue;

    if (t.k !== 0) {
      const kIdx = busIndices.get(t.k);
      if (kIdx !== undefined) {
        // 3-Winding Transformer: convert pairwise (Z12, Z23, Z31) -> Star (Z1, Z2, Z3) -> Kron-reduced Delta (Z_12, Z_23, Z_31)
        const r12 = t.r12;
        const x12 = t.x12;
        const r23 = t.r23 ?? 0.0;
        const x23 = t.x23 ?? t.x12;
        const r31 = t.r31 ?? 0.0;
        const x31 = t.x31 ?? t.x12;

        const r1 = 0.5 * (r12 + r31 - r23);
        const x1 = 0.5 * (x12 + x31 - x23);
        const r2 = 0.5 * (r12 + r23 - r31);
        const x2 = 0.5 * (x12 + x23 - x31);
        const r3 = 0.5 * (r23 + r31 - r12);
        const x3 = 0.5 * (x23 + x31 - x12);

        // Z_sigma = Z1*Z2 + Z2*Z3 + Z3*Z1
        const z12Re = r1 * r2 - x1 * x2;
        const z12Im = r1 * x2 + x1 * r2;
        const z23Re = r2 * r3 - x2 * x3;
        const z23Im = r2 * x3 + x2 * r3;
        const z31Re = r3 * r1 - x3 * x1;
        const z31Im = r3 * x1 + x3 * r1;
        const zSumRe = z12Re + z23Re + z31Re;
        const zSumIm = z12Im + z23Im + z31Im;

        const divComplex = (numRe: number, numIm: number, denRe: number, denIm: number): [number, number] => {
          const d = denRe * denRe + denIm * denIm;
          if (d <= 1e-12) return [0.0, 0.1];
          return [(numRe * denRe + numIm * denIm) / d, (numIm * denRe - numRe * denIm) / d];
        };

        const [rd12, xd12] = divComplex(zSumRe, zSumIm, r3, x3);
        const [rd23, xd23] = divComplex(zSumRe, zSumIm, r1, x1);
        const [rd31, xd31] = divComplex(zSumRe, zSumIm, r2, x2);

        stampTwoWindingAdmittance(iIdx, jIdx, rd12, xd12, t.windv1, t.ang1, t.mag1, t.mag2);
        stampTwoWindingAdmittance(jIdx, kIdx, rd23, xd23, t.windv2, t.ang2 ?? 0.0, 0.0, 0.0);
        stampTwoWindingAdmittance(kIdx, iIdx, rd31, xd31, t.windv3 ?? 1.0, t.ang3 ?? 0.0, 0.0, 0.0);
        continue;
      }
    }

    stampTwoWindingAdmittance(iIdx, jIdx, t.r12, t.x12, t.windv1, t.ang1, t.mag1, t.mag2);
  }

  // 3. Add Fixed Shunts
  for (const s of c.fixedShunts) {
    if (s.status !== 1) continue;
    const bIdx = busIndices.get(s.i);
    if (bIdx !== undefined) {
      // In PSS/E, gl is in MW, bl is in MVAR at 1.0 p.u. voltage on sbase
      const gPu = s.gl / c.header.sbase;
      const bPu = s.bl / c.header.sbase;
      addY(bIdx, bIdx, gPu, bPu);
      totalShuntMvar += s.bl;
    }
  }

  // 4. Add Switched Shunts
  for (const sw of c.switchedShunts) {
    if (sw.stat !== 1) continue;
    const bIdx = busIndices.get(sw.i);
    if (bIdx !== undefined) {
      const bPu = (sw.binit + sw.n1 * sw.b1) / c.header.sbase;
      addY(bIdx, bIdx, 0.0, bPu);
      totalShuntMvar += sw.binit + sw.n1 * sw.b1;
    }
  }

  return {
    nBuses: n,
    busIndices,
    busNumbers,
    pNetMw,
    qNetMvar,
    vNominalKv,
    vMagPu,
    vAngRad,
    busTypes,
    ybus: {
      g: gMap,
      b: bMap,
    },
    metrics: {
      totalGenMw,
      totalGenMvar,
      totalLoadMw,
      totalLoadMvar,
      totalShuntMvar,
    },
  };
}

export interface SerializedYbusEntry {
  fromBus: number;
  toBus: number;
  row: number;
  col: number;
  gPu: number;
  bPu: number;
}

/**
 * Formats a PowerFlowNetlist and its sparse Ybus admittance matrix into a readable engineering report.
 */
export function formatNetlistReport(netlist: PowerFlowNetlist, caseTitle = "PSS/E BASE CASE"): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`  PSS/E POWER FLOW NETLIST & NODAL ADMITTANCE (YBUS) REPORT — ${caseTitle}`);
  lines.push(`================================================================================`);
  lines.push(`  Total Buses       : ${netlist.nBuses}`);
  lines.push(
    `  Total Generation  : ${netlist.metrics.totalGenMw.toFixed(2)} MW / ${netlist.metrics.totalGenMvar.toFixed(2)} Mvar`,
  );
  lines.push(
    `  Total Load        : ${netlist.metrics.totalLoadMw.toFixed(2)} MW / ${netlist.metrics.totalLoadMvar.toFixed(2)} Mvar`,
  );
  lines.push(`  Total Shunt       : ${netlist.metrics.totalShuntMvar.toFixed(2)} Mvar`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  NODAL SCHEDULED INJECTIONS`);
  lines.push(`  Idx   Bus #   Base kV   Type     Vm (pu)   Va (deg)    P_net (MW)   Q_net (Mvar)`);
  lines.push(`  ---  ------  --------  ------  ---------  ---------  ------------  -------------`);
  const typeNames: Record<number, string> = { 1: "PQ", 2: "PV", 3: "Slack", 4: "Isol" };
  for (let i = 0; i < netlist.nBuses; i++) {
    const bNum = netlist.busNumbers[i]!;
    const kv = netlist.vNominalKv[i] ?? 0;
    const tName = typeNames[netlist.busTypes[i] ?? 1] ?? "PQ";
    const vm = netlist.vMagPu[i] ?? 1.0;
    const vaDeg = ((netlist.vAngRad[i] ?? 0) * 180.0) / Math.PI;
    const pNet = netlist.pNetMw[i] ?? 0;
    const qNet = netlist.qNetMvar[i] ?? 0;
    lines.push(
      `  ${String(i).padStart(3)}  ${String(bNum).padStart(6)}  ${kv.toFixed(2).padStart(8)}  ${tName.padEnd(6)}  ${vm.toFixed(4).padStart(9)}  ${vaDeg.toFixed(3).padStart(9)}  ${pNet.toFixed(2).padStart(12)}  ${qNet.toFixed(2).padStart(13)}`,
    );
  }
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  SPARSE NODAL ADMITTANCE MATRIX Y_BUS (G_ik + j B_ik in p.u.)`);
  lines.push(`  Row Bus   Col Bus      G_ik (p.u.)      B_ik (p.u.)     |Y_ik| (p.u.)`);
  lines.push(`  -------   -------   --------------   --------------   ---------------`);
  let nnz = 0;
  for (let i = 0; i < netlist.nBuses; i++) {
    const rowG = netlist.ybus.g.get(i);
    const rowB = netlist.ybus.b.get(i);
    if (!rowG || !rowB) continue;
    const cols = Array.from(new Set([...rowG.keys(), ...rowB.keys()])).sort((a, b) => a - b);
    for (const k of cols) {
      const g = rowG.get(k) ?? 0;
      const b = rowB.get(k) ?? 0;
      if (Math.abs(g) < 1e-9 && Math.abs(b) < 1e-9) continue;
      nnz++;
      const yMag = Math.sqrt(g * g + b * b);
      const busI = netlist.busNumbers[i]!;
      const busK = netlist.busNumbers[k]!;
      lines.push(
        `  ${String(busI).padStart(7)}   ${String(busK).padStart(7)}   ${g.toFixed(5).padStart(14)}   ${b.toFixed(5).padStart(14)}   ${yMag.toFixed(5).padStart(15)}`,
      );
    }
  }
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  Non-Zero Y_bus Entries: ${nnz}`);
  lines.push(`================================================================================`);
  return lines.join("\n");
}

/**
 * Converts a PowerFlowNetlist into a plain JSON-serializable object for LSP / IDE transport.
 */
export function serializePowerFlowNetlist(netlist: PowerFlowNetlist, caseTitle = "PSS/E BASE CASE") {
  const ybusEntries: SerializedYbusEntry[] = [];
  for (let i = 0; i < netlist.nBuses; i++) {
    const rowG = netlist.ybus.g.get(i);
    const rowB = netlist.ybus.b.get(i);
    if (!rowG || !rowB) continue;
    const cols = Array.from(new Set([...rowG.keys(), ...rowB.keys()])).sort((a, b) => a - b);
    for (const k of cols) {
      const g = rowG.get(k) ?? 0;
      const b = rowB.get(k) ?? 0;
      if (Math.abs(g) < 1e-9 && Math.abs(b) < 1e-9) continue;
      ybusEntries.push({
        fromBus: netlist.busNumbers[i]!,
        toBus: netlist.busNumbers[k]!,
        row: i,
        col: k,
        gPu: Number(g.toFixed(6)),
        bPu: Number(b.toFixed(6)),
      });
    }
  }

  return {
    nBuses: netlist.nBuses,
    busNumbers: netlist.busNumbers,
    pNetMw: Array.from(netlist.pNetMw),
    qNetMvar: Array.from(netlist.qNetMvar),
    vNominalKv: Array.from(netlist.vNominalKv),
    vMagPu: Array.from(netlist.vMagPu),
    vAngRad: Array.from(netlist.vAngRad),
    busTypes: Array.from(netlist.busTypes),
    ybusNonZeros: ybusEntries.length,
    ybusEntries,
    metrics: netlist.metrics,
    reportText: formatNetlistReport(netlist, caseTitle),
  };
}
