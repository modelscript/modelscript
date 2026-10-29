// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD / EMT Netlist Projection for PSS/E RAW Base Cases.
 *
 * Translates transmission grid components (buses, generators, branches,
 * loads, and transformers) into an EMT-compatible Netlist structure ready
 * for time-domain electromagnetic transient simulations (e.g. PSCAD EMTDC / Dommel solver).
 */

import type { PsseCase } from "../types.js";

export interface PsseEmtBus {
  id: string;
  name: string;
  baseKv: number;
  phaseCount: number;
  connectedBranchIds: string[];
}

export interface PsseEmtBranch {
  id: string;
  kind: "rlc" | "transmission_line" | "transformer" | "switch" | "source";
  fromBus: string;
  toBus: string;
  resistanceOhm: number;
  inductanceH: number;
  capacitanceF: number;
  status?: "open" | "closed";
  metadata?: Record<string, unknown>;
}

export interface PsseEmtTransformer {
  id: string;
  fromBus: string;
  toBus: string;
  mvaRating: number;
  primaryKv: number;
  secondaryKv: number;
  leakageReactancePu: number;
  noLoadLossesPu?: number;
  windingConnection: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D";
}

export interface PsseEmtSource {
  id: string;
  name: string;
  bus: string;
  vPeakKv: number;
  frequencyHz: number;
  phaseRad: number;
  mvaRating: number;
  rSourceOhm?: number;
  lSourceH?: number;
}

export interface PsseEmtTransmissionLine {
  id: string;
  fromBus: string;
  toBus: string;
  lengthKm: number;
  rPerKm: number;
  lPerKm: number;
  cPerKm: number;
  modelType: "pi" | "bergeron" | "fdpm";
}

export interface PsseEmtNetlist {
  buses: Map<string, PsseEmtBus>;
  branches: PsseEmtBranch[];
  transformers: PsseEmtTransformer[];
  transmissionLines: PsseEmtTransmissionLine[];
  sources: PsseEmtSource[];
  loads: PsseEmtBranch[];
  sbaseMva: number;
  frequencyHz: number;
}

/**
 * Converts a PSS/E RAW power flow case into an EMT Netlist representation.
 */
