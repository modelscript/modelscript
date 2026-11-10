// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — MATPOWER (.m) & VeraGrid JSON Grid Converters.
 *
 * Implements bidirectional zero-overhead parsing and export for:
 *   - MATPOWER .m power flow / OPF cases (IEEE 14, 30, 57, 118, 300 benchmarks)
 *   - VeraGrid (GridCal) native JSON schema
 */

import type { GeneratorCostCurve, GenericPowerCase } from "./types.js";

/**
 * Parses a MATPOWER (.m) case file into a canonical GenericPowerCase.
 */
export function parseMatpower(matpowerSource: string): GenericPowerCase {
  let sbase = 100.0;

  // 1. Extract baseMVA
  const baseMvaMatch = matpowerSource.match(/mpc\.baseMVA\s*=\s*([0-9.]+)\s*;/i);
  if (baseMvaMatch && baseMvaMatch[1]) {
    sbase = Number.parseFloat(baseMvaMatch[1]);
  }

  // Helper to extract matrix rows between `mpc.<name> = [` and `];`
  function extractMatrix(matrixName: string): number[][] {
    const regex = new RegExp(`mpc\\.${matrixName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;`, "i");
    const match = matpowerSource.match(regex);
    if (!match || !match[1]) return [];

    const lines = match[1].split("\n");
    const rows: number[][] = [];

    for (const rawLine of lines) {
      // Remove comments (%)
      const commentIdx = rawLine.indexOf("%");
      const cleanLine = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
      if (!cleanLine || cleanLine.startsWith(";")) continue;

      // Extract numbers (space or tab separated)
      const tokens = cleanLine
        .replace(/;/g, "")
        .trim()
        .split(/\s+/)
        .map((t) => Number.parseFloat(t))
        .filter((n) => Number.isFinite(n));

      if (tokens.length > 0) {
        rows.push(tokens);
      }
    }
    return rows;
  }

  const busRows = extractMatrix("bus");
  const genRows = extractMatrix("gen");
  const branchRows = extractMatrix("branch");

  const buses = new Map<number, { i: number; name: string; baseKv: number; ide: number; vm: number; va: number }>();
  const loads: Array<{ i: number; pl: number; ql: number; status?: number }> = [];

  for (const row of busRows) {
    if (row.length < 2) continue;
    const i = Math.round(row[0]!);
    const ide = Math.round(row[1]!); // 1=PQ, 2=PV, 3=ref/slack, 4=isolated
    const pd = row[2] ?? 0.0;
    const qd = row[3] ?? 0.0;
    const vm = row[7] ?? 1.0;
    const va = row[8] ?? 0.0;
    const baseKv = row[9] && row[9] > 0 ? row[9] : 230.0;

    buses.set(i, {
      i,
      name: `BUS_${i}`,
      baseKv,
      ide,
      vm,
      va,
    });

    if (Math.abs(pd) > 1e-4 || Math.abs(qd) > 1e-4) {
      loads.push({
        i,
        pl: pd,
        ql: qd,
        status: 1,
      });
    }
  }

  const generators: Array<{
    i: number;
    id: string;
    pg: number;
    qg: number;
    pb?: number;
    pt?: number;
    qb?: number;
    qt?: number;
    stat?: number;
  }> = [];

  const genCountAtBus = new Map<number, number>();
  for (const row of genRows) {
    if (row.length < 2) continue;
    const busNum = Math.round(row[0]!);
    const count = (genCountAtBus.get(busNum) ?? 0) + 1;
    genCountAtBus.set(busNum, count);

    const pg = row[1] ?? 0.0;
    const qg = row[2] ?? 0.0;
    const qmax = row[3] ?? 999.0;
    const qmin = row[4] ?? -999.0;
    const status = Math.round(row[7] ?? 1);
    const pmax = row[8] ?? 999.0;
    const pmin = row[9] ?? 0.0;

    generators.push({
      i: busNum,
      id: String(count),
      pg,
      qg,
      qt: qmax,
      qb: qmin,
      pt: pmax,
      pb: pmin,
      stat: status,
    });
  }

  const branches: GenericPowerCase["branches"] = [];
  const transformers: NonNullable<GenericPowerCase["transformers"]> = [];

  for (const row of branchRows) {
    if (row.length < 4) continue;
    const fBus = Math.round(row[0]!);
    const tBus = Math.round(row[1]!);
    const r = row[2]!;
    const x = row[3]!;
    const b = row[4] ?? 0.0;
    const rateA = row[5] ?? 9999.0;
    const rateB = row[6] !== undefined && row[6] > 0 ? row[6] : undefined;
    const rateC = row[7] !== undefined && row[7] > 0 ? row[7] : undefined;
    const ratio = row[8] ?? 0.0;
    const angle = row[9] ?? 0.0;
    const status = Math.round(row[10] ?? 1);
    const angmin = row[11] !== undefined ? row[11] : undefined;
    const angmax = row[12] !== undefined ? row[12] : undefined;

    if (ratio > 0.0 && Math.abs(ratio - 1.0) > 1e-4) {
      // Off-nominal transformer
      transformers.push({
        i: fBus,
        j: tBus,
        ckt: "T1",
        r12: r,
        x12: x,
        rata1: rateA > 0 ? rateA : 9999.0,
        rateB,
        rateC,
        ratio,
        angle: Math.abs(angle) > 1e-4 ? angle : undefined,
        stat: status,
      });
    } else {
      // Transmission line
      branches.push({
        i: fBus,
        j: tBus,
        ckt: "1",
        r,
        x,
        b,
        rateA: rateA > 0 ? rateA : 9999.0,
        rateB,
        rateC,
        ratio: ratio > 0 ? ratio : undefined,
        angle: Math.abs(angle) > 1e-4 ? angle : undefined,
        angmin,
        angmax,
        st: status,
      });
    }
  }

  // 4. Extract dcline matrix if present
  const dclineRows = extractMatrix("dcline");
  const dclines: GenericPowerCase["dclines"] = [];
  for (const row of dclineRows) {
    if (row.length < 11) continue;
    dclines.push({
      fBus: Math.round(row[0]!),
      tBus: Math.round(row[1]!),
      status: Math.round(row[2] ?? 1),
      pf: row[3] ?? 0,
      pt: row[4] ?? 0,
      qf: row[5] ?? 0,
      qt: row[6] ?? 0,
      vf: row[7] ?? 1.0,
      vt: row[8] ?? 1.0,
      pmin: row[9] ?? 0,
      pmax: row[10] ?? 9999,
      qminF: row[11] ?? -999,
      qmaxF: row[12] ?? 999,
      qminT: row[13] ?? -999,
      qmaxT: row[14] ?? 999,
      loss0: row[15] ?? 0,
      loss1: row[16] ?? 0,
    });
  }

  // 5. Extract gencost matrix if present
  const gencostRows = extractMatrix("gencost");
  const generatorCosts = new Map<string, GeneratorCostCurve>();

  for (let k = 0; k < generators.length && k < gencostRows.length; k++) {
    const g = generators[k]!;
    const row = gencostRows[k]!;
    if (row.length < 4) continue;

    const model = Math.round(row[0]!); // 1 = piecewise linear, 2 = polynomial
    const n = Math.round(row[3]!); // number of coefficients / points
    let c2 = 0.0;
    let c1 = 20.0;
    let c0 = 0.0;
    let pwlPoints: Array<{ p: number; f: number }> | undefined;

    if (model === 2) {
      if (n === 3 && row.length >= 7) {
        c2 = row[4] ?? 0.0;
        c1 = row[5] ?? 20.0;
        c0 = row[6] ?? 0.0;
      } else if (n === 2 && row.length >= 6) {
        c2 = 0.0;
        c1 = row[4] ?? 20.0;
        c0 = row[5] ?? 0.0;
      } else if (n === 1 && row.length >= 5) {
        c2 = 0.0;
        c1 = 0.0;
        c0 = row[4] ?? 0.0;
      } else if (n > 3 && row.length >= 4 + n) {
        c2 = row[4 + n - 3] ?? 0.0;
        c1 = row[4 + n - 2] ?? 20.0;
        c0 = row[4 + n - 1] ?? 0.0;
      }
    } else if (model === 1 && n >= 2 && row.length >= 4 + 2 * n) {
      pwlPoints = [];
      for (let ptIdx = 0; ptIdx < n; ptIdx++) {
        const pVal = row[4 + 2 * ptIdx]!;
        const fVal = row[4 + 2 * ptIdx + 1]!;
        pwlPoints.push({ p: pVal, f: fVal });
      }
      const p1 = pwlPoints[0]!.p;
      const f1 = pwlPoints[0]!.f;
      const pn = pwlPoints[pwlPoints.length - 1]!.p;
      const fn = pwlPoints[pwlPoints.length - 1]!.f;
      if (Math.abs(pn - p1) > 1e-6) {
        c1 = (fn - f1) / (pn - p1);
        c0 = f1 - c1 * p1;
      } else {
        c1 = 20.0;
        c0 = f1;
      }
      c2 = 0.0;
    }

    const costCurve: GeneratorCostCurve = { c0, c1, c2, pwlPoints };
    generatorCosts.set(`${g.i}_${g.id}`, costCurve);
    if (!generatorCosts.has(String(g.i))) {
      generatorCosts.set(String(g.i), costCurve);
    }
  }

  return {
    header: { sbase, basfrq: 60.0 },
    title1: "MATPOWER IMPORTED CASE",
    buses,
    loads,
    generators,
    branches,
    transformers,
    dclines: dclines.length > 0 ? dclines : undefined,
    generatorCosts: generatorCosts.size > 0 ? generatorCosts : undefined,
  };
}

