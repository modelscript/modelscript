// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD / EMT Netlist Projection for PSS/E RAW Base Cases.
 *
 * Translates transmission grid components (buses, generators, branches,
 * loads, and transformers) into an EMT-compatible Netlist structure ready
 * for time-domain electromagnetic transient simulations (e.g. PSCAD EMTDC / Dommel solver).
 */

import { reduceNetworkEquivalent, type WardEquivalentResult } from "../netlist/ward-equivalencer.js";
import type { PsseCase, PsseDyrCase } from "../types.js";

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
  tapRatio?: number;
  phaseShiftDeg?: number;
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
  /** Computed traveling-wave delay tau = sqrt(L * C) in seconds (for Bergeron selection). */
  travelTimeSec?: number;
  /** Computed surge impedance Zc = sqrt(L / C) in Ohms (for Bergeron lines). */
  surgeImpedanceOhm?: number;
}

export interface PsseEmtDynamicModel {
  id: string;
  busId: string;
  machineId: string;
  psseModelName: string;
  emtTargetKind: "sync_generator" | "exciter_csmf" | "governor_csmf" | "ibr_controller" | "custom_companion";
  params: Record<string, number>;
}

export interface PsseEmtNetlist {
  buses: Map<string, PsseEmtBus>;
  branches: PsseEmtBranch[];
  transformers: PsseEmtTransformer[];
  transmissionLines: PsseEmtTransmissionLine[];
  sources: PsseEmtSource[];
  loads: PsseEmtBranch[];
  dynamicModels?: PsseEmtDynamicModel[];
  sbaseMva: number;
  frequencyHz: number;
}

export interface PsseToEmtOptions {
  /** Optional parsed `.dyr` dynamic data for machine/exciter/governor/IBR projection. */
  dyrCase?: PsseDyrCase | undefined;
  /** Target EMT time step in seconds for Bergeron travel-time selection (default: 50e-6 s). */
  dtEmtSec?: number | undefined;
  /** Automatically promote lines with travel time tau >= dtEmtSec to Bergeron model (default: true). */
  autoSelectBergeron?: boolean | undefined;
}

/**
 * Converts a PSS/E RAW power flow case (and optional `.dyr` dynamics) into an EMT Netlist representation.
 */
