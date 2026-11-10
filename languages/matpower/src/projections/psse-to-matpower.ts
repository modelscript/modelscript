// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bi-directional Projection: PSS/E (.raw) -> MATPOWER (.m) Case.
 */

import type { PsseCase } from "@modelscript/psse";
import type { MatpowerBranch, MatpowerBus, MatpowerCase, MatpowerGen } from "../types.js";

/**
 * Converts a PSS/E Raw Case into a MatpowerCase.
 */
export function psseRawToMatpower(psseCase: PsseCase): MatpowerCase {
  const loadByBus = new Map<number, { pl: number; ql: number }>();
  for (const l of psseCase.loads) {
    if (l.status !== 0) {
      const existing = loadByBus.get(l.i) ?? { pl: 0, ql: 0 };
      existing.pl += l.pl;
      existing.ql += l.ql;
      loadByBus.set(l.i, existing);
    }
  }

  const shuntByBus = new Map<number, { gl: number; bl: number }>();
  for (const s of psseCase.fixedShunts) {
    if (s.status !== 0) {
      const existing = shuntByBus.get(s.i) ?? { gl: 0, bl: 0 };
      existing.gl += s.gl;
      existing.bl += s.bl;
      shuntByBus.set(s.i, existing);
    }
  }

  const buses: MatpowerBus[] = [];
  const busNames = new Map<number, string>();

  for (const b of psseCase.buses.values()) {
    const load = loadByBus.get(b.i) ?? { pl: 0, ql: 0 };
    const shunt = shuntByBus.get(b.i) ?? { gl: 0, bl: 0 };

    buses.push({
      bus_i: b.i,
      type: b.ide,
      pd: load.pl,
      qd: load.ql,
      gs: shunt.gl,
      bs: shunt.bl,
      area: b.area,
      vm: b.vm,
      va: b.va,
      baseKv: b.baseKv,
      zone: b.zone,
      vmax: b.nvhi ?? 1.1,
      vmin: b.nvlo ?? 0.9,
      name: b.name,
    });
    busNames.set(b.i, b.name);
  }

  const generators: MatpowerGen[] = [];
  for (const g of psseCase.generators) {
    generators.push({
      bus: g.i,
      pg: g.pg,
      qg: g.qg,
      qmax: g.qt,
      qmin: g.qb,
      vg: g.vs,
      mbase: g.mbase,
      status: g.stat,
      pmax: g.pt,
      pmin: g.pb,
    });
  }

  const branches: MatpowerBranch[] = [];

  for (const br of psseCase.branches) {
    branches.push({
      fbus: br.i,
      tbus: br.j,
      r: br.r,
      x: br.x,
      b: br.b,
      rateA: br.rateA,
      rateB: br.rateB,
      rateC: br.rateC,
      ratio: 0.0,
      angle: 0.0,
      status: br.st,
      angmin: -360.0,
      angmax: 360.0,
    });
  }

  for (const t of psseCase.transformers) {
    branches.push({
      fbus: t.i,
      tbus: t.j,
      r: t.r12,
      x: t.x12,
      b: 0.0,
      rateA: t.rata1,
      rateB: t.ratb1,
      rateC: t.ratc1,
      ratio: t.windv1,
      angle: t.ang1,
      status: t.stat,
      angmin: -360.0,
      angmax: 360.0,
    });
  }

  return {
    caseName: psseCase.title1.replace(/[^A-Za-z0-9_]/g, "_") || "case_imported",
    version: "2",
    baseMVA: psseCase.header.sbase,
    bus: buses,
    gen: generators,
    branch: branches,
    busNames,
  };
}