/**
 * Serializes a GenericPowerCase into standard MATPOWER (.m) syntax.
 */
export function serializeMatpower(powerCase: GenericPowerCase, caseName = "case_modelscript"): string {
  const sbase = powerCase.header.sbase ?? 100.0;
  const lines: string[] = [];

  lines.push(`function mpc = ${caseName}`);
  lines.push(`%% MATPOWER Case generated by @modelscript/simulate`);
  lines.push(`mpc.version = '2';`);
  lines.push(`mpc.baseMVA = ${sbase.toFixed(1)};`);
  lines.push(``);

  // Bus Matrix
  lines.push(`%% bus data`);
  lines.push(`%  bus_i type Pd   Qd   Gs Bs area Vm    Va    baseKV zone Vmax Vmin`);
  lines.push(`mpc.bus = [`);

  // Aggregate load per bus
  const loadByBus = new Map<number, { pl: number; ql: number }>();
  for (const l of powerCase.loads) {
    if (l.status === 0) continue;
    const prev = loadByBus.get(l.i) ?? { pl: 0, ql: 0 };
    loadByBus.set(l.i, { pl: prev.pl + l.pl, ql: prev.ql + l.ql });
  }

  for (const b of powerCase.buses.values()) {
    const ld = loadByBus.get(b.i) ?? { pl: 0, ql: 0 };
    lines.push(
      `  ${b.i}\t${b.ide}\t${ld.pl.toFixed(2)}\t${ld.ql.toFixed(2)}\t0\t0\t1\t${b.vm.toFixed(4)}\t${b.va.toFixed(2)}\t${b.baseKv.toFixed(1)}\t1\t1.1\t0.9;`,
    );
  }
  lines.push(`];`);
  lines.push(``);

  // Generator Matrix
  lines.push(`%% generator data`);
  lines.push(`%  bus Pg     Qg     Qmax    Qmin   Vg   mBase status Pmax    Pmin`);
  lines.push(`mpc.gen = [`);
  for (const g of powerCase.generators) {
    const pt = g.pt ?? 999.0;
    const pb = g.pb ?? 0.0;
    const qt = g.qt ?? 999.0;
    const qb = g.qb ?? -999.0;
    const stat = g.stat ?? 1;
    lines.push(
      `  ${g.i}\t${g.pg.toFixed(2)}\t${g.qg.toFixed(2)}\t${qt.toFixed(2)}\t${qb.toFixed(2)}\t1.0\t${sbase.toFixed(1)}\t${stat}\t${pt.toFixed(2)}\t${pb.toFixed(2)};`,
    );
  }
  lines.push(`];`);
  lines.push(``);

  // Branch Matrix
  lines.push(`%% branch data`);
  lines.push(`%  fbus tbus r       x       b       rateA   rateB   rateC   ratio   angle   status  angmin  angmax`);
  lines.push(`mpc.branch = [`);
  for (const br of powerCase.branches) {
    const rateA = br.rateA ?? br.ratea ?? 9999.0;
    const rateB = br.rateB ?? 0;
    const rateC = br.rateC ?? 0;
    const ratio = br.ratio ?? 0;
    const angle = br.angle ?? 0;
    const st = br.st ?? 1;
    const angmin = br.angmin ?? -360.0;
    const angmax = br.angmax ?? 360.0;
    lines.push(
      `  ${br.i}\t${br.j}\t${br.r.toFixed(5)}\t${br.x.toFixed(5)}\t${(br.b ?? 0).toFixed(5)}\t${rateA.toFixed(1)}\t${rateB.toFixed(1)}\t${rateC.toFixed(1)}\t${ratio.toFixed(4)}\t${angle.toFixed(2)}\t${st}\t${angmin.toFixed(1)}\t${angmax.toFixed(1)};`,
    );
  }
  if (powerCase.transformers) {
    for (const xf of powerCase.transformers) {
      const rateA = xf.rata1 ?? 9999.0;
      const rateB = xf.rateB ?? 0;
      const rateC = xf.rateC ?? 0;
      const ratio = xf.ratio ?? 1.0;
      const angle = xf.angle ?? 0;
      const st = xf.stat ?? 1;
      lines.push(
        `  ${xf.i}\t${xf.j}\t${xf.r12.toFixed(5)}\t${xf.x12.toFixed(5)}\t0\t${rateA.toFixed(1)}\t${rateB.toFixed(1)}\t${rateC.toFixed(1)}\t${ratio.toFixed(4)}\t${angle.toFixed(2)}\t${st}\t-360.0\t360.0;`,
      );
    }
  }
  lines.push(`];`);
  lines.push(``);

  // DC Line Matrix (dcline)
  if (powerCase.dclines && powerCase.dclines.length > 0) {
    lines.push(`%% dcline data`);
    lines.push(`%  fbus tbus status Pf    Pt    Qf    Qt    Vf   Vt   Pmin  Pmax  QminF QmaxF QminT QmaxT loss0 loss1`);
    lines.push(`mpc.dcline = [`);
    for (const dc of powerCase.dclines) {
      lines.push(
        `  ${dc.fBus}\t${dc.tBus}\t${dc.status}\t${dc.pf.toFixed(2)}\t${dc.pt.toFixed(2)}\t${dc.qf.toFixed(2)}\t${dc.qt.toFixed(2)}\t${dc.vf.toFixed(4)}\t${dc.vt.toFixed(4)}\t${dc.pmin.toFixed(2)}\t${dc.pmax.toFixed(2)}\t${dc.qminF.toFixed(2)}\t${dc.qmaxF.toFixed(2)}\t${dc.qminT.toFixed(2)}\t${dc.qmaxT.toFixed(2)}\t${(dc.loss0 ?? 0).toFixed(2)}\t${(dc.loss1 ?? 0).toFixed(4)};`,
      );
    }
    lines.push(`];`);
    lines.push(``);
  }

  // Generator Cost Matrix (gencost)
  if (powerCase.generatorCosts && powerCase.generatorCosts.size > 0) {
    lines.push(`%% generator cost data`);
    lines.push(`%  1  startup  shutdown  n  c(n-1) ... c0`);
    lines.push(`mpc.gencost = [`);
    for (const g of powerCase.generators) {
      const cleanId = g.id.trim() || "1";
      const cost = powerCase.generatorCosts.get(`${g.i}_${cleanId}`) ??
        powerCase.generatorCosts.get(String(g.i)) ?? { c0: 0.0, c1: 20.0, c2: 0.0 };
      if (cost.pwlPoints && cost.pwlPoints.length >= 2) {
        const pts = cost.pwlPoints;
        const ptStr = pts.map((p) => `${p.p.toFixed(2)}\t${p.f.toFixed(2)}`).join("\t");
        lines.push(`  1\t0.0\t0.0\t${pts.length}\t${ptStr};`);
      } else {
        const c2 = cost.c2 ?? 0.0;
        const c1 = cost.c1;
        const c0 = cost.c0 ?? 0.0;
        lines.push(`  2\t0.0\t0.0\t3\t${c2.toFixed(6)}\t${c1.toFixed(4)}\t${c0.toFixed(2)};`);
      }
    }
    lines.push(`];`);
    lines.push(``);
  }

  return lines.join("\n");
}

