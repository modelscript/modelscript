// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD real-world corpus metrics (Phase 0.1 of the hardening plan).
 *
 * Measures how well the current pipeline handles real PSCAD projects: port
 * resolution, wire attachment, master-library catalog coverage, netlist reach and
 * lint noise. The numbers are ratcheted by `corpus.test.ts` so they only improve.
 */

import { buildPscadDiagram } from "../../../packages/diagram/src/pscad-diagram-builder.js";
import { getMasterComponentSchema } from "../src/catalog/master-library-schemas.js";
import { lintPscx } from "../src/lints/index.js";
import { extractEmtNetlist } from "../src/netlist/emt-netlist.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

export interface CorpusFileMetrics {
  file: string;
  parseMs: number;
  components: number;
  componentsWithoutPorts: number;
  wires: number;
  wireEnds: number;
  wireEndsUnattached: number;
  diagramEdges: number;
  diagramEdgesWithFreeEnd: number;
  masterTypes: number;
  masterTypesInCatalog: number;
  missingMasterTypes: string[];
  lintDiagnostics: number;
  netlistBranches: number;
  /** Fractions in [0, 1]; 1 is best. */
  portCoverage: number;
  wireAttachment: number;
  catalogCoverage: number;
}

export function computeCorpusMetrics(file: string, text: string): CorpusFileMetrics {
  const t0 = performance.now();
  const project = parsePscx(text);
  const parseMs = performance.now() - t0;

  const mods = [project.rootModule, ...project.subModules.values()];
  let components = 0;
  let componentsWithoutPorts = 0;
  let wires = 0;
  let wireEnds = 0;
  let wireEndsUnattached = 0;
  for (const m of mods) {
    components += m.components.length;
    wires += m.wires.length;
    for (const c of m.components) if (!c.ports?.length) componentsWithoutPorts++;
    for (const w of m.wires) {
      wireEnds += 2;
      if (!w.startPortId) wireEndsUnattached++;
      if (!w.endPortId) wireEndsUnattached++;
    }
  }

  const masterUsed = new Map<string, number>();
  for (const m of text.matchAll(/<User classid="UserCmp"[^>]*\bdefn="(master:[^"]+)"/g)) {
    masterUsed.set(m[1]!, (masterUsed.get(m[1]!) ?? 0) + 1);
  }
  const missing = [...masterUsed.entries()]
    .filter(([d]) => !getMasterComponentSchema(d))
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);

  const diagram = buildPscadDiagram(project as never);
  const edges = diagram.cells.filter((c) => c.shape === "edge");
  const freeEdges = edges.filter(
    (e) => !(e.source as { cell?: string })?.cell || !(e.target as { cell?: string })?.cell,
  ).length;

  const netlist = extractEmtNetlist(project);

  return {
    file,
    parseMs,
    components,
    componentsWithoutPorts,
    wires,
    wireEnds,
    wireEndsUnattached,
    diagramEdges: edges.length,
    diagramEdgesWithFreeEnd: freeEdges,
    masterTypes: masterUsed.size,
    masterTypesInCatalog: masterUsed.size - missing.length,
    missingMasterTypes: missing,
    lintDiagnostics: lintPscx(project).length,
    netlistBranches: netlist.branches.length,
    portCoverage: components ? 1 - componentsWithoutPorts / components : 1,
    wireAttachment: wireEnds ? 1 - wireEndsUnattached / wireEnds : 1,
    catalogCoverage: masterUsed.size ? (masterUsed.size - missing.length) / masterUsed.size : 1,
  };
}

export function formatCorpusReport(rows: CorpusFileMetrics[]): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const lines = ["file | parse | ports | wire ends | catalog | edges free | lint", "---|---|---|---|---|---|---"];
  for (const r of rows) {
    lines.push(
      `${r.file} | ${r.parseMs.toFixed(0)}ms | ${pct(r.portCoverage)} | ${pct(r.wireAttachment)} | ` +
        `${r.masterTypesInCatalog}/${r.masterTypes} (${pct(r.catalogCoverage)}) | ` +
        `${r.diagramEdgesWithFreeEnd}/${r.diagramEdges} | ${r.lintDiagnostics}`,
    );
  }
  return lines.join("\n");
}
