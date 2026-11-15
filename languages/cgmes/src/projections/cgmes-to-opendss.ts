// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Projection from CIM / CGMES (including IEC 61968 ACLineSegmentPhase) to OpenDSS `.dss`.
 */

import { processTopology } from "../topology/topology-processor.js";
import type { CgmesModel } from "../types.js";

/**
 * Synthesizes an OpenDSS `.dss` feeder script from a parsed CGMES/CIM model.
 */
export function cgmesToOpenDss(model: CgmesModel, circuitName = "CGMES_FEEDER"): string {
  const topo = processTopology(model);
  const lines: string[] = [`Clear`, `New Circuit.${circuitName} basekv=115 pu=1.0`];

  // Map ACLineSegment -> number of phases from IEC 61968 ACLineSegmentPhase if available
  const phasesByLine = new Map<string, Set<string>>();
  if (model.linePhases) {
    for (const lp of model.linePhases.values()) {
      const set = phasesByLine.get(lp.acLineSegmentId) ?? new Set<string>();
      if (lp.phase && lp.phase !== "N") set.add(lp.phase);
      phasesByLine.set(lp.acLineSegmentId, set);
    }
  }

  const eqTerms = new Map<string, string[]>();
  for (const t of model.terminals.values()) {
    const arr = eqTerms.get(t.conductingEquipmentId) ?? [];
    arr.push(t.connectivityNodeId ?? t.topologicalNodeId ?? "");
    eqTerms.set(t.conductingEquipmentId, arr);
  }

  for (const line of model.lines.values()) {
    const buses = eqTerms.get(line.mRID);
    if (!buses || buses.length < 2 || !buses[0] || !buses[1]) continue;
    const phaseSet = phasesByLine.get(line.mRID);
    const nPhases = phaseSet && phaseSet.size > 0 ? phaseSet.size : 3;
    const lenKm = line.lengthKm ?? 1.0;
    const safeName = line.name.replace(/\s+/g, "_");
    lines.push(
      `New Line.${safeName} phases=${nPhases} bus1=${buses[0]} bus2=${buses[1]} length=${lenKm} units=km r1=${line.r} x1=${Math.max(line.x, 1e-4)}`,
    );
  }

  for (const load of model.loads.values()) {
    const buses = eqTerms.get(load.mRID);
    if (!buses || buses.length === 0 || !buses[0]) continue;
    const safeName = load.name.replace(/\s+/g, "_");
    lines.push(`New Load.${safeName} phases=3 bus1=${buses[0]} kw=${load.pMw * 1000} kvar=${load.qMvar * 1000}`);
  }

  const kvList = [...new Set([...model.baseVoltages.values()])];
  if (kvList.length > 0) {
    lines.push(`Set voltagebases=[${kvList.join(", ")}]`);
    lines.push(`Calcvoltagebases`);
  }

  void topo;
  return lines.join("\n");
}
