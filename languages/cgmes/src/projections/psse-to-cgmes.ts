// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Projection from PSS/E Base Case (PsseCase) to CIM / CGMES.
 *
 * Implements European Network of Transmission System Operators for Electricity (ENTSO-E)
 * Common Grid Model Exchange Standard (CGMES v2.4.15 and v3.0 / IEC 61970-301):
 * - Equipment Profile (EQ): Substations, VoltageLevels, Busbars, AC Lines, Transformers, Machines, Loads, Shunts, Terminals
 * - Topology Profile (TP): TopologicalNodes, Terminal-to-Node associations
 * - Steady State Hypothesis Profile (SSH): Generator active/reactive setpoints, load powers
 * - State Variables Profile (SV): Solved bus voltage magnitudes and angles (SvVoltage), power flows (SvPowerFlow)
 */

import type { BusRecord, PsseCase } from "@modelscript/psse";
import { createEmptyCgmesModel } from "../parser/cgmes-rdf-parser.js";
import type {
  CgmesACLineSegment,
  CgmesBusbarSection,
  CgmesEnergyConsumer,
  CgmesLinearShuntCompensator,
  CgmesModel,
  CgmesPowerTransformer,
  CgmesPowerTransformerEnd,
  CgmesSubstation,
  CgmesSvVoltage,
  CgmesSynchronousMachine,
  CgmesTerminal,
  CgmesTopologicalNode,
  CgmesVoltageLevel,
} from "../types.js";

export interface PsseToCgmesOptions {
  /** Base power in MVA (default: derived from psCase.header.sbase or 100.0). */
  sbaseMva?: number | undefined;
  /** Whether line impedances are emitted in Ohms (true) or per-unit (false) (default: false). */
  impedanceInOhms?: boolean | undefined;
}

export interface PsseToCgmesResult {
  model: CgmesModel;
  busNumToNodeId: Map<number, string>;
  nodeIdToBusNum: Map<string, number>;
}

/**
 * Converts a PSS/E base case (PsseCase) into an in-memory CGMES model.
 */
