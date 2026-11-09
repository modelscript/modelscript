// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeAmdOrdering, sparseLuFactor, sparseLuSolve, SparseTripletBuilder } from "@modelscript/runtime";
import type { DssDeck } from "../types.js";
import { solveAdmittancePowerFlow } from "./opendss-ybus-solver.js";

/**
 * Harmonic frequency spectrum results for a bus.
 */
export interface HarmonicBusResult {
  busName: string;
  baseKv: number;
  fundamentalV: number;
  thdPercent: number; // Total Harmonic Distortion (%)
  harmonics: Map<number, { vMag: number; vAngleDeg: number; pctOfFundamental: number }>;
}

/**
 * System-wide harmonic power flow analysis result.
 */
export interface HarmonicsResult {
  buses: Map<string, HarmonicBusResult>;
  maxThdPercent: number;
  maxThdBus: string;
  harmonicOrders: number[];
  resonanceRisks: {
    bus: string;
    harmonic: number;
    impedanceOhms: number;
    amplificationRatio: number;
  }[];
}

/**
 * Harmonic study configuration options.
 */
export interface HarmonicsOptions {
  /** Harmonic orders to evaluate (default: [1, 3, 5, 7, 9, 11, 13]). */
  harmonics?: number[];
  /** Custom harmonic current injection spectrum (order -> fraction of fundamental current). */
  injectionSpectrum?: Map<number, number>;
}

/**
 * Standard IEEE 519 typical 6-pulse inverter harmonic injection spectrum.
 */
const DEFAULT_HARMONIC_SPECTRUM: Record<number, number> = {
  3: 0.05,
  5: 0.18,
  7: 0.12,
  9: 0.02,
  11: 0.07,
  13: 0.05,
};

/**
 * Solves frequency-dependent harmonic power flow across specified orders h*omega,
 * determining harmonic voltage propagation, bus Total Harmonic Distortion (THD), and resonance risks.
 */
