// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bi-directional Projection: PSS/E (.raw / .dyr) -> GE PSLF (.epc / .dyd).
 */

import type { PsseCase, PsseDyrCase } from "@modelscript/psse";
import type {
  PslfArea,
  PslfBranch,
  PslfBus,
  PslfDydCase,
  PslfDynamicModel,
  PslfEpcCase,
  PslfGenerator,
  PslfLoad,
  PslfShunt,
  PslfTransformer,
} from "../types.js";

/**
 * Model name mapping: PSS/E uppercase -> PSLF lowercase canonical model name.
 */
const PSSE_TO_PSLF_MODEL_MAP: Record<string, string> = {
  GENCLS: "gencls",
  GENROU: "gentpf",
  GENSAL: "gensal",
  EXST1: "exst1",
  IEEET1: "ieeet1",
  ESDC1A: "esdc1a",
  IEEEG1: "ieeego",
  IEESGO: "ieeego",
  TGOV1: "tgov1",
  REGCAU1: "regca1",
  REECAU1: "reeca1",
  REPCAU1: "repca1",
  WT3G1: "wndt",
  WT3E1: "wt3e1",
  WT3P1: "wt3p1",
};

/**
 * Converts a PSS/E RAW case into a PSLF .epc power flow case.
 */
export function psseRawToPslfEpc(rawCase: PsseCase): PslfEpcCase {
  const buses = new Map<number, PslfBus>();
  for (const b of rawCase.buses.values()) {
    buses.set(b.i, {
      busNumber: b.i,
      name: b.name.trim() || `BUS_${b.i}`,
      baseKv: b.baseKv,
      busType: b.ide,
      area: b.area,
      zone: b.zone,
      vmPu: b.vm,
      vaDeg: b.va,
      vmax: b.nvhi ?? 1.1,
      vmin: b.nvlo ?? 0.9,
    });
  }

  const generators: PslfGenerator[] = rawCase.generators.map((g) => ({
    busNumber: g.i,
    genId: g.id.trim() || "1",
    status: g.stat,
    pgMw: g.pg,
    qgMvar: g.qg,
    qmaxMvar: g.qt,
    qminMvar: g.qb,
    pmaxMw: g.pt ?? (g.pg > 0 ? g.pg * 1.1 : 999.0),
    pminMw: g.pb ?? 0.0,
    vschedPu: g.vs,
    mbaseMva: g.mbase,
    rSource: g.zr,
    xSource: g.zx,
  }));

  const loads: PslfLoad[] = rawCase.loads.map((l) => ({
    busNumber: l.i,
    loadId: l.id.trim() || "1",
    status: l.status,
    plMw: l.pl,
    qlMvar: l.ql,
    ipMw: l.ip,
    iqMvar: l.iq,
    ypMw: l.yp,
    yqMvar: l.yq,
    area: l.area,
    zone: l.zone,
  }));

  const shunts: PslfShunt[] = rawCase.fixedShunts.map((s) => ({
    busNumber: s.i,
    shuntId: s.id.trim() || "1",
    status: s.status,
    gMw: s.gl,
    bMvar: s.bl,
  }));

  const branches: PslfBranch[] = rawCase.branches.map((br) => ({
    fromBus: br.i,
    toBus: br.j,
    circuitId: br.ckt.trim() || "1",
    status: br.st,
    rPu: br.r,
    xPu: br.x,
    bPu: br.b,
    rate1Mva: br.rateA,
    rate2Mva: br.rateB,
    rate3Mva: br.rateC,
  }));

  const transformers: PslfTransformer[] = rawCase.transformers.map((tr) => ({
    fromBus: tr.i,
    toBus: tr.j,
    circuitId: tr.ckt.trim() || "1",
    status: tr.stat,
    rPu: tr.r12,
    xPu: tr.x12,
    ratio: tr.windv1,
    phaseDeg: tr.ang1,
    rate1Mva: tr.rata1,
    rate2Mva: tr.ratb1,
    rate3Mva: tr.ratc1,
  }));

  const areas: PslfArea[] = rawCase.areas.map((a) => ({
    areaNumber: a.i,
    slackBus: a.isw,
    desiredNetInterchangeMw: a.pdes,
    toleranceMw: a.ptol,
    name: a.arname.trim() || `Area_${a.i}`,
  }));

  return {
    title1: rawCase.title1 || "Converted from PSS/E RAW",
    title2: rawCase.title2 || "",
    mbaseMva: rawCase.header.sbase,
    baseFreqHz: rawCase.header.basfrq,
    buses,
    generators,
    loads,
    shunts,
    branches,
    transformers,
    areas,
    zones: [],
  };
}

/**
 * Converts a PSS/E .dyr dynamic case into a PSLF .dyd case.
 */
export function psseDyrToPslfDyd(dyrCase: PsseDyrCase): PslfDydCase {
  const models: PslfDynamicModel[] = [];

  for (const rec of dyrCase.records) {
    const pslfModelType = PSSE_TO_PSLF_MODEL_MAP[rec.model.toUpperCase()] ?? rec.model.toLowerCase();
    models.push({
      modelType: pslfModelType,
      busNumber: rec.ibus,
      id: rec.id.trim() || "1",
      baseKv: 0.0,
      params: [...rec.con],
      comment: `Converted from PSS/E ${rec.model} model`,
    });
  }

  return { models };
}