export function psseToCgmes(psCase: PsseCase, options: PsseToCgmesOptions = {}): PsseToCgmesResult {
  const model = createEmptyCgmesModel();
  const sbase = options.sbaseMva ?? (psCase.header.sbase > 0 ? psCase.header.sbase : 100.0);

  const busNumToNodeId = new Map<number, string>();
  const nodeIdToBusNum = new Map<string, number>();

  const busList: BusRecord[] = Array.from(psCase.buses.values());

  // 1. Base Voltages & Buses -> TopologicalNodes, Substations, VoltageLevels, Busbars, SvVoltages
  for (const bus of busList) {
    const busNum = bus.i;
    const nodeId = `_node_${busNum}`;
    const subId = `_sub_${bus.area ?? 1}_${busNum}`;
    const vlId = `_vl_${busNum}`;
    const bbId = `_bb_${busNum}`;
    const baseKv = bus.baseKv > 0 ? bus.baseKv : 400.0;
    const busName = (bus.name?.trim() || `BUS_${busNum}`).replace(/[^\w-]/g, "_");

    busNumToNodeId.set(busNum, nodeId);
    nodeIdToBusNum.set(nodeId, busNum);

    // Substation (EQ)
    const sub: CgmesSubstation = {
      mRID: subId,
      name: `Sub_${busName}`,
      region: `Area_${bus.area ?? 1}`,
      description: `Substation for PSS/E bus ${busNum}`,
    };
    model.substations.set(subId, sub);

    // VoltageLevel (EQ)
    const vl: CgmesVoltageLevel = {
      mRID: vlId,
      name: `VL_${busName}`,
      substationId: subId,
      baseVoltageKv: baseKv,
      lowVoltageLimit: baseKv * 0.9,
      highVoltageLimit: baseKv * 1.1,
    };
    model.voltageLevels.set(vlId, vl);

    // BusbarSection (EQ)
    const bb: CgmesBusbarSection = {
      mRID: bbId,
      name: `BB_${busName}`,
      voltageLevelId: vlId,
    };
    model.busbars.set(bbId, bb);

    // TopologicalNode (TP)
    const tn: CgmesTopologicalNode = {
      mRID: nodeId,
      name: busName,
      baseVoltageKv: baseKv,
      voltageLevelId: vlId,
      description: `PSS/E Bus ${busNum} (Type ${bus.ide})`,
    };
    model.nodes.set(nodeId, tn);

    // State Variables (SV): Solved Bus Voltage
    const svV: CgmesSvVoltage = {
      topologicalNodeId: nodeId,
      vPu: typeof bus.vm === "number" ? bus.vm : 1.0,
      angleDeg: typeof bus.va === "number" ? bus.va : 0.0,
    };
    model.svVoltages.set(`_sv_v_${busNum}`, svV);
  }

  // 2. Generators (EQ + SSH)
  for (const gen of psCase.generators) {
    if (gen.stat === 0) continue; // Skip out-of-service generators
    const busNum = gen.i;
    const nodeId = busNumToNodeId.get(busNum);
    if (!nodeId) continue;

    const genId = `_gen_${busNum}_${gen.id.trim()}`;
    const termId = `_term_gen_${busNum}_${gen.id.trim()}`;

    const machine: CgmesSynchronousMachine = {
      mRID: genId,
      name: `GEN_${busNum}_${gen.id.trim()}`,
      pMw: gen.pg,
      qMvar: gen.qg,
      minPMw: gen.pb,
      maxPMw: gen.pt > 0 ? gen.pt : Math.max(1000.0, gen.pg * 2),
      minQMvar: gen.qb,
      maxQMvar: gen.qt,
      ratedSMva: gen.mbase > 0 ? gen.mbase : sbase,
      genType: "generator",
      description: `SynchronousMachine at Bus ${busNum} ID ${gen.id.trim()}`,
    };
    model.generators.set(genId, machine);

    const term: CgmesTerminal = {
      mRID: termId,
      name: `T_GEN_${busNum}_${gen.id.trim()}`,
      conductingEquipmentId: genId,
      topologicalNodeId: nodeId,
      sequenceNumber: 1,
    };
    model.terminals.set(termId, term);
  }

  // 3. Loads (EQ + SSH)
  for (const load of psCase.loads) {
    if (load.status === 0) continue;
    const busNum = load.i;
    const nodeId = busNumToNodeId.get(busNum);
    if (!nodeId) continue;

    const loadId = `_load_${busNum}_${load.id.trim()}`;
    const termId = `_term_load_${busNum}_${load.id.trim()}`;

    const consumer: CgmesEnergyConsumer = {
      mRID: loadId,
      name: `LOAD_${busNum}_${load.id.trim()}`,
      pMw: load.pl,
      qMvar: load.ql,
      description: `EnergyConsumer at Bus ${busNum} ID ${load.id.trim()}`,
    };
    model.loads.set(loadId, consumer);

    const term: CgmesTerminal = {
      mRID: termId,
      name: `T_LOAD_${busNum}_${load.id.trim()}`,
      conductingEquipmentId: loadId,
      topologicalNodeId: nodeId,
      sequenceNumber: 1,
    };
    model.terminals.set(termId, term);
  }

  // 4. Fixed Shunts (EQ)
  for (const shunt of psCase.fixedShunts) {
    if (shunt.status === 0) continue;
    const busNum = shunt.i;
    const nodeId = busNumToNodeId.get(busNum);
    const bus = psCase.buses.get(busNum);
    if (!nodeId || !bus) continue;

    const shuntId = `_shunt_${busNum}_${shunt.id.trim()}`;
    const termId = `_term_shunt_${busNum}_${shunt.id.trim()}`;

    const baseKv = bus.baseKv > 0 ? bus.baseKv : 400.0;
    const zBase = (baseKv * baseKv) / sbase;
    const yBase = 1.0 / zBase;

    // Convert MW/MVAr at 1.0 pu into Siemens
    const gSiemens = (shunt.gl / sbase) * yBase;
    const bSiemens = (shunt.bl / sbase) * yBase;

    const comp: CgmesLinearShuntCompensator = {
      mRID: shuntId,
      name: `SHUNT_${busNum}_${shunt.id.trim()}`,
      gPerSection: gSiemens,
      bPerSection: bSiemens,
      sections: 1,
      description: `Shunt at Bus ${busNum} ID ${shunt.id.trim()}`,
    };
    model.shunts.set(shuntId, comp);

    const term: CgmesTerminal = {
      mRID: termId,
      name: `T_SHUNT_${busNum}_${shunt.id.trim()}`,
      conductingEquipmentId: shuntId,
      topologicalNodeId: nodeId,
      sequenceNumber: 1,
    };
    model.terminals.set(termId, term);
  }

  // 5. AC Line Segments -> Branches (EQ)
  for (const br of psCase.branches) {
    if (br.st === 0) continue;
    const nodeFrom = busNumToNodeId.get(br.i);
    const nodeTo = busNumToNodeId.get(br.j);
    const busFrom = psCase.buses.get(br.i);
    if (!nodeFrom || !nodeTo || !busFrom) continue;

    const ckt = br.ckt.trim() || "1";
    const lineId = `_line_${br.i}_${br.j}_${ckt}`;
    const term1Id = `_term_line_${br.i}_${br.j}_${ckt}_1`;
    const term2Id = `_term_line_${br.i}_${br.j}_${ckt}_2`;

    const baseKv = busFrom.baseKv > 0 ? busFrom.baseKv : 400.0;
    const zBase = (baseKv * baseKv) / sbase;

    const r = options.impedanceInOhms ? br.r * zBase : br.r;
    const x = options.impedanceInOhms ? br.x * zBase : br.x;
    const bch = options.impedanceInOhms ? br.b / zBase : br.b;

    const line: CgmesACLineSegment = {
      mRID: lineId,
      name: `LINE_${br.i}_${br.j}_${ckt}`,
      r,
      x,
      bch,
      gch: 0.0,
      lengthKm: 1.0,
      ratedCurrentA: br.rateA > 0 ? (br.rateA * 1e6) / (Math.sqrt(3.0) * baseKv * 1e3) : 1000.0,
      description: `Transmission Line ${br.i}-${br.j} CKT ${ckt}`,
    };
    model.lines.set(lineId, line);

    const term1: CgmesTerminal = {
      mRID: term1Id,
      name: `T1_LINE_${br.i}_${br.j}_${ckt}`,
      conductingEquipmentId: lineId,
      topologicalNodeId: nodeFrom,
      sequenceNumber: 1,
    };
    model.terminals.set(term1Id, term1);

    const term2: CgmesTerminal = {
      mRID: term2Id,
      name: `T2_LINE_${br.i}_${br.j}_${ckt}`,
      conductingEquipmentId: lineId,
      topologicalNodeId: nodeTo,
      sequenceNumber: 2,
    };
    model.terminals.set(term2Id, term2);
  }

  // 6. Transformers (EQ)
  for (const xf of psCase.transformers) {
    if (xf.stat === 0) continue;
    const nodeFrom = busNumToNodeId.get(xf.i);
    const nodeTo = busNumToNodeId.get(xf.j);
    const busFrom = psCase.buses.get(xf.i);
    const busTo = psCase.buses.get(xf.j);
    if (!nodeFrom || !nodeTo || !busFrom || !busTo) continue;

    const ckt = xf.ckt.trim() || "1";
    const xfId = `_xf_${xf.i}_${xf.j}_${ckt}`;
    const term1Id = `_term_xf_${xf.i}_${xf.j}_${ckt}_1`;
    const term2Id = `_term_xf_${xf.i}_${xf.j}_${ckt}_2`;
    const end1Id = `_xfend_${xf.i}_${xf.j}_${ckt}_1`;
    const end2Id = `_xfend_${xf.i}_${xf.j}_${ckt}_2`;

    const ratedS = xf.sbase12 > 0 ? xf.sbase12 : sbase;
    const nomUkV1 = xf.nomv1 > 0 ? xf.nomv1 : busFrom.baseKv;
    const nomUkV2 = xf.nomv2 > 0 ? xf.nomv2 : busTo.baseKv;

    const transformer: CgmesPowerTransformer = {
      mRID: xfId,
      name: `XF_${xf.i}_${xf.j}_${ckt}`,
      substationId: `_sub_${busFrom.area ?? 1}_${xf.i}`,
      description: `PowerTransformer ${xf.i}-${xf.j} CKT ${ckt}`,
    };
    model.transformers.set(xfId, transformer);

    const term1: CgmesTerminal = {
      mRID: term1Id,
      name: `T1_XF_${xf.i}_${xf.j}_${ckt}`,
      conductingEquipmentId: xfId,
      topologicalNodeId: nodeFrom,
      sequenceNumber: 1,
    };
    model.terminals.set(term1Id, term1);

    const term2: CgmesTerminal = {
      mRID: term2Id,
      name: `T2_XF_${xf.i}_${xf.j}_${ckt}`,
      conductingEquipmentId: xfId,
      topologicalNodeId: nodeTo,
      sequenceNumber: 2,
    };
    model.terminals.set(term2Id, term2);

    const end1: CgmesPowerTransformerEnd = {
      mRID: end1Id,
      name: `END1_XF_${xf.i}_${xf.j}_${ckt}`,
      powerTransformerId: xfId,
      terminalId: term1Id,
      endNumber: 1,
      r: xf.r12,
      x: xf.x12,
      b: xf.mag2,
      g: xf.mag1,
      ratedUkV: nomUkV1,
      ratedSMva: ratedS,
    };
    model.transformerEnds.set(end1Id, end1);

    const end2: CgmesPowerTransformerEnd = {
      mRID: end2Id,
      name: `END2_XF_${xf.i}_${xf.j}_${ckt}`,
      powerTransformerId: xfId,
      terminalId: term2Id,
      endNumber: 2,
      r: 0.0,
      x: 0.0,
      b: 0.0,
      g: 0.0,
      ratedUkV: nomUkV2,
      ratedSMva: ratedS,
    };
    model.transformerEnds.set(end2Id, end2);
  }

  return {
    model,
    busNumToNodeId,
    nodeIdToBusNum,
  };
}