export function solveHarmonics(deck: DssDeck, options: HarmonicsOptions = {}): HarmonicsResult {
  const harmonicOrders = options.harmonics ?? [1, 3, 5, 7, 9, 11, 13];

  // 1. Solve fundamental power flow to establish base operating voltages
  const fundamentalResult = solveAdmittancePowerFlow(deck);

  // Map buses to fundamental voltages
  const busFundamentalV = new Map<string, number>();
  for (const [busName, bRes] of fundamentalResult.buses) {
    busFundamentalV.set(busName, Math.max(1e-4, bRes.voltageKv * 1000));
  }

  // Pre-index buses and nodes
  const nodeMap = new Map<string, number>();
  const busNodesMap = new Map<string, number[]>();
  const busBaseKv = new Map<string, number>();
  let nNodes = 0;

  for (const [busName, bRes] of fundamentalResult.buses) {
    busBaseKv.set(busName, bRes.voltageKv / Math.max(0.01, bRes.voltagePu));
    const indices: number[] = [];
    for (let ph = 1; ph <= 3; ph++) {
      const key = `${busName}.${ph}`;
      nodeMap.set(key, nNodes);
      indices.push(nNodes);
      nNodes++;
    }
    busNodesMap.set(busName, indices);
  }

  const busHarmonicsMap = new Map<string, Map<number, { vMag: number; vAngleDeg: number; pctOfFundamental: number }>>();
  for (const busName of busNodesMap.keys()) {
    busHarmonicsMap.set(busName, new Map());
  }

  const resonanceRisks: HarmonicsResult["resonanceRisks"] = [];
  const fundamentalImpedances = new Map<string, number>();

  // 2. Solve per harmonic order h
  for (const h of harmonicOrders) {
    if (h === 1) {
      // Record fundamental
      for (const [busName, vFund] of busFundamentalV) {
        const busMap = busHarmonicsMap.get(busName);
        if (busMap) {
          busMap.set(1, { vMag: vFund, vAngleDeg: 0, pctOfFundamental: 100.0 });
        }
      }
      continue;
    }

    // Build frequency-scaled admittance builder for harmonic h
    const builder = new SparseTripletBuilder(2 * nNodes, 2 * nNodes, 16 * nNodes);

    const addBlockEntry = (row: number, col: number, G: number, B: number) => {
      builder.add(row, col, G);
      builder.add(row, nNodes + col, -B);
      builder.add(nNodes + row, col, B);
      builder.add(nNodes + row, nNodes + col, G);
    };

    // Substation boundary (short-circuit path for harmonic currents)
    if (deck.circuit) {
      for (let ph = 1; ph <= 3; ph++) {
        const idx = nodeMap.get(`${deck.circuit.bus1}.${ph}`);
        if (idx !== undefined) {
          // Large conductance for slack
          builder.add(idx, idx, 1e4);
          builder.add(nNodes + idx, nNodes + idx, 1e4);
        }
      }
    }

    // Lines with skin effect: R(h) = R1 * sqrt(h), X(h) = h * X1, B(h) = h * B
    for (const [, line] of deck.lines) {
      const lc = line.lineCode ? deck.lineCodes.get(line.lineCode) : undefined;
      const r1 = (line.r1 ?? lc?.r1 ?? 0.1) * Math.sqrt(h);
      const x1 = (line.x1 ?? lc?.x1 ?? 0.4) * h;
      const len = Math.max(1e-6, line.length);

      const rTot = r1 * len;
      const xTot = x1 * len;
      const denom = rTot * rTot + xTot * xTot;
      const G = denom > 1e-12 ? rTot / denom : 1e3;
      const B = denom > 1e-12 ? -xTot / denom : -1e3;

      for (let ph = 1; ph <= line.phases; ph++) {
        const u = nodeMap.get(`${line.bus1}.${ph}`);
        const v = nodeMap.get(`${line.bus2}.${ph}`);
        if (u !== undefined && v !== undefined) {
          addBlockEntry(u, u, +G, +B);
          addBlockEntry(u, v, -G, -B);
          addBlockEntry(v, u, -G, -B);
          addBlockEntry(v, v, +G, +B);
        }
      }
    }

    // Transformers: R(h) = R * sqrt(h), X(h) = h * X
    for (const [, xfmr] of deck.transformers) {
      const b1 = xfmr.buses[0];
      const b2 = xfmr.buses[1];
      if (!b1 || !b2) continue;
      const kv2 = xfmr.kvs[1] ?? 12.47;
      const kva = xfmr.kvas[1] ?? 10000.0;
      const zBase2 = (kv2 * kv2 * 1000.0) / Math.max(1.0, kva);
      const rLeak = ((xfmr.pctLoadLoss ?? 0.5) / 100.0) * zBase2 * Math.sqrt(h);
      const xLeak = ((xfmr.xhl ?? 5.0) / 100.0) * zBase2 * h;
      const denom = rLeak * rLeak + xLeak * xLeak;
      const G = denom > 1e-12 ? rLeak / denom : 1e3;
      const B = denom > 1e-12 ? -xLeak / denom : -1e3;

      for (let ph = 1; ph <= Math.min(3, xfmr.phases); ph++) {
        const u = nodeMap.get(`${b1}.${ph}`);
        const v = nodeMap.get(`${b2}.${ph}`);
        if (u !== undefined && v !== undefined) {
          addBlockEntry(u, u, +G, +B);
          addBlockEntry(u, v, -G, -B);
          addBlockEntry(v, u, -G, -B);
          addBlockEntry(v, v, +G, +B);
        }
      }
    }

    // Capacitors: B(h) = h * B_fund
    for (const [, cap] of deck.capacitors) {
      const qPhaseVar = (cap.kvar * 1000) / cap.phases;
      const vBaseLn = (cap.kv * 1000) / Math.sqrt(3);
      const bCap = (qPhaseVar / (vBaseLn * vBaseLn)) * h;

      for (let ph = 1; ph <= cap.phases; ph++) {
        const idx = nodeMap.get(`${cap.bus1}.${ph}`);
        if (idx !== undefined) {
          addBlockEntry(idx, idx, 0, bCap);
        }
      }
    }

    const yMatrix = builder.toCCS();
    const amdPerm = computeAmdOrdering(yMatrix);
    const lu = sparseLuFactor(yMatrix, {
      useAmdOrdering: true,
      colPerm: amdPerm,
      allowPerturbation: true,
      pivotThreshold: 0.1,
    });

    if (!lu) continue;

    // Harmonic current injection from inverters/loads: I(h) = spectrum(h) * I_fund
    const spectrumFraction = options.injectionSpectrum?.get(h) ?? DEFAULT_HARMONIC_SPECTRUM[h] ?? 1.0 / h;
    const rhs = new Float64Array(2 * nNodes);
    const vSol = new Float64Array(2 * nNodes);

    for (const [, pv] of deck.pvSystems) {
      const pPhase = (pv.pmpp * 1000) / pv.phases;
      const vLn = (pv.kv * 1000) / Math.sqrt(3);
      const iFund = pPhase / Math.max(1.0, vLn);
      const iHarm = iFund * spectrumFraction;

      for (let ph = 1; ph <= pv.phases; ph++) {
        const idx = nodeMap.get(`${pv.bus1}.${ph}`);
        if (idx !== undefined) {
          rhs[idx] = iHarm;
        }
      }
    }

    for (const [, l] of deck.loads) {
      const pPhase = (l.kw * 1000) / l.phases;
      const vLn = (l.kv * 1000) / Math.sqrt(3);
      const iFund = pPhase / Math.max(1.0, vLn);
      const iHarm = iFund * (spectrumFraction * 0.5);

      for (let ph = 1; ph <= l.phases; ph++) {
        const idx = nodeMap.get(`${l.bus1}.${ph}`);
        if (idx !== undefined) {
          rhs[idx] = (rhs[idx] ?? 0) + iHarm;
        }
      }
    }

    sparseLuSolve(lu, rhs, vSol);

    for (const [busName, indices] of busNodesMap) {
      let sumSq = 0;
      for (const idx of indices) {
        const vr = vSol[idx] ?? 0;
        const vi = vSol[nNodes + idx] ?? 0;
        sumSq += vr * vr + vi * vi;
      }
      const vMag = Math.sqrt(sumSq / indices.length);
      const vFund = busFundamentalV.get(busName) ?? 7200;
      const pctOfFund = (vMag / vFund) * 100;

      const busMap = busHarmonicsMap.get(busName);
      if (busMap) {
        busMap.set(h, {
          vMag,
          vAngleDeg: 0,
          pctOfFundamental: pctOfFund,
        });
      }

      // Check resonance ratio
      const zHarm = vMag / Math.max(0.1, rhs[indices[0] ?? 0] ?? 1.0);
      if (h === 3) fundamentalImpedances.set(busName, zHarm / 3);
      const zFund = fundamentalImpedances.get(busName) ?? 1.0;
      const ratio = zHarm / Math.max(0.01, zFund);
      if (ratio > 8.0) {
        resonanceRisks.push({
          bus: busName,
          harmonic: h,
          impedanceOhms: zHarm,
          amplificationRatio: ratio,
        });
      }
    }
  }

  // 3. Compute THD per bus
  const buses = new Map<string, HarmonicBusResult>();
  let maxThdPercent = 0;
  let maxThdBus = "";

  for (const [busName, hMap] of busHarmonicsMap) {
    const vFund = busFundamentalV.get(busName) ?? 7200;
    const baseKv = busBaseKv.get(busName) ?? 12.47;

    let sumHarmonicsSq = 0;
    for (const [h, res] of hMap) {
      if (h > 1) {
        sumHarmonicsSq += res.vMag * res.vMag;
      }
    }

    const thdPercent = (Math.sqrt(sumHarmonicsSq) / vFund) * 100;
    if (thdPercent > maxThdPercent) {
      maxThdPercent = thdPercent;
      maxThdBus = busName;
    }

    buses.set(busName, {
      busName,
      baseKv,
      fundamentalV: vFund,
      thdPercent,
      harmonics: hMap,
    });
  }

  return {
    buses,
    maxThdPercent,
    maxThdBus,
    harmonicOrders,
    resonanceRisks,
  };
}