export function psseToEmtNetlist(psseCase: PsseCase, options?: PsseToEmtOptions): PsseEmtNetlist {
  const freq = psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0;
  const omega = 2 * Math.PI * freq;
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const dtEmtSec = options?.dtEmtSec ?? 50e-6;
  const autoBergeron = options?.autoSelectBergeron ?? true;

  const buses = new Map<string, PsseEmtBus>();
  const branches: PsseEmtBranch[] = [];
  const transformers: PsseEmtTransformer[] = [];
  const transmissionLines: PsseEmtTransmissionLine[] = [];
  const sources: PsseEmtSource[] = [];
  const loads: PsseEmtBranch[] = [];
  const dynamicModels: PsseEmtDynamicModel[] = [];

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
    const travelTimeSec = cFarad > 1e-12 && lHenry > 1e-12 ? Math.sqrt(lHenry * cFarad) : 0.0;
    const surgeImpedanceOhm = cFarad > 1e-12 && lHenry > 1e-12 ? Math.sqrt(lHenry / cFarad) : undefined;
    const modelType: "pi" | "bergeron" = autoBergeron && travelTimeSec >= dtEmtSec ? "bergeron" : "pi";

    transmissionLines.push({
      id: branchId,
      fromBus: fromBusId,
      toBus: toBusId,
      lengthKm,
      rPerKm: rOhm / lengthKm,
      lPerKm: lHenry / lengthKm,
      cPerKm: cFarad / lengthKm,
      modelType,
      ...(travelTimeSec > 0 ? { travelTimeSec } : {}),
      ...(surgeImpedanceOhm !== undefined ? { surgeImpedanceOhm } : {}),
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
      metadata: { modelType, travelTimeSec, surgeImpedanceOhm },
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
    const tapRatio =
      xfmr.windv1 && xfmr.windv1 > 0 ? xfmr.windv1 / (xfmr.windv2 && xfmr.windv2 > 0 ? xfmr.windv2 : 1.0) : 1.0;
    const phaseShiftDeg = xfmr.ang1 ?? 0.0;
    const windingConnection: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D" =
      Math.abs(Math.abs(phaseShiftDeg) - 30.0) < 2.0 ? (phaseShiftDeg > 0 ? "D-Yg" : "Yg-D") : "Yg-Yg";

    transformers.push({
      id: xfmrId,
      fromBus: fromBusId,
      toBus: toBusId,
      mvaRating: xfmr.sbase12 > 0 ? xfmr.sbase12 : sbase,
      primaryKv: baseKv1,
      secondaryKv: baseKv2,
      leakageReactancePu: xfmr.x12,
      noLoadLossesPu: xfmr.mag1,
      tapRatio,
      phaseShiftDeg,
      windingConnection,
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
        tapRatio: 1.0,
        phaseShiftDeg: -30.0,
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

  // 6. Optional `.dyr` Dynamic Models -> EMT Synchronous Machines / CSMF Controls / IBR Controllers
  if (options?.dyrCase) {
    let dynIdx = 0;
    for (const rec of options.dyrCase.records) {
      if (!psseCase.buses.has(rec.ibus)) continue;
      dynIdx++;
      const name = rec.model.toUpperCase();
      let emtTargetKind: PsseEmtDynamicModel["emtTargetKind"] = "custom_companion";
      const params: Record<string, number> = {};

      if (name === "GENROU" || name === "GENSAL" || name === "GENCLS") {
        emtTargetKind = "sync_generator";
        if (name === "GENCLS") {
          params["H"] = rec.con[0] ?? 4.0;
          params["D"] = rec.con[1] ?? 2.0;
        } else {
          params["Td0p"] = rec.con[0] ?? 6.0;
          params["Td0pp"] = rec.con[1] ?? 0.05;
          params["H"] = rec.con[4] ?? 4.0;
          params["D"] = rec.con[5] ?? 2.0;
          params["Xd"] = rec.con[6] ?? 1.8;
          params["Xq"] = rec.con[7] ?? 1.7;
          params["Xdp"] = rec.con[8] ?? 0.3;
          params["Xdpp"] = rec.con[10] ?? 0.2;
        }
      } else if (name.startsWith("EX") || name === "SEXS" || name === "IEEEX1" || name === "ESST4B") {
        emtTargetKind = "exciter_csmf";
        params["Ka"] = rec.con[1] ?? 50.0;
        params["Ta"] = rec.con[2] ?? 0.05;
        params["Vrmax"] = rec.con[4] ?? 5.0;
        params["Vrmin"] = rec.con[5] ?? -5.0;
      } else if (name.startsWith("TGOV") || name === "HYGOV" || name === "IEESGO" || name === "GGOV1") {
        emtTargetKind = "governor_csmf";
        params["R"] = rec.con[0] ?? 0.05;
        params["T1"] = rec.con[1] ?? 0.5;
        params["Vmax"] = rec.con[2] ?? 1.05;
        params["Vmin"] = rec.con[3] ?? 0.0;
      } else if (name.startsWith("REG") || name.startsWith("REE") || name.startsWith("REP")) {
        emtTargetKind = "ibr_controller";
        for (let i = 0; i < Math.min(rec.con.length, 8); i++) {
          params[`CON_${i + 1}`] = rec.con[i]!;
        }
      } else {
        for (let i = 0; i < Math.min(rec.con.length, 6); i++) {
          params[`CON_${i + 1}`] = rec.con[i]!;
        }
      }

      dynamicModels.push({
        id: `DYN_${rec.ibus}_${rec.id.trim() || "1"}_${name}_${dynIdx}`,
        busId: String(rec.ibus),
        machineId: rec.id.trim() || "1",
        psseModelName: name,
        emtTargetKind,
        params,
      });
    }
  }

  return {
    buses,
    branches,
    transformers,
    transmissionLines,
    sources,
    loads,
    ...(dynamicModels.length > 0 ? { dynamicModels } : {}),
    sbaseMva: sbase,
    frequencyHz: freq,
  };
}

export interface EmtBufferZoneExtractionResult {
  /** Buses inside the k-hop EMT study zone. */
  emtBusNumbers: number[];
  /** Boundary buses interfacing the EMT zone to the external TS grid. */
  boundaryBusNumbers: number[];
  /** Converted EMT netlist for the k-hop study zone. */
  emtNetlist: PsseEmtNetlist;
  /** Ward-reduced external TS case retaining the boundary buses. */
  externalWardEquivalent: WardEquivalentResult;
}

/**
 * Extracts a k-hop EMT buffer zone around `focusBuses` from a bulk PSS/E case
 * (analogous to E-TRAN buffer-zone extraction):
 * - Performs BFS up to `hops` branches/transformers from `focusBuses`.
 * - Identifies boundary buses connecting the EMT zone to the external grid.
 * - Converts the k-hop subgraph to an EMT netlist (`psseToEmtNetlist`).
 * - Computes a Ward equivalent (`reduceNetworkEquivalent`) of the external grid.
 */
export function extractEmtBufferZone(
  psseCase: PsseCase,
  focusBuses: number[],
  hops = 2,
  options?: PsseToEmtOptions,
): EmtBufferZoneExtractionResult {
  // Build adjacency list from active branches & transformers
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const br of psseCase.branches) {
    if (br.st !== 0) link(br.i, br.j);
  }
  for (const tf of psseCase.transformers) {
    if (tf.stat !== 0) {
      link(tf.i, tf.j);
      if (tf.k !== 0) link(tf.i, tf.k);
    }
  }

  const visited = new Set<number>();
  let frontier = new Set<number>(focusBuses.filter((b) => psseCase.buses.has(b)));
  for (const b of frontier) visited.add(b);

  for (let depth = 0; depth < Math.max(0, hops); depth++) {
    const next = new Set<number>();
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (!visited.has(v) && psseCase.buses.has(v)) {
          visited.add(v);
          next.add(v);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  // Boundary buses are EMT-zone buses that have at least one neighbor outside the EMT zone
  const boundaryBusNumbers: number[] = [];
  for (const u of visited) {
    const neighbors = adj.get(u);
    if (neighbors) {
      for (const v of neighbors) {
        if (!visited.has(v)) {
          boundaryBusNumbers.push(u);
          break;
        }
      }
    }
  }

  const emtBusNumbers = Array.from(visited).sort((a, b) => a - b);
  boundaryBusNumbers.sort((a, b) => a - b);

  // Build sub-case containing only EMT-zone buses and internal equipment
  const subBuses = new Map<number, typeof psseCase.buses extends Map<number, infer V> ? V : never>();
  for (const b of emtBusNumbers) {
    const rec = psseCase.buses.get(b);
    if (rec) subBuses.set(b, { ...rec });
  }
  const emtSubCase: PsseCase = {
    ...psseCase,
    buses: subBuses,
    loads: psseCase.loads.filter((l) => visited.has(l.i)),
    fixedShunts: psseCase.fixedShunts.filter((s) => visited.has(s.i)),
    generators: psseCase.generators.filter((g) => visited.has(g.i)),
    branches: psseCase.branches.filter((br) => visited.has(br.i) && visited.has(br.j)),
    transformers: psseCase.transformers.filter(
      (tf) => visited.has(tf.i) && visited.has(tf.j) && (!tf.k || visited.has(tf.k)),
    ),
    switchedShunts: psseCase.switchedShunts.filter((s) => visited.has(s.i)),
  };

  const emtNetlist = psseToEmtNetlist(emtSubCase, options);
  const retainedForWard = boundaryBusNumbers.length > 0 ? boundaryBusNumbers : emtBusNumbers;
  const externalWardEquivalent = reduceNetworkEquivalent(psseCase, retainedForWard);

  return {
    emtBusNumbers,
    boundaryBusNumbers,
    emtNetlist,
    externalWardEquivalent,
  };
}