/**
 * Serializes an in-memory CGMES model into standard IEC 61970 CIM RDF/XML format
 * for a specific CGMES profile ("EQ", "TP", "SSH", "SV").
 */
export function serializeCgmesXml(model: CgmesModel, profile: "EQ" | "TP" | "SSH" | "SV"): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(
    `<rdf:RDF xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`,
  );

  if (profile === "EQ") {
    // Unique BaseVoltages
    const baseVoltages = new Set<number>();
    for (const vl of model.voltageLevels.values()) {
      baseVoltages.add(vl.baseVoltageKv);
    }
    for (const tn of model.nodes.values()) {
      baseVoltages.add(tn.baseVoltageKv);
    }

    for (const bv of baseVoltages) {
      lines.push(`  <cim:BaseVoltage rdf:ID="_bv_${Math.round(bv)}">`);
      lines.push(`    <cim:BaseVoltage.nominalVoltage>${bv.toFixed(1)}</cim:BaseVoltage.nominalVoltage>`);
      lines.push(`  </cim:BaseVoltage>`);
    }

    // Substations
    for (const sub of model.substations.values()) {
      lines.push(`  <cim:Substation rdf:ID="${sub.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${sub.name}</cim:IdentifiedObject.name>`);
      if (sub.region) {
        lines.push(`    <cim:Substation.Region rdf:resource="#${sub.region}"/>`);
      }
      lines.push(`  </cim:Substation>`);
    }

    // VoltageLevels
    for (const vl of model.voltageLevels.values()) {
      lines.push(`  <cim:VoltageLevel rdf:ID="${vl.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${vl.name}</cim:IdentifiedObject.name>`);
      lines.push(`    <cim:VoltageLevel.BaseVoltage rdf:resource="#_bv_${Math.round(vl.baseVoltageKv)}"/>`);
      if (vl.substationId) {
        lines.push(`    <cim:VoltageLevel.Substation rdf:resource="#${vl.substationId}"/>`);
      }
      lines.push(
        `    <cim:VoltageLevel.lowVoltageLimit>${vl.lowVoltageLimit?.toFixed(1) ?? "0.0"}</cim:VoltageLevel.lowVoltageLimit>`,
      );
      lines.push(
        `    <cim:VoltageLevel.highVoltageLimit>${vl.highVoltageLimit?.toFixed(1) ?? "0.0"}</cim:VoltageLevel.highVoltageLimit>`,
      );
      lines.push(`  </cim:VoltageLevel>`);
    }

    // Busbars
    for (const bb of model.busbars.values()) {
      lines.push(`  <cim:BusbarSection rdf:ID="${bb.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${bb.name}</cim:IdentifiedObject.name>`);
      if (bb.voltageLevelId) {
        lines.push(`    <cim:BusbarSection.VoltageLevel rdf:resource="#${bb.voltageLevelId}"/>`);
      }
      lines.push(`  </cim:BusbarSection>`);
    }

    // Lines
    for (const ln of model.lines.values()) {
      lines.push(`  <cim:ACLineSegment rdf:ID="${ln.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${ln.name}</cim:IdentifiedObject.name>`);
      lines.push(`    <cim:ACLineSegment.r>${ln.r.toFixed(6)}</cim:ACLineSegment.r>`);
      lines.push(`    <cim:ACLineSegment.x>${ln.x.toFixed(6)}</cim:ACLineSegment.x>`);
      lines.push(`    <cim:ACLineSegment.bch>${ln.bch.toFixed(6)}</cim:ACLineSegment.bch>`);
      lines.push(`    <cim:ACLineSegment.gch>${(ln.gch ?? 0.0).toFixed(6)}</cim:ACLineSegment.gch>`);
      lines.push(`    <cim:ACLineSegment.length>${(ln.lengthKm ?? 1.0).toFixed(2)}</cim:ACLineSegment.length>`);
      lines.push(
        `    <cim:ACLineSegment.ratedCurrent>${(ln.ratedCurrentA ?? 1000.0).toFixed(1)}</cim:ACLineSegment.ratedCurrent>`,
      );
      lines.push(`  </cim:ACLineSegment>`);
    }

    // Transformers
    for (const xf of model.transformers.values()) {
      lines.push(`  <cim:PowerTransformer rdf:ID="${xf.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${xf.name}</cim:IdentifiedObject.name>`);
      if (xf.substationId) {
        lines.push(`    <cim:PowerTransformer.Substation rdf:resource="#${xf.substationId}"/>`);
      }
      lines.push(`  </cim:PowerTransformer>`);
    }

    // TransformerEnds
    for (const end of model.transformerEnds.values()) {
      lines.push(`  <cim:PowerTransformerEnd rdf:ID="${end.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${end.name}</cim:IdentifiedObject.name>`);
      lines.push(`    <cim:PowerTransformerEnd.PowerTransformer rdf:resource="#${end.powerTransformerId}"/>`);
      lines.push(`    <cim:PowerTransformerEnd.Terminal rdf:resource="#${end.terminalId}"/>`);
      lines.push(`    <cim:PowerTransformerEnd.endNumber>${end.endNumber}</cim:PowerTransformerEnd.endNumber>`);
      lines.push(`    <cim:PowerTransformerEnd.r>${end.r.toFixed(6)}</cim:PowerTransformerEnd.r>`);
      lines.push(`    <cim:PowerTransformerEnd.x>${end.x.toFixed(6)}</cim:PowerTransformerEnd.x>`);
      lines.push(`    <cim:PowerTransformerEnd.b>${end.b.toFixed(6)}</cim:PowerTransformerEnd.b>`);
      lines.push(`    <cim:PowerTransformerEnd.g>${end.g.toFixed(6)}</cim:PowerTransformerEnd.g>`);
      lines.push(`    <cim:PowerTransformerEnd.ratedU>${end.ratedUkV.toFixed(1)}</cim:PowerTransformerEnd.ratedU>`);
      lines.push(`    <cim:PowerTransformerEnd.ratedS>${end.ratedSMva.toFixed(1)}</cim:PowerTransformerEnd.ratedS>`);
      lines.push(`  </cim:PowerTransformerEnd>`);
    }

    // SynchronousMachines (EQ specifications)
    for (const gen of model.generators.values()) {
      lines.push(`  <cim:SynchronousMachine rdf:ID="${gen.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${gen.name}</cim:IdentifiedObject.name>`);
      lines.push(`    <cim:SynchronousMachine.minP>${gen.minPMw.toFixed(2)}</cim:SynchronousMachine.minP>`);
      lines.push(`    <cim:SynchronousMachine.maxP>${gen.maxPMw.toFixed(2)}</cim:SynchronousMachine.maxP>`);
      lines.push(`    <cim:SynchronousMachine.minQ>${gen.minQMvar.toFixed(2)}</cim:SynchronousMachine.minQ>`);
      lines.push(`    <cim:SynchronousMachine.maxQ>${gen.maxQMvar.toFixed(2)}</cim:SynchronousMachine.maxQ>`);
      lines.push(
        `    <cim:SynchronousMachine.ratedS>${(gen.ratedSMva ?? 100.0).toFixed(1)}</cim:SynchronousMachine.ratedS>`,
      );
      lines.push(`  </cim:SynchronousMachine>`);
    }

    // EnergyConsumers (EQ specifications)
    for (const ld of model.loads.values()) {
      lines.push(`  <cim:EnergyConsumer rdf:ID="${ld.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${ld.name}</cim:IdentifiedObject.name>`);
      lines.push(`  </cim:EnergyConsumer>`);
    }

    // Shunts
    for (const sh of model.shunts.values()) {
      lines.push(`  <cim:LinearShuntCompensator rdf:ID="${sh.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${sh.name}</cim:IdentifiedObject.name>`);
      lines.push(
        `    <cim:LinearShuntCompensator.bPerSection>${sh.bPerSection.toFixed(8)}</cim:LinearShuntCompensator.bPerSection>`,
      );
      lines.push(
        `    <cim:LinearShuntCompensator.gPerSection>${sh.gPerSection.toFixed(8)}</cim:LinearShuntCompensator.gPerSection>`,
      );
      lines.push(`    <cim:LinearShuntCompensator.sections>${sh.sections}</cim:LinearShuntCompensator.sections>`);
      lines.push(`  </cim:LinearShuntCompensator>`);
    }

    // Terminals
    for (const term of model.terminals.values()) {
      lines.push(`  <cim:Terminal rdf:ID="${term.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${term.name}</cim:IdentifiedObject.name>`);
      lines.push(`    <cim:Terminal.ConductingEquipment rdf:resource="#${term.conductingEquipmentId}"/>`);
      lines.push(`    <cim:Terminal.sequenceNumber>${term.sequenceNumber}</cim:Terminal.sequenceNumber>`);
      lines.push(`  </cim:Terminal>`);
    }
  } else if (profile === "TP") {
    // TopologicalNodes
    for (const node of model.nodes.values()) {
      lines.push(`  <cim:TopologicalNode rdf:ID="${node.mRID}">`);
      lines.push(`    <cim:IdentifiedObject.name>${node.name}</cim:IdentifiedObject.name>`);
      lines.push(`    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv_${Math.round(node.baseVoltageKv)}"/>`);
      if (node.voltageLevelId) {
        lines.push(`    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#${node.voltageLevelId}"/>`);
      }
      lines.push(`  </cim:TopologicalNode>`);
    }

    // Terminals with TopologicalNode references
    for (const term of model.terminals.values()) {
      if (term.topologicalNodeId) {
        lines.push(`  <cim:Terminal rdf:about="#${term.mRID}">`);
        lines.push(`    <cim:Terminal.TopologicalNode rdf:resource="#${term.topologicalNodeId}"/>`);
        lines.push(`  </cim:Terminal>`);
      }
    }
  } else if (profile === "SSH") {
    // SynchronousMachines operating setpoints
    for (const gen of model.generators.values()) {
      lines.push(`  <cim:SynchronousMachine rdf:about="#${gen.mRID}">`);
      lines.push(`    <cim:SynchronousMachine.p>${gen.pMw.toFixed(3)}</cim:SynchronousMachine.p>`);
      lines.push(`    <cim:SynchronousMachine.q>${gen.qMvar.toFixed(3)}</cim:SynchronousMachine.q>`);
      lines.push(`  </cim:SynchronousMachine>`);
    }

    // EnergyConsumer active/reactive demands
    for (const ld of model.loads.values()) {
      lines.push(`  <cim:EnergyConsumer rdf:about="#${ld.mRID}">`);
      lines.push(`    <cim:EnergyConsumer.p>${ld.pMw.toFixed(3)}</cim:EnergyConsumer.p>`);
      lines.push(`    <cim:EnergyConsumer.q>${ld.qMvar.toFixed(3)}</cim:EnergyConsumer.q>`);
      lines.push(`  </cim:EnergyConsumer>`);
    }
  } else if (profile === "SV") {
    // Solved Bus Voltages
    for (const [id, sv] of model.svVoltages.entries()) {
      lines.push(`  <cim:SvVoltage rdf:ID="${id}">`);
      lines.push(`    <cim:SvVoltage.TopologicalNode rdf:resource="#${sv.topologicalNodeId}"/>`);
      lines.push(`    <cim:SvVoltage.v>${sv.vPu.toFixed(5)}</cim:SvVoltage.v>`);
      lines.push(`    <cim:SvVoltage.angle>${sv.angleDeg.toFixed(3)}</cim:SvVoltage.angle>`);
      lines.push(`  </cim:SvVoltage>`);
    }

    // Solved Terminal Power Flows
    for (const [id, sf] of model.svFlows.entries()) {
      lines.push(`  <cim:SvPowerFlow rdf:ID="${id}">`);
      lines.push(`    <cim:SvPowerFlow.Terminal rdf:resource="#${sf.terminalId}"/>`);
      lines.push(`    <cim:SvPowerFlow.p>${sf.pMw.toFixed(3)}</cim:SvPowerFlow.p>`);
      lines.push(`    <cim:SvPowerFlow.q>${sf.qMvar.toFixed(3)}</cim:SvPowerFlow.q>`);
      lines.push(`  </cim:SvPowerFlow>`);
    }
  }

  lines.push(`</rdf:RDF>`);
  return lines.join("\n");
}

/**
 * Exports all 4 CGMES profiles (EQ, TP, SSH, SV) as XML strings.
 */
export function exportCgmesArchive(model: CgmesModel): {
  eqXml: string;
  tpXml: string;
  sshXml: string;
  svXml: string;
} {
  return {
    eqXml: serializeCgmesXml(model, "EQ"),
    tpXml: serializeCgmesXml(model, "TP"),
    sshXml: serializeCgmesXml(model, "SSH"),
    svXml: serializeCgmesXml(model, "SV"),
  };
}
