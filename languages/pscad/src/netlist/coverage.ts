// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EmtNetlist, PscxModule, PscxProject } from "../types.js";
import { resolveSubModule } from "./emt-netlist.js";

/** Component kinds that never carry electrical/EMT behavior (graphics, plotting, annotations). */
const NON_SIMULATED = new Set([
  "annotation",
  "sticky",
  "pgb",
  "datalabel",
  "xnode",
  "import",
  "export",
  "radiolink",
  "breakout",
  "datatap",
  "datamerge",
  "nodeloop",
  "ground",
]);

export interface SimulationCoverage {
  /** Instances that should participate in EMT simulation (excludes pure graphics/plumbing). */
  simulatable: number;
  /** Simulatable instances that were lowered into the netlist. */
  lowered: number;
  /** `lowered / simulatable` (1 when nothing is simulatable). */
  ratio: number;
  /** Definition names that were dropped, with counts, most frequent first. */
  dropped: { definition: string; count: number }[];
}

function idsInNetlist(netlist: EmtNetlist): Set<string> {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v) ids.add(v);
  };
  const lists: unknown[] = [
    netlist.branches,
    netlist.transformers,
    netlist.fmuInstances,
    netlist.sources,
    netlist.currentSources,
    netlist.faults,
    (netlist as unknown as Record<string, unknown>)["transmissionLines"],
    (netlist as unknown as Record<string, unknown>)["lines"],
    (netlist as unknown as Record<string, unknown>)["switches"],
    (netlist as unknown as Record<string, unknown>)["surgeArresters"],
    (netlist as unknown as Record<string, unknown>)["synchronousMachines"],
    (netlist as unknown as Record<string, unknown>)["inductionMachines"],
    (netlist as unknown as Record<string, unknown>)["converterBridges"],
    (netlist as unknown as Record<string, unknown>)["controlBlocks"],
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list as Record<string, unknown>[]) {
      add(item["id"]);
      add(item["componentId"]);
      add(item["name"]);
    }
  }
  return ids;
}

/**
 * Measures how much of a project actually reaches the EMT netlist. A low ratio means the
 * simulation result does not represent the schematic and must not be trusted for studies.
 */
export function computeSimulationCoverage(project: PscxProject, netlist: EmtNetlist): SimulationCoverage {
  const ids = [...idsInNetlist(netlist)];
  const reached = (cmpId: string, instanceName: string) =>
    ids.some(
      (id) =>
        id === cmpId ||
        id === instanceName ||
        id.endsWith(`_${cmpId}`) ||
        id.startsWith(`${cmpId}_`) ||
        id.includes(`_${cmpId}_`) ||
        (instanceName !== "" && id.endsWith(`_${instanceName}`)) ||
        // Blocks expanded per phase (e.g. inverse abcdq0) are named `<instance>_phaseA/B/C`.
        (instanceName !== "" && /_phase[ABC]$/.test(id) && id.slice(0, -"_phaseA".length).endsWith(instanceName)),
    );
  let simulatable = 0;
  let lowered = 0;
  const dropped = new Map<string, number>();
  // Walk the instantiated hierarchy (root plus every resolvable user module reached from it).
  const seen = new Set<PscxModule>();
  const queue: PscxModule[] = [project.rootModule];
  while (queue.length > 0) {
    const mod = queue.shift()!;
    if (seen.has(mod)) continue;
    seen.add(mod);
    for (const cmp of mod.components) {
      const short = (cmp.definitionName.split(":").pop() ?? cmp.definitionName).toLowerCase();
      if (NON_SIMULATED.has(short)) continue;
      // User definitions with their own schematic are flattened; their children are counted instead.
      const sub = resolveSubModule(project, cmp.definitionName);
      if (sub) {
        queue.push(sub);
        continue;
      }
      simulatable++;
      if (reached(cmp.id, cmp.instanceName ?? "")) lowered++;
      else dropped.set(cmp.definitionName, (dropped.get(cmp.definitionName) ?? 0) + 1);
    }
  }
  return {
    simulatable,
    lowered,
    ratio: simulatable === 0 ? 1 : lowered / simulatable,
    dropped: [...dropped].map(([definition, count]) => ({ definition, count })).sort((a, b) => b.count - a.count),
  };
}
