// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bi-directional Projection: GE PSLF (.epc / .dyd) -> PSS/E (.raw / .dyr).
 */

import type {
  AreaRecord,
  BranchRecord,
  BusRecord,
  FixedShuntRecord,
  GeneratorRecord,
  LoadRecord,
  PsseCase,
  PsseDyrCase,
  PsseDyrRecord,
  TransformerRecord,
} from "@modelscript/psse";
import type { PslfDydCase, PslfEpcCase } from "../types.js";

/**
 * Model name mapping: PSLF lowercase -> PSS/E uppercase canonical model name.
 */
const PSLF_TO_PSSE_MODEL_MAP: Record<string, string> = {
  gencls: "GENCLS",
  gentpf: "GENROU",
  genrou: "GENROU",
  gensal: "GENSAL",
  exst1: "EXST1",
  ieeet1: "IEEET1",
  esdc1a: "ESDC1A",
  ieeego: "IEEEG1",
  ieeeg1: "IEEEG1",
  tgov1: "TGOV1",
  regca1: "REGCAU1",
  reeca1: "REECAU1",
  repca1: "REPCAU1",
  wndt: "WT3G1",
  wt3g1: "WT3G1",
  wt3e1: "WT3E1",
  wt3p1: "WT3P1",
};

/**
 * Converts a PSLF .epc power flow case into a PSS/E RAW case.
 */
export function pslfEpcToPsseRaw(epcCase: PslfEpcCase): PsseCase {
  const buses = new Map<number, BusRecord>();
  for (const b of epcCase.buses.values()) {
    buses.set(b.busNumber, {
      i: b.busNumber,
      name: b.name,
      baseKv: b.baseKv,
      ide: b.busType,
      area: b.area,
      zone: b.zone,
      owner: 1,
      vm: b.vmPu,
      va: b.vaDeg,
      nvhi: b.vmax,
      nvlo: b.vmin,
      evhi: b.vmax * 1.05,
      evlo: b.vmin * 0.95,
    });
  }

  const generators: GeneratorRecord[] = epcCase.generators.map((g) => ({
    i: g.busNumber,
    id: g.genId,
    pg: g.pgMw,
    qg: g.qgMvar,
    qt: g.qmaxMvar,
    qb: g.qminMvar,
    vs: g.vschedPu,
    ireg: 0,
    mbase: g.mbaseMva,
    zr: g.rSource,
    zx: g.xSource,
    rt: 0.0,
    xt: 0.0,
    gtap: 1.0,
    stat: g.status,
    rmpct: 100.0,
    pt: g.pmaxMw,
    pb: g.pminMw,
  }));

  const loads: LoadRecord[] = epcCase.loads.map((l) => ({
    i: l.busNumber,
    id: l.loadId,
    status: l.status,
    stat: l.status,
    area: l.area,
    zone: l.zone,
    pl: l.plMw,
    ql: l.qlMvar,
    ip: l.ipMw,
    iq: l.iqMvar,
    yp: l.ypMw,
    yq: l.yqMvar,
    owner: 1,
    scale: 1,
    intrpt: 0,
    intrct: 0,
  }));

  const fixedShunts: FixedShuntRecord[] = epcCase.shunts.map((s) => ({
    i: s.busNumber,
    id: s.shuntId,
    status: s.status,
    gl: s.gMw,
    bl: s.bMvar,
  }));

  const branches: BranchRecord[] = epcCase.branches.map((br) => ({
    i: br.fromBus,
    j: br.toBus,
    ckt: br.circuitId,
    r: br.rPu,
    x: br.xPu,
    b: br.bPu,
    rateA: br.rate1Mva,
    rateB: br.rate2Mva,
    rateC: br.rate3Mva,
    ratea: br.rate1Mva,
    rateb: br.rate2Mva,
    ratec: br.rate3Mva,
    gi: 0.0,
    bi: 0.0,
    gj: 0.0,
    bj: 0.0,
    st: br.status,
    met: 1,
    len: 1.0,
    o1: 1,
    f1: 1.0,
  }));

  const transformers: TransformerRecord[] = epcCase.transformers.map((tr) => {
    const fromBusKv = epcCase.buses.get(tr.fromBus)?.baseKv ?? 115.0;
    const toBusKv = epcCase.buses.get(tr.toBus)?.baseKv ?? 13.8;
    return {
      i: tr.fromBus,
      j: tr.toBus,
      k: 0,
      ckt: tr.circuitId,
      cw: 1,
      cm: 1,
      mag1: 0.0,
      mag2: 0.0,
      nmetr: 2,
      name: `XFMR_${tr.fromBus}_${tr.toBus}`,
      stat: tr.status,
      r12: tr.rPu,
      x12: tr.xPu,
      sbase12: epcCase.mbaseMva,
      windv1: tr.ratio,
      nomv1: fromBusKv,
      ang1: tr.phaseDeg,
      rata1: tr.rate1Mva,
      ratb1: tr.rate2Mva,
      ratc1: tr.rate3Mva,
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
      nomv2: toBusKv,
    };
  });

  const areas: AreaRecord[] = epcCase.areas.map((a) => ({
    i: a.areaNumber,
    isw: a.slackBus,
    pdes: a.desiredNetInterchangeMw,
    ptol: a.toleranceMw,
    arname: a.name,
  }));

  return {
    header: {
      ic: 0,
      sbase: epcCase.mbaseMva,
      rev: 33,
      xfrrat: 0,
      nxfrat: 0,
      basfrq: epcCase.baseFreqHz,
    },
    title1: epcCase.title1,
    title2: epcCase.title2,
    buses,
    loads,
    fixedShunts,
    generators,
    branches,
    transformers,
    areas,
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: [],
  };
}

