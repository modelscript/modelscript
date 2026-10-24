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

  // 2. Add Transformers
  for (const t of c.transformers) {
    if (t.stat !== 1) continue;
    const from = busIndices.get(t.i);
    const to = busIndices.get(t.j);
    if (from === undefined || to === undefined) continue;

    const denom = t.r12 * t.r12 + t.x12 * t.x12;
    if (denom <= 0) continue;

    const gSeries = t.r12 / denom;
    const bSeries = -t.x12 / denom;

    const tap = t.windv1 > 0 ? t.windv1 : 1.0;
    const phiRad = (t.ang1 * Math.PI) / 180.0;
    const tapSq = tap * tap;

    // Complex tap a = tap * (cos(phi) + j*sin(phi))
    const aRe = tap * Math.cos(phiRad);
    const aIm = tap * Math.sin(phiRad);
    const denomA = aRe * aRe + aIm * aIm;

    // y / a* = ((g*aRe - b*aIm) + j(b*aRe + g*aIm)) / denomA
    const yOverAStarRe = (gSeries * aRe - bSeries * aIm) / denomA;
    const yOverAStarIm = (bSeries * aRe + gSeries * aIm) / denomA;

    // y / a = ((g*aRe + b*aIm) + j(b*aRe - g*aIm)) / denomA
    const yOverARe = (gSeries * aRe + bSeries * aIm) / denomA;
    const yOverAIm = (bSeries * aRe - gSeries * aIm) / denomA;

    addY(from, to, -yOverAStarRe, -yOverAStarIm);
    addY(to, from, -yOverARe, -yOverAIm);

    // Diagonal
    addY(from, from, (gSeries + t.mag1) / tapSq, (bSeries + t.mag2) / tapSq);
    addY(to, to, gSeries, bSeries);
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
