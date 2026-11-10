// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from DIgSILENT PowerFactory Model to IEEE / PSS/E v33 RAW Case.
 *
 * Maps resolved topological bus-branch networks, transmission lines, 2-winding transformers,
 * synchronous machines, static generators, loads, and shunts into a strongly-typed PsseCase.
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
import { processPowerFactoryTopology } from "../topology/topology-processor.js";
import type { PowerFactoryModel } from "../types.js";

export interface PowerFactoryToPsseOptions {
  sbaseMva?: number | undefined;
  title?: string | undefined;
}

/**
 * Converts a PowerFactoryModel into a standard PSS/E v33 PsseCase.
 */
export function powerFactoryToPsse(
  model: PowerFactoryModel,
  options: PowerFactoryToPsseOptions = {},
): { psseCase: PsseCase; termToBusMap: Map<string, number> } {
  const sbase = options.sbaseMva ?? 100.0;
  const topo = processPowerFactoryTopology(model, sbase);
  const { buses: topoBuses, termToBus, mappedLines, mappedTransformers, fnomHz } = topo;

  // 1. Build PSS/E Buses
  const buses = new Map<number, BusRecord>();
  const generatorBusSet = new Set<number>();
  for (const [, gen] of model.generators) {
    if (gen.outserv) continue;
    const bNum = termToBus.get(gen.bus1Id);
    if (bNum !== undefined) generatorBusSet.add(bNum);
  }

  // Pick first generator bus as Swing, others as PV or Load
  let slackBusNum = generatorBusSet.size > 0 ? Array.from(generatorBusSet)[0]! : 1;

  for (const [bNum, tBus] of topoBuses) {
    let ide = BusType.PQ; // Default: PQ Load bus
    if (bNum === slackBusNum) {
      ide = BusType.Swing; // Slack Swing bus
    } else if (generatorBusSet.has(bNum)) {
      ide = BusType.PV; // PV Generator bus
    }

    let vSetpoint = 1.0;
    for (const [, g] of model.generators) {
      if (!g.outserv && termToBus.get(g.bus1Id) === bNum && g.usetp > 0) {
        vSetpoint = g.usetp;
        break;
      }
    }

    buses.set(bNum, {
      i: bNum,
      name: tBus.name.slice(0, 12).padEnd(12, " "),
      baseKv: tBus.baseKv,
      ide,
      area: 1,
      zone: 1,
      owner: 1,
      vm: vSetpoint,
      va: 0.0,
      nvhi: 1.1,
      nvlo: 0.9,
      evhi: 1.15,
      evlo: 0.85,
    });
  }

  // 2. Build PSS/E AC Branches (Transmission Lines)
  const branches: BranchRecord[] = [];
  const cktCounters = new Map<string, number>();

  for (const mapped of mappedLines) {
    const { fromBus, toBus, r1Ohm, x1Ohm, b1USiemens, rateMva } = mapped;
    const vBaseKv = topoBuses.get(fromBus)?.baseKv ?? 110.0;
    const zBaseOhm = (vBaseKv * vBaseKv) / sbase;
    const yBaseSiemens = 1.0 / zBaseOhm;

    const rPu = r1Ohm / zBaseOhm;
    const xPu = Math.max(1e-5, x1Ohm / zBaseOhm);
    // b1 is in microSiemens: total B_pu = (b1 * 1e-6) / yBase
    const bPu = (b1USiemens * 1e-6) / yBaseSiemens;

    const pairKey = `${Math.min(fromBus, toBus)}_${Math.max(fromBus, toBus)}`;
    const cktNum = (cktCounters.get(pairKey) ?? 0) + 1;
    cktCounters.set(pairKey, cktNum);
    const ckt = String(cktNum);

    branches.push({
      i: fromBus,
      j: toBus,
      ckt,
      r: rPu,
      x: xPu,
      b: bPu,
      rateA: rateMva ?? 100.0,
      rateB: rateMva ? rateMva * 1.1 : 110.0,
      rateC: rateMva ? rateMva * 1.25 : 125.0,
      gi: 0.0,
      bi: 0.0,
      gj: 0.0,
      bj: 0.0,
      st: 1,
      met: 1,
      len: mapped.line.dline > 0 ? mapped.line.dline : 1.0,
      o1: 1,
      f1: 1.0,
    });
  }

  // 3. Build PSS/E 2-Winding Transformers
  const transformers: TransformerRecord[] = [];
  const trafoCktCounters = new Map<string, number>();

  for (const mTr of mappedTransformers) {
    const { hvBus, lvBus, rPu, xPu, ratioPu, angleDeg, ratedMva } = mTr;
    const pairKey = `${Math.min(hvBus, lvBus)}_${Math.max(hvBus, lvBus)}`;
    const cktNum = (trafoCktCounters.get(pairKey) ?? 0) + 1;
    trafoCktCounters.set(pairKey, cktNum);
    const ckt = `T${cktNum}`;

    transformers.push({
      i: hvBus,
      j: lvBus,
      k: 0,
      ckt,
      cw: 1,
      cm: 1,
      mag1: 0.0,
      mag2: 0.0,
      nmetr: 2,
      name: mTr.trafo.loc_name.slice(0, 12),
      stat: 1,
      o1: 1,
      f1: 1.0,
      r12: rPu,
      x12: xPu,
      sbase12: ratedMva,
      windv1: ratioPu,
      nomv1: topoBuses.get(hvBus)?.baseKv ?? 110.0,
      ang1: angleDeg,
      rata1: ratedMva,
      ratb1: ratedMva * 1.1,
      ratc1: ratedMva * 1.25,
      cod1: 0,
      cont1: 0,
      rma1: 1.1,
      rmi1: 0.9,
      vma1: 1.1,
      vmi1: 0.9,
      ntp1: 33,
      tab1: 0,
      cr1: 0.0,
      cx1: 0.0,
      cnxa1: 0.0,
      windv2: 1.0,
      nomv2: topoBuses.get(lvBus)?.baseKv ?? 20.0,
    });
  }

  // 4. Build PSS/E Generators
  const generators: GeneratorRecord[] = [];
  const genIdCounters = new Map<number, number>();

  for (const [, gen] of model.generators) {
    if (gen.outserv) continue;
    const bNum = termToBus.get(gen.bus1Id);
    if (bNum === undefined) continue;

    const idCount = (genIdCounters.get(bNum) ?? 0) + 1;
    genIdCounters.set(bNum, idCount);
    const genId = String(idCount);

    const type = gen.typId ? model.symTypes.get(gen.typId) : undefined;
    const mbase = gen.sgini ?? type?.snom ?? 100.0;

    generators.push({
      i: bNum,
      id: genId,
      pg: gen.pgini,
      qg: gen.qgini,
      qt: gen.qmax ?? mbase * 0.5,
      qb: gen.qmin ?? -mbase * 0.3,
      vs: gen.usetp,
      ireg: 0,
      mbase,
      zr: 0.0,
      zx: type?.xdp ?? 0.2,
      rt: 0.0,
      xt: 0.0,
      gtap: 1.0,
      stat: 1,
      rmpct: 100.0,
      pt: mbase,
      pb: 0.0,
      o1: 1,
      f1: 1.0,
    });
  }

  // Also include Static Generators (PV/Wind/BESS) as PSS/E generators
  for (const [, sgen] of model.staticGenerators) {
    if (sgen.outserv) continue;
    const bNum = termToBus.get(sgen.bus1Id);
    if (bNum === undefined) continue;

    const idCount = (genIdCounters.get(bNum) ?? 0) + 1;
    genIdCounters.set(bNum, idCount);
    const genId = `S${idCount}`;
    const mbase = sgen.sgn ?? Math.max(10.0, Math.abs(sgen.pgini) * 1.2);

    generators.push({
      i: bNum,
      id: genId,
      pg: sgen.pgini,
      qg: sgen.qgini,
      qt: mbase * 0.44,
      qb: -mbase * 0.44,
      vs: sgen.usetp ?? 1.0,
      ireg: 0,
      mbase,
      zr: 0.0,
      zx: 0.15,
      rt: 0.0,
      xt: 0.0,
      gtap: 1.0,
      stat: 1,
      rmpct: 100.0,
      pt: mbase,
      pb: 0.0,
      o1: 1,
      f1: 1.0,
    });
  }

  // 5. Build PSS/E Loads
  const loads: LoadRecord[] = [];
  const loadIdCounters = new Map<number, number>();

  for (const [, lod] of model.loads) {
    if (lod.outserv) continue;
    const bNum = termToBus.get(lod.bus1Id);
    if (bNum === undefined) continue;

    const idCount = (loadIdCounters.get(bNum) ?? 0) + 1;
    loadIdCounters.set(bNum, idCount);
    const loadId = String(idCount);

    loads.push({
      i: bNum,
      id: loadId,
      status: 1,
      area: 1,
      zone: 1,
      pl: lod.plini,
      ql: lod.qlini,
      ip: 0.0,
      iq: 0.0,
      yp: 0.0,
      yq: 0.0,
      owner: 1,
      scale: 1,
      intrct: 0,
    });
  }

  // 6. Build PSS/E Fixed Shunts
  const fixedShunts: FixedShuntRecord[] = [];
  const shuntIdCounters = new Map<number, number>();

  for (const [, shnt] of model.shunts) {
    if (shnt.outserv) continue;
    const bNum = termToBus.get(shnt.bus1Id);
    if (bNum === undefined) continue;

    const idCount = (shuntIdCounters.get(bNum) ?? 0) + 1;
    shuntIdCounters.set(bNum, idCount);
    const shuntId = `SH${idCount}`;

    // qtot in Mvar: positive is capacitor (+B), negative is reactor (-B)
    const nSteps = shnt.ncap ?? 1;
    const qMvar = shnt.qtot * nSteps;

    fixedShunts.push({
      i: bNum,
      id: shuntId,
      status: 1,
      gl: 0.0,
      bl: qMvar, // Mvar at 1.0 pu
    });
  }

  const psseCase: PsseCase = {
    header: {
      ic: 0,
      sbase,
      rev: 33,
      xfrrat: 0,
      nxfrat: 0,
      basfrq: fnomHz,
    },
    title1: options.title || `DIgSILENT PowerFactory: ${model.name}`,
    title2: `Projected by ModelScript @modelscript/powerfactory`,
    buses,
    loads,
    fixedShunts,
    generators,
    branches,
    transformers,
    areas: [],
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: [],
  };

  return { psseCase, termToBusMap: termToBus };
}