/**
 * Converts a PSLF .dyd dynamic models case into a PSS/E .dyr case.
 */
export function pslfDydToPsseDyr(dydCase: PslfDydCase): PsseDyrCase {
  const records: PsseDyrRecord[] = [];
  const generatorsByBusId = new Map<string, PsseDyrRecord>();
  const excitersByBusId = new Map<string, PsseDyrRecord>();
  const governorsByBusId = new Map<string, PsseDyrRecord>();
  const stabilizersByBusId = new Map<string, PsseDyrRecord>();

  for (const m of dydCase.models) {
    const psseModelName = PSLF_TO_PSSE_MODEL_MAP[m.modelType] ?? m.modelType.toUpperCase();
    const namedParams: Record<string, number> = {};
    for (let idx = 0; idx < m.params.length; idx++) {
      namedParams[`P${idx + 1}`] = m.params[idx]!;
    }

    let category: "generator" | "exciter" | "governor" | "stabilizer" | "load" | "facts" | "hvdc" | "user" = "user";
    const modelLower = psseModelName.toLowerCase();
    if (modelLower.startsWith("gen") || modelLower.startsWith("reg") || modelLower.startsWith("wt3g")) {
      category = "generator";
    } else if (modelLower.startsWith("ex") || modelLower.startsWith("es") || modelLower.startsWith("ree")) {
      category = "exciter";
    } else if (modelLower.startsWith("gov") || modelLower.startsWith("ieeeg") || modelLower.startsWith("rep")) {
      category = "governor";
    } else if (modelLower.startsWith("pss")) {
      category = "stabilizer";
    }

    const rec: PsseDyrRecord = {
      ibus: m.busNumber,
      model: psseModelName,
      id: m.id,
      category,
      con: [...m.params],
      namedParams,
    };

    records.push(rec);

    const busId = `${m.busNumber}_${m.id.trim()}`;
    if (category === "generator") {
      generatorsByBusId.set(busId, rec);
      generatorsByBusId.set(String(m.busNumber), rec);
    } else if (category === "exciter") {
      excitersByBusId.set(busId, rec);
      excitersByBusId.set(String(m.busNumber), rec);
    } else if (category === "governor") {
      governorsByBusId.set(busId, rec);
      governorsByBusId.set(String(m.busNumber), rec);
    } else if (category === "stabilizer") {
      stabilizersByBusId.set(busId, rec);
      stabilizersByBusId.set(String(m.busNumber), rec);
    }
  }

  return {
    records,
    generatorsByBusId,
    excitersByBusId,
    governorsByBusId,
    stabilizersByBusId,
  };
}