/** VeraGrid (GridCal) Native JSON schema interfaces. */
export interface VeraGridBusJson {
  name: string;
  vnom: number; // in kV
  vm?: number | undefined;
  va?: number | undefined;
  is_slack?: boolean | undefined;
}

export interface VeraGridLoadJson {
  bus: string;
  P: number; // in MW
  Q: number; // in MVAR
}

export interface VeraGridGeneratorJson {
  bus: string;
  P: number; // in MW
  Q: number; // in MVAR
  Pmin?: number | undefined;
  Pmax?: number | undefined;
  Qmin?: number | undefined;
  Qmax?: number | undefined;
  cost?: number | undefined; // $/MWh
}

export interface VeraGridBranchJson {
  bus_from: string;
  bus_to: string;
  r: number; // p.u.
  x: number; // p.u.
  b?: number | undefined; // p.u.
  rate?: number | undefined; // MVA
}

export interface VeraGridCircuitJson {
  name?: string | undefined;
  sbase?: number | undefined;
  buses: VeraGridBusJson[];
  loads?: VeraGridLoadJson[] | undefined;
  generators?: VeraGridGeneratorJson[] | undefined;
  lines?: VeraGridBranchJson[] | undefined;
}

/**
 * Parses a VeraGrid (GridCal) native JSON string into a GenericPowerCase.
 */
