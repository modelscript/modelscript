// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./dae/pypsa-to-dae.js";
export * from "./indexing.js";
export * from "./language.js";
export * from "./lints/index.js";
export * from "./lsp.js";
export * from "./parser/pypsa-parser.js";
export * from "./projections/pypsa-to-ampl.js";
export * from "./tgg/index.js";
export * from "./types.js";

export async function buildPypsaDiagramInput(text: string): Promise<any> {
  const { parsePypsa } = await import("./index.js");
  const net = parsePypsa(text);
  const busIdMap = new Map<string, number>();
  const buses = new Map<number, { i: number; name: string; baseKv: number; ide: number; vm: number; va: number }>();
  net.buses.forEach((b, idx) => {
    const id = idx + 1;
    busIdMap.set(b.name, id);
    buses.set(id, { i: id, name: b.name, baseKv: b.v_nom, ide: idx === 0 ? 3 : 1, vm: 1.0, va: 0.0 });
  });
  const branches = net.lines.map((l, idx) => ({
    i: busIdMap.get(l.bus0) ?? 1,
    j: busIdMap.get(l.bus1) ?? 1,
    ckt: String(idx + 1),
    r: l.r,
    x: l.x,
    b: l.b,
    ratea: l.s_nom,
    st: 1,
  }));
  const generators = net.generators.map((g, idx) => ({
    i: busIdMap.get(g.bus) ?? 1,
    id: String(idx + 1),
    pg: g.p_nom,
    qg: 0,
    stat: 1,
  }));
  const loads = net.loads.map((ld, idx) => ({
    i: busIdMap.get(ld.bus) ?? 1,
    id: String(idx + 1),
    pl: ld.p_set,
    ql: ld.q_set,
    status: 1,
  }));
  return { title1: net.name, buses, branches, generators, loads };
}