export function psseToEmtNetlist(psseCase: PsseCase): PsseEmtNetlist {
  const freq = psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0;
  const omega = 2 * Math.PI * freq;
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;

  const buses = new Map<string, PsseEmtBus>();
  const branches: PsseEmtBranch[] = [];
  const transformers: PsseEmtTransformer[] = [];
  const transmissionLines: PsseEmtTransmissionLine[] = [];
  const sources: PsseEmtSource[] = [];
  const loads: PsseEmtBranch[] = [];

  // 1. Buses
  for (const bus of psseCase.buses.values()) {
    const busId = String(bus.i);
    const baseKv = bus.baseKv > 0 ? bus.baseKv : 138.0;
    buses.set(busId, {
      id: busId,
      name: bus.name.trim() || `Bus ${bus.i}`,
      baseKv,
      phaseCount: 3,
      connectedBranchIds: [],
    });
  }

  // 2. Generators -> EMT Sources
  let genIdx = 0;
  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue;
    genIdx++;
    const busId = String(gen.i);
    const bus = psseCase.buses.get(gen.i);
    const baseKv = bus && bus.baseKv > 0 ? bus.baseKv : 138.0;
    const vNomKv = (baseKv * Math.SQRT2) / Math.sqrt(3); // Peak phase-to-ground kV
    const vPeakKv = gen.vs > 0 ? gen.vs * vNomKv : vNomKv;
    const mbase = gen.mbase > 0 ? gen.mbase : sbase;

    // Subtransient or internal impedance
    const zBase = (baseKv * baseKv) / mbase;
    const rOhm = gen.zr > 0 ? gen.zr * zBase : 0.05 * zBase;
    const xOhm = gen.zx > 0 ? gen.zx * zBase : 0.15 * zBase;
    const lHenry = xOhm / omega;

    const phaseRad = ((bus?.va ?? 0) * Math.PI) / 180;
    sources.push({
      id: `SRC_${gen.i}_${gen.id.trim() || genIdx}`,
      name: `Generator ${gen.i} [${gen.id.trim()}]`,
      bus: busId,
      vPeakKv,
      frequencyHz: freq,
      phaseRad,
      mvaRating: mbase,
      rSourceOhm: rOhm,
      lSourceH: lHenry,
    });
  }

  // 3. Branches -> Transmission Lines & Pi-Model Branches
  let branchIdx = 0;
  for (const br of psseCase.branches) {
    if (br.st === 0) continue;
    branchIdx++;
    const fromBusId = String(br.i);
    const toBusId = String(br.j);
    const fromBus = psseCase.buses.get(br.i);
    const baseKv = fromBus && fromBus.baseKv > 0 ? fromBus.baseKv : 138.0;
    const zBase = (baseKv * baseKv) / sbase;

    const rOhm = Math.max(1e-4, br.r * zBase);
    const xOhm = Math.max(1e-4, br.x * zBase);
    const lHenry = xOhm / omega;
    const bSiemens = br.b / zBase;
    const cFarad = bSiemens / omega;
    const branchId = `BR_${br.i}_${br.j}_${br.ckt.trim() || branchIdx}`;

    const lengthKm = br.len > 0 ? br.len : 10.0;
    transmissionLines.push({
      id: branchId,
      fromBus: fromBusId,
      toBus: toBusId,
      lengthKm,
      rPerKm: rOhm / lengthKm,
      lPerKm: lHenry / lengthKm,
      cPerKm: cFarad / lengthKm,
      modelType: "pi",
    });

    branches.push({
      id: branchId,
      kind: "transmission_line",
      fromBus: fromBusId,
      toBus: toBusId,
      resistanceOhm: rOhm,
      inductanceH: lHenry,
      capacitanceF: cFarad,
      status: "closed",
    });

    buses.get(fromBusId)?.connectedBranchIds.push(branchId);
    buses.get(toBusId)?.connectedBranchIds.push(branchId);
  }

  // 4. Two-Winding & Three-Winding Transformers
  let xfmrIdx = 0;
  for (const xfmr of psseCase.transformers) {
    if (xfmr.stat === 0) continue;
    xfmrIdx++;
    const fromBusId = String(xfmr.i);
    const toBusId = String(xfmr.j);
    const fromBus = psseCase.buses.get(xfmr.i);
    const toBus = psseCase.buses.get(xfmr.j);
    const baseKv1 = fromBus && fromBus.baseKv > 0 ? fromBus.baseKv : 138.0;
    const baseKv2 = toBus && toBus.baseKv > 0 ? toBus.baseKv : 13.8;
    const xfmrId = `XFMR_${xfmr.i}_${xfmr.j}_${xfmr.ckt.trim() || xfmrIdx}`;

    transformers.push({
      id: xfmrId,
      fromBus: fromBusId,
      toBus: toBusId,
      mvaRating: xfmr.sbase12 > 0 ? xfmr.sbase12 : sbase,
      primaryKv: baseKv1,
      secondaryKv: baseKv2,
      leakageReactancePu: xfmr.x12,
      noLoadLossesPu: xfmr.mag1,
      windingConnection: "Yg-Yg",
    });

    buses.get(fromBusId)?.connectedBranchIds.push(xfmrId);
    buses.get(toBusId)?.connectedBranchIds.push(xfmrId);

    if (xfmr.k !== 0 && psseCase.buses.has(xfmr.k)) {
      const tertBusId = String(xfmr.k);
      const tertBus = psseCase.buses.get(xfmr.k);
      const baseKv3 = tertBus && tertBus.baseKv > 0 ? tertBus.baseKv : 13.8;
      const w3Id = `XFMR_${xfmr.i}_${xfmr.k}_${xfmr.ckt.trim() || xfmrIdx}_W3`;
      transformers.push({
        id: w3Id,
        fromBus: fromBusId,
        toBus: tertBusId,
        mvaRating: xfmr.sbase31 && xfmr.sbase31 > 0 ? xfmr.sbase31 : sbase,
        primaryKv: baseKv1,
        secondaryKv: baseKv3,
        leakageReactancePu: xfmr.x31 ?? xfmr.x12,
        noLoadLossesPu: 0,
        windingConnection: "Yg-D",
      });
      buses.get(fromBusId)?.connectedBranchIds.push(w3Id);
      buses.get(tertBusId)?.connectedBranchIds.push(w3Id);
    }
  }

  // 5. Loads & Shunts -> R-L-C Shunt Branches to Ground
  let loadIdx = 0;
  for (const load of psseCase.loads) {
    if (load.status === 0) continue;
    loadIdx++;
    const busId = String(load.i);
    const bus = psseCase.buses.get(load.i);
    const baseKv = bus && bus.baseKv > 0 ? bus.baseKv : 138.0;
    const rOhm = load.pl > 0.001 ? (baseKv * baseKv) / load.pl : 1e6;
    const xOhm = load.ql > 0.001 ? (baseKv * baseKv) / load.ql : 1e6;
    const lHenry = xOhm / omega;

    loads.push({
      id: `LOAD_${load.i}_${load.id.trim() || loadIdx}`,
      kind: "rlc",
      fromBus: busId,
      toBus: "GND",
      resistanceOhm: rOhm,
      inductanceH: lHenry,
      capacitanceF: 0,
      status: "closed",
    });
  }

  return {
    buses,
    branches,
    transformers,
    transmissionLines,
    sources,
    loads,
    sbaseMva: sbase,
    frequencyHz: freq,
  };
}
