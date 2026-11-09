// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck } from "../types.js";

/**
 * GIC assessment for a single substation transformer or grounding bus.
 */
export interface BusGicResult {
  busName: string;
  dcVoltageVolts: number;
  neutralCurrentAmps: number;
  saturationRisk: boolean; // Flagged if neutral DC current > 10 Amps
  estimatedQReactiveLossMvar: number; // Reactive power absorption surge due to half-cycle saturation
}

/**
 * Complete distribution/transmission network GIC study result.
 */
export interface GicResult {
  buses: Map<string, BusGicResult>;
  maxNeutralCurrentAmps: number;
  maxNeutralBus: string;
  totalGicLossMvar: number;
  atRiskTransformers: string[];
}

/**
 * Configuration options for Geomagnetically Induced Current (GIC) simulation.
 */
export interface GicOptions {
  /** Eastward geoelectric field component Ex in V/km (default: 1.0). */
  eEastVPerKm?: number;
  /** Northward geoelectric field component Ey in V/km (default: 0.0). */
  eNorthVPerKm?: number;
  /** Substation grounding resistance in Ohms (default: 0.5). */
  substationGroundResistance?: number;
}

/**
 * Solves quasi-DC network power flow under solar geomagnetic disturbances (GMD)
 * to compute induced currents (GIC) in power transformer grounding neutrals.
 */
export function solveGic(deck: DssDeck, options: GicOptions = {}): GicResult {
  const eEast = options.eEastVPerKm ?? 1.0;
  const eNorth = options.eNorthVPerKm ?? 0.0;
  const rGround = Math.max(0.01, options.substationGroundResistance ?? 0.5);

  // Map buses to indices
  const busList: string[] = [];
  const busIndex = new Map<string, number>();

  const registerBus = (name: string) => {
    if (!busIndex.has(name)) {
      busIndex.set(name, busList.length);
      busList.push(name);
    }
  };

  if (deck.circuit) registerBus(deck.circuit.bus1);
  for (const [, line] of deck.lines) {
    registerBus(line.bus1);
    registerBus(line.bus2);
  }
  for (const [, xfmr] of deck.transformers) {
    for (const b of xfmr.buses) registerBus(b);
  }

  const n = busList.length;
  if (n === 0) {
    return {
      buses: new Map(),
      maxNeutralCurrentAmps: 0,
      maxNeutralBus: "",
      totalGicLossMvar: 0,
      atRiskTransformers: [],
    };
  }

  // Dense conductance matrix and RHS current injections
  const G: number[][] = Array.from({ length: n }, () => new Float64Array(n) as unknown as number[]);
  const rhs = new Float64Array(n);

  // 1. Stamp substation grounding mats (conductance to remote earth)
  const gMat = 1.0 / rGround;
  for (let i = 0; i < n; i++) {
    const row = G[i];
    if (row) row[i] = gMat; // Ground connection
  }

  // 2. Stamp line series DC conductances and induced voltage Norton injections
  for (const [, line] of deck.lines) {
    const u = busIndex.get(line.bus1);
    const v = busIndex.get(line.bus2);
    if (u === undefined || v === undefined) continue;

    const len = Math.max(0.1, line.length);
    // 3 parallel phases carry DC in parallel: R_dc = (R1 * length) / 3
    const r1 = line.r1 ?? 0.15;
    const rDc = Math.max(0.01, (r1 * len) / 3.0);
    const gLine = 1.0 / rDc;

    // Induced voltage: V_dc = |E| * len
    const eMag = Math.sqrt(eEast * eEast + eNorth * eNorth);
    const vInduced = eMag * len;
    const iInj = vInduced * gLine;

    const rowU = G[u];
    const rowV = G[v];
    if (rowU && rowV) {
      rowU[u] = (rowU[u] ?? 0) + gLine;
      rowU[v] = (rowU[v] ?? 0) - gLine;
      rowV[u] = (rowV[u] ?? 0) - gLine;
      rowV[v] = (rowV[v] ?? 0) + gLine;
    }

    rhs[u] = (rhs[u] ?? 0) - iInj;
    rhs[v] = (rhs[v] ?? 0) + iInj;
  }

  // 3. Gaussian elimination solve: G * V = rhs
  const vSol = new Float64Array(n);
  // Simple dense solver for N small distribution substations
  const a: number[][] = G.map((row) => Array.from(row));
  const bArr = Array.from(rhs);

  for (let p = 0; p < n; p++) {
    let maxRow = p;
    let maxVal = Math.abs(a[p]?.[p] ?? 0);
    for (let r = p + 1; r < n; r++) {
      const val = Math.abs(a[r]?.[p] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = r;
      }
    }
    if (maxRow !== p) {
      const tempRow = a[p];
      a[p] = a[maxRow] ?? [];
      a[maxRow] = tempRow ?? [];
      const tempB = bArr[p] ?? 0;
      bArr[p] = bArr[maxRow] ?? 0;
      bArr[maxRow] = tempB;
    }

    const pivot = a[p]?.[p] ?? 1.0;
    if (Math.abs(pivot) < 1e-12) continue;

    for (let r = p + 1; r < n; r++) {
      const factor = (a[r]?.[p] ?? 0) / pivot;
      const rowR = a[r];
      const rowP = a[p];
      if (rowR && rowP) {
        for (let c = p; c < n; c++) {
          rowR[c] = (rowR[c] ?? 0) - factor * (rowP[c] ?? 0);
        }
        bArr[r] = (bArr[r] ?? 0) - factor * (bArr[p] ?? 0);
      }
    }
  }

  for (let p = n - 1; p >= 0; p--) {
    let sum = bArr[p] ?? 0;
    const rowP = a[p];
    if (rowP) {
      for (let c = p + 1; c < n; c++) {
        sum -= (rowP[c] ?? 0) * (vSol[c] ?? 0);
      }
      vSol[p] = sum / (rowP[p] ?? 1.0);
    }
  }

  // 4. Compute neutral currents and saturation MVAR surges
  const busResults = new Map<string, BusGicResult>();
  let maxNeutralCurrentAmps = 0;
  let maxNeutralBus = "";
  let totalGicLossMvar = 0;
  const atRiskTransformers: string[] = [];

  for (let i = 0; i < n; i++) {
    const busName = busList[i];
    if (!busName) continue;
    const vDc = vSol[i] ?? 0;
    const iNeutral = Math.abs(vDc / rGround);
    const saturationRisk = iNeutral > 10.0;
    // Empirical reactive loss formula: Q_loss ~ 0.05 * I_dc (MVAR)
    const qLossMvar = iNeutral * 0.035;
    totalGicLossMvar += qLossMvar;

    if (saturationRisk) {
      atRiskTransformers.push(busName);
    }
    if (iNeutral > maxNeutralCurrentAmps) {
      maxNeutralCurrentAmps = iNeutral;
      maxNeutralBus = busName;
    }

    busResults.set(busName, {
      busName,
      dcVoltageVolts: vDc,
      neutralCurrentAmps: iNeutral,
      saturationRisk,
      estimatedQReactiveLossMvar: qLossMvar,
    });
  }

  return {
    buses: busResults,
    maxNeutralCurrentAmps,
    maxNeutralBus,
    totalGicLossMvar,
    atRiskTransformers,
  };
}
