// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bi-directional Projection: MATPOWER (.m) -> PSS/E (.raw) Case.
 */

import type {
  AreaRecord,
  BranchRecord,
  BusRecord,
  FixedShuntRecord,
  GeneratorRecord,
  LoadRecord,
  PsseCase,
  TransformerRecord,
} from "@modelscript/psse";
import type { MatpowerCase } from "../types.js";

/**
 * Converts a MatpowerCase into a PSS/E Raw Case.
 */
export function matpowerToPsseRaw(mpc: MatpowerCase): PsseCase {
  const buses = new Map<number, BusRecord>();
  const loads: LoadRecord[] = [];
  const fixedShunts: FixedShuntRecord[] = [];

  for (const b of mpc.bus) {
    buses.set(b.bus_i, {
      i: b.bus_i,
      name: b.name ?? `BUS_${b.bus_i}`,
      baseKv: b.baseKv > 0 ? b.baseKv : 100.0,
      ide: b.type,
      area: b.area || 1,
      zone: b.zone || 1,
      owner: 1,
      vm: b.vm,
      va: b.va,
      nvhi: b.vmax || 1.1,
      nvlo: b.vmin || 0.9,
      evhi: (b.vmax || 1.1) * 1.05,
      evlo: (b.vmin || 0.9) * 0.95,
    });

    if (b.pd !== 0 || b.qd !== 0) {
      loads.push({
        i: b.bus_i,
        id: "1",
        status: 1,
        area: b.area || 1,
        zone: b.zone || 1,
        pl: b.pd,
        ql: b.qd,
        ip: 0.0,
        iq: 0.0,
        yp: 0.0,
        yq: 0.0,
        owner: 1,
        scale: 1,
        intrct: 1,
      });
    }

    if (b.gs !== 0 || b.bs !== 0) {
      fixedShunts.push({
        i: b.bus_i,
        id: "1",
        status: 1,
        gl: b.gs,
        bl: b.bs,
      });
    }
  }

  const genCountByBus = new Map<number, number>();
  const generators: GeneratorRecord[] = [];

  for (const g of mpc.gen) {
    const count = (genCountByBus.get(g.bus) ?? 0) + 1;
    genCountByBus.set(g.bus, count);

    generators.push({
      i: g.bus,
      id: String(count),
      pg: g.pg,
      qg: g.qg,
      qt: g.qmax,
      qb: g.qmin,
      vs: g.vg,
      ireg: 0,
      mbase: g.mbase || mpc.baseMVA,
      zr: 0.0,
      zx: 0.1,
      rt: 0.0,
      xt: 0.0,
      gtap: 1.0,
      stat: g.status,
      rmpct: 100.0,
      pt: g.pmax,
      pb: g.pmin,
    });
  }

  const branches: BranchRecord[] = [];
  const transformers: TransformerRecord[] = [];
  const branchCountByKey = new Map<string, number>();

  for (const br of mpc.branch) {
    const key = `${br.fbus}_${br.tbus}`;
    const cktNum = (branchCountByKey.get(key) ?? 0) + 1;
    branchCountByKey.set(key, cktNum);
    const ckt = String(cktNum);

    const isTransformer = (br.ratio > 0.0 && Math.abs(br.ratio - 1.0) > 1e-4) || Math.abs(br.angle) > 1e-4;

    if (isTransformer) {
      transformers.push({
        i: br.fbus,
        j: br.tbus,
        k: 0,
        ckt,
        cw: 1,
        cm: 1,
        mag1: 0.0,
        mag2: 0.0,
        nmetr: 1,
        name: `T_${br.fbus}_${br.tbus}`,
        stat: br.status,
        r12: br.r,
        x12: br.x,
        sbase12: mpc.baseMVA,
        windv1: br.ratio > 0.0 ? br.ratio : 1.0,
        nomv1: 0.0,
        ang1: br.angle,
        rata1: br.rateA,
        ratb1: br.rateB,
        ratc1: br.rateC,
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
        nomv2: 0.0,
      });
    } else {
      branches.push({
        i: br.fbus,
        j: br.tbus,
        ckt,
        r: br.r,
        x: br.x,
        b: br.b,
        rateA: br.rateA,
        rateB: br.rateB,
        rateC: br.rateC,
        gi: 0.0,
        bi: 0.0,
        gj: 0.0,
        bj: 0.0,
        st: br.status,
        met: 1,
        len: 1.0,
      });
    }
  }

  const areas: AreaRecord[] = [{ i: 1, isw: 0, pdes: 0.0, ptol: 10.0, arname: "AREA_1" }];

  return {
    header: {
      ic: 0,
      sbase: mpc.baseMVA,
      rev: 33,
      xfrrat: 0,
      nxfrat: 0,
      basfrq: 60.0,
    },
    title1: mpc.caseName ?? "MATPOWER Export",
    title2: `Generated from MATPOWER version ${mpc.version}`,
    buses,
    generators,
    loads,
    fixedShunts,
    branches,
    transformers,
    areas,
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: [],
  };
}