export function parseVeraGridJson(jsonSource: string): GenericPowerCase {
  const data = JSON.parse(jsonSource) as VeraGridCircuitJson;
  const sbase = data.sbase ?? 100.0;

  const busNameToNum = new Map<string, number>();
  const buses = new Map<number, { i: number; name: string; baseKv: number; ide: number; vm: number; va: number }>();

  let counter = 1;
  for (const b of data.buses) {
    const num = counter++;
    busNameToNum.set(b.name, num);
    buses.set(num, {
      i: num,
      name: b.name,
      baseKv: b.vnom > 0 ? b.vnom : 230.0,
      ide: b.is_slack ? 3 : 1,
      vm: b.vm ?? 1.0,
      va: b.va ?? 0.0,
    });
  }

  const loads: Array<{ i: number; pl: number; ql: number; status?: number }> = [];
  if (data.loads) {
    for (const l of data.loads) {
      const bNum = busNameToNum.get(l.bus);
      if (bNum) {
        loads.push({
          i: bNum,
          pl: l.P,
          ql: l.Q,
          status: 1,
        });
      }
    }
  }

  const generators: Array<{
    i: number;
    id: string;
    pg: number;
    qg: number;
    pb?: number;
    pt?: number;
    qb?: number;
    qt?: number;
    stat?: number;
  }> = [];

  if (data.generators) {
    let genCount = 1;
    for (const g of data.generators) {
      const bNum = busNameToNum.get(g.bus);
      if (bNum) {
        const bus = buses.get(bNum);
        if (bus && bus.ide !== 3) bus.ide = 2; // PV bus

        generators.push({
          i: bNum,
          id: String(genCount++),
          pg: g.P,
          qg: g.Q,
          pt: g.Pmax ?? 999.0,
          pb: g.Pmin ?? 0.0,
          qt: g.Qmax ?? 999.0,
          qb: g.Qmin ?? -999.0,
          stat: 1,
        });
      }
    }
  }

  const branches: Array<{
    i: number;
    j: number;
    ckt: string;
    r: number;
    x: number;
    b?: number;
    rateA?: number;
    st?: number;
  }> = [];

  if (data.lines) {
    for (const l of data.lines) {
      const fNum = busNameToNum.get(l.bus_from);
      const tNum = busNameToNum.get(l.bus_to);
      if (fNum && tNum) {
        branches.push({
          i: fNum,
          j: tNum,
          ckt: "1",
          r: l.r,
          x: Math.max(l.x, 1e-4),
          b: l.b ?? 0.0,
          rateA: l.rate ?? 9999.0,
          st: 1,
        });
      }
    }
  }

  return {
    header: { sbase, basfrq: 60.0 },
    title1: data.name || "VERAGRID IMPORTED CASE",
    buses,
    loads,
    generators,
    branches,
  };
}

