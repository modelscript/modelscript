// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Projection from CIM / CGMES to PSS/E Base Case (PsseCase).
 */

import {
  type BranchRecord,
  type BusRecord,
  BusType,
  type FixedShuntRecord,
  type GeneratorRecord,
  type LoadRecord,
  type PsseCase,
  type TransformerRecord,
} from "@modelscript/psse";
import { processTopology } from "../topology/topology-processor.js";
import type { CgmesModel } from "../types.js";

export interface CgmesToPsseOptions {
  sbaseMva?: number;
  impedanceInOhms?: boolean | "auto";
}

export interface CgmesToPsseResult {
  psseCase: PsseCase;
  nodeToBusNum: Map<string, number>;
  busNumToNode: Map<number, string>;
}

/**
 * Converts a CGMES model into a standard PSS/E base case.
 */
export function cgmesToPsse(model: CgmesModel, options: CgmesToPsseOptions = {}): CgmesToPsseResult {
  const sbase = options.sbaseMva ?? 100.0;
  const topo = processTopology(model);

  const nodeToBusNum = new Map<string, number>();
  const busNumToNode = new Map<number, string>();
  const buses = new Map<number, BusRecord>();

  // 1. Assign bus numbers to TopologicalNodes
  let busCounter = 1;
  const usedBuses = new Set<number>();

  const svByNodeId = new Map<string, { vPu: number; angleDeg: number }>();
  for (const sv of topo.model.svVoltages.values()) {
    if (sv.topologicalNodeId) {
      svByNodeId.set(sv.topologicalNodeId, sv);
    }
  }

  for (const [nodeId, node] of topo.model.nodes.entries()) {
    let busNum: number;
    const match = nodeId.match(/_node_(\d+)$/) || node.name?.match(/BUS_?(\d+)$/i);
    if (match) {
      busNum = parseInt(match[1]!, 10);
    } else {
      while (usedBuses.has(busCounter)) busCounter++;
      busNum = busCounter++;
    }
    usedBuses.add(busNum);
    nodeToBusNum.set(nodeId, busNum);
    busNumToNode.set(busNum, nodeId);

    // Check if voltage is given in SV
    const sv = svByNodeId.get(nodeId) ?? topo.model.svVoltages.get(nodeId);
    const vm = sv ? sv.vPu : 1.0;
    const va = sv ? sv.angleDeg : 0.0;

    buses.set(busNum, {
      i: busNum,
      name: (node.name || `BUS_${busNum}`).slice(0, 12),
      baseKv: node.baseVoltageKv > 0 ? node.baseVoltageKv : 400.0,
      ide: BusType.PQ, // Will update below if generator exists
      area: 1,
      zone: 1,
      owner: 1,
      vm,
      va,
    });
  }

  // Helper to get bus number for a terminal
  function getBusForTerminal(termId: string): number | undefined {
    const nodeId = topo.terminalToNode.get(termId);
    return nodeId ? nodeToBusNum.get(nodeId) : undefined;
  }

  // Equipment terminals map
  const equipmentTerminals = new Map<string, string[]>();
  for (const term of topo.model.terminals.values()) {
    const list = equipmentTerminals.get(term.conductingEquipmentId) ?? [];
    list.push(term.mRID);
    equipmentTerminals.set(term.conductingEquipmentId, list);
  }

  // 2. Generators (SynchronousMachine)
  const generators: GeneratorRecord[] = [];
  let largestGenCapacity = -1;
  let swingBusCandidate: number | undefined;

  for (const gen of topo.model.generators.values()) {
    const terms = equipmentTerminals.get(gen.mRID);
    if (!terms || terms.length === 0) continue;
    const busNum = getBusForTerminal(terms[0]!);
    if (!busNum) continue;

    const bus = buses.get(busNum);
    if (bus) {
      bus.ide = BusType.PV;
      if (gen.maxPMw > largestGenCapacity) {
        largestGenCapacity = gen.maxPMw;
        swingBusCandidate = busNum;
      }
    }

    generators.push({
      i: busNum,
      id: "1",
      pg: gen.pMw,
      qg: gen.qMvar,
      qt: gen.maxQMvar,
      qb: gen.minQMvar,
      vs: bus?.vm ?? 1.0,
      ireg: 0,
      mbase: gen.ratedSMva ?? sbase,
      zr: 0.0,
      zx: 0.2,
      rt: 0.0,
      xt: 0.2,
      gtap: 1.0,
      stat: 1,
      rmpct: 100.0,
      pt: gen.maxPMw,
      pb: gen.minPMw,
    });
  }

  // Mark the swing bus
  if (swingBusCandidate && buses.has(swingBusCandidate)) {
    buses.get(swingBusCandidate)!.ide = BusType.Swing;
  }

  // 3. Loads (EnergyConsumer)
  const loads: LoadRecord[] = [];
  for (const load of topo.model.loads.values()) {
    const terms = equipmentTerminals.get(load.mRID);
    if (!terms || terms.length === 0) continue;
    const busNum = getBusForTerminal(terms[0]!);
    if (!busNum) continue;

    loads.push({
      i: busNum,
      id: "1",
      status: 1,
      area: 1,
      zone: 1,
      pl: load.pMw,
      ql: load.qMvar,
      ip: 0,
      iq: 0,
      yp: 0,
      yq: 0,
      owner: 1,
      scale: 1,
      intrct: 1,
    });
  }

  // 4. Fixed Shunts (LinearShuntCompensator)
  const fixedShunts: FixedShuntRecord[] = [];
  for (const shunt of topo.model.shunts.values()) {
    const terms = equipmentTerminals.get(shunt.mRID);
    if (!terms || terms.length === 0) continue;
    const busNum = getBusForTerminal(terms[0]!);
    if (!busNum) continue;

    const bus = buses.get(busNum);
    const baseKv = bus?.baseKv ?? 400.0;
    const zBase = (baseKv * baseKv) / sbase;

    // Convert Siemens to MVAr/MW at 1.0 pu
    const gl = shunt.gPerSection * shunt.sections * zBase * sbase;
    const bl = shunt.bPerSection * shunt.sections * zBase * sbase;

    fixedShunts.push({
      i: busNum,
      id: "1",
      status: 1,
      gl,
      bl,
    });
  }

  // 5. AC Line Segments -> Branches
  const branches: BranchRecord[] = [];
  for (const line of topo.model.lines.values()) {
    const terms = equipmentTerminals.get(line.mRID);
    if (!terms || terms.length < 2) continue;

    const i = getBusForTerminal(terms[0]!);
    const j = getBusForTerminal(terms[1]!);
    if (!i || !j || i === j) continue;

    const busI = buses.get(i);
    const baseKv = busI?.baseKv ?? 400.0;
    const zBase = (baseKv * baseKv) / sbase;

    let isOhm = false;
    if (options.impedanceInOhms === true) {
      isOhm = true;
    } else if (options.impedanceInOhms === "auto" || options.impedanceInOhms === undefined) {
      isOhm = line.x > 0.5 || line.r > 0.5;
    }

    const rPu = isOhm ? line.r / zBase : line.r;
    const xPu = isOhm ? line.x / zBase : line.x;
    const bPu = isOhm ? line.bch * zBase : line.bch;

    let rateA = 1000.0;
    if (line.ratedCurrentA && line.ratedCurrentA > 0) {
      rateA = (Math.sqrt(3) * baseKv * line.ratedCurrentA) / 1000.0;
    }

    branches.push({
      i,
      j,
      ckt: "1",
      r: rPu,
      x: Math.max(xPu, 1e-4),
      b: bPu,
      rateA,
      rateB: rateA * 1.1,
      rateC: rateA * 1.25,
      gi: 0,
      bi: 0,
      gj: 0,
      bj: 0,
      st: 1,
      met: 1,
      len: line.lengthKm ?? 1.0,
    });
  }

  // 6. Power Transformers
  const transformers: TransformerRecord[] = [];
  for (const [xfId] of topo.model.transformers.entries()) {
    const ends: Array<{ busNum: number; r: number; x: number; sbase: number; ratedU: number }> = [];

    for (const end of topo.model.transformerEnds.values()) {
      if (end.powerTransformerId === xfId && end.terminalId) {
        const busNum = getBusForTerminal(end.terminalId);
        if (busNum) {
          ends.push({
            busNum,
            r: end.r,
            x: end.x,
            sbase: end.ratedSMva,
            ratedU: end.ratedUkV,
          });
        }
      }
    }

    if (ends.length >= 2) {
      const e1 = ends[0]!;
      const e2 = ends[1]!;
      const bus1 = buses.get(e1.busNum);
      const bus2 = buses.get(e2.busNum);

      transformers.push({
        i: e1.busNum,
        j: e2.busNum,
        k: 0,
        ckt: "1",
        cw: 1,
        cm: 1,
        mag1: 0,
        mag2: 0,
        nmetr: 2,
        name: `XF_${xfId.slice(0, 8)}`,
        stat: 1,
        r12: e1.r + e2.r,
        x12: Math.max(e1.x + e2.x, 1e-4),
        sbase12: e1.sbase || sbase,
        windv1: 1.0,
        nomv1: bus1?.baseKv ?? e1.ratedU,
        ang1: 0.0,
        rata1: e1.sbase || 100.0,
        ratb1: (e1.sbase || 100.0) * 1.1,
        ratc1: (e1.sbase || 100.0) * 1.25,
        cod1: 0,
        cont1: 0,
        rma1: 1.1,
        rmi1: 0.9,
        vma1: 1.1,
        vmi1: 0.9,
        ntp1: 33,
        tab1: 0,
        cr1: 0,
        cx1: 0,
        cnxa1: 0,
        windv2: 1.0,
        nomv2: bus2?.baseKv ?? e2.ratedU,
      });
    }
  }

  const psseCase: PsseCase = {
    header: {
      ic: 0,
      sbase,
      rev: 33,
      xfrrat: 0,
      nxfrat: 0,
      basfrq: 50.0, // Standard European frequency
    },
    title1: "CGMES IMPORTED TRANSMISSION NETWORK",
    title2: `CONVERTED BY @modelscript/cgmes (${buses.size} BUSES)`,
    buses,
    loads,
    fixedShunts,
    generators,
    branches,
    transformers,
    areas: [{ i: 1, isw: 1, pdes: 0, ptol: 10, arname: "AREA_1" }],
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: [],
  };

  return {
    psseCase,
    nodeToBusNum,
    busNumToNode,
  };
}