/**
 * Serializes a GenericPowerCase into VeraGrid (GridCal) native JSON schema.
 */
export function serializeVeraGridJson(powerCase: GenericPowerCase): string {
  const sbase = powerCase.header.sbase ?? 100.0;
  const buses: VeraGridBusJson[] = [];

  for (const b of powerCase.buses.values()) {
    buses.push({
      name: b.name || `Bus_${b.i}`,
      vnom: b.baseKv,
      vm: b.vm,
      va: b.va,
      is_slack: b.ide === 3,
    });
  }

  const loads: VeraGridLoadJson[] = [];
  for (const l of powerCase.loads) {
    const bus = powerCase.buses.get(l.i);
    loads.push({
      bus: bus?.name || `Bus_${l.i}`,
      P: l.pl,
      Q: l.ql,
    });
  }

  const generators: VeraGridGeneratorJson[] = [];
  for (const g of powerCase.generators) {
    const bus = powerCase.buses.get(g.i);
    generators.push({
      bus: bus?.name || `Bus_${g.i}`,
      P: g.pg,
      Q: g.qg,
      Pmax: g.pt,
      Pmin: g.pb,
      Qmax: g.qt,
      Qmin: g.qb,
    });
  }

  const lines: VeraGridBranchJson[] = [];
  for (const br of powerCase.branches) {
    const fBus = powerCase.buses.get(br.i);
    const tBus = powerCase.buses.get(br.j);
    lines.push({
      bus_from: fBus?.name || `Bus_${br.i}`,
      bus_to: tBus?.name || `Bus_${br.j}`,
      r: br.r,
      x: br.x,
      b: br.b ?? 0.0,
      rate: br.rateA ?? br.ratea,
    });
  }

  const circuit: VeraGridCircuitJson = {
    name: powerCase.title1 || "ModelScriptGrid",
    sbase,
    buses,
    loads,
    generators,
    lines,
  };

  return JSON.stringify(circuit, null, 2);
}
