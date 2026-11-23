// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeCflAnalysis } from "../solver/explicit-solver.js";
import type { LsDynaDeck } from "../types.js";

/**
 * Projects an LS-DYNA `.k` explicit dynamics keyword deck into a Modelica `.mo`
 * structural dynamics model ($M \ddot{u} + K u = F$) with energy balance outputs.
 */
export function lsdynaToModelica(deck: LsDynaDeck, modelNameOverride?: string): string {
  const rawName = modelNameOverride ?? deck.title ?? "LsDynaModel";
  const modelName = rawName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "M_$1") || "LsDynaModel";
  const cfl = computeCflAnalysis(deck);
  const endTime = deck.controlTermination?.endtim ?? 0.01;

  const nodeIds = Array.from(deck.nodes.keys()).sort((a, b) => a - b);
  const massMap = new Map<number, number>();
  const fixedX = new Set<number>();
  const initVelX = new Map<number, number>();
  const couplings: Array<{ i: number; j: number; k: number }> = [];

  for (const nid of nodeIds) {
    massMap.set(nid, 0);
    const node = deck.nodes.get(nid)!;
    if (node.tc === 1 || node.tc === 4 || node.tc === 6 || node.tc === 7) fixedX.add(nid);
  }
  for (const spc of deck.boundaries) {
    if (!spc.dofx) continue;
    const targets = spc.targetType === "NODE" ? [spc.targetId] : (deck.nodeSets.get(spc.targetId)?.nodes ?? []);
    for (const nid of targets) fixedX.add(nid);
  }
  for (const iv of deck.initialVelocities) {
    const targets = iv.nsid === 0 ? nodeIds : (deck.nodeSets.get(iv.nsid)?.nodes ?? []);
    for (const nid of targets) {
      if (!fixedX.has(nid)) initVelX.set(nid, iv.vx);
    }
  }
  for (const el of deck.elements.values()) {
    const part = deck.parts.get(el.pid);
    const mat = part ? deck.materials.get(part.mid) : undefined;
    const sec = part ? deck.sections.get(part.secid) : undefined;
    if (!mat || mat.e <= 0 || mat.ro <= 0 || el.nodes.length < 2) continue;
    const n1 = el.nodes[0]!;
    const n2 = el.nodes[1]!;
    const p1 = deck.nodes.get(n1);
    const p2 = deck.nodes.get(n2);
    if (!p1 || !p2) continue;
    const L = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
    if (L <= 1e-15) continue;
    const area = sec?.area && sec.area > 0 ? sec.area : sec?.thickness && sec.thickness > 0 ? sec.thickness * L : 1.0;
    const mEl = mat.ro * area * L;
    massMap.set(n1, (massMap.get(n1) ?? 0) + 0.5 * mEl);
    massMap.set(n2, (massMap.get(n2) ?? 0) + 0.5 * mEl);
    couplings.push({ i: n1, j: n2, k: (mat.e * area) / L });
  }

  const lines: string[] = [];
  lines.push(`model ${modelName} "Projected from LS-DYNA explicit dynamics deck"`);
  lines.push(`  parameter Real cflTimestep = ${cfl.minDtCritical};`);
  lines.push(`  parameter Real maxWaveSpeed = ${cfl.maxWaveSpeed};`);
  lines.push(`  parameter Real endTime = ${endTime};`);

  for (const nid of nodeIds) {
    const m = massMap.get(nid) ?? 1.0;
    const v0 = initVelX.get(nid) ?? 0.0;
    lines.push(`  parameter Real m_${nid} = ${m > 0 ? m : 1.0};`);
    lines.push(`  Real u_${nid}(start = 0.0);`);
    lines.push(`  Real v_${nid}(start = ${v0});`);
  }

  lines.push("  Real KineticEnergy;");
  lines.push("  Real InternalEnergy;");
  lines.push("  Real TotalEnergy;");
  lines.push("equation");

  const neighbors = new Map<number, Array<{ other: number; k: number }>>();
  for (const nid of nodeIds) neighbors.set(nid, []);
  for (const c of couplings) {
    neighbors.get(c.i)!.push({ other: c.j, k: c.k });
    neighbors.get(c.j)!.push({ other: c.i, k: c.k });
  }

  for (const nid of nodeIds) {
    if (fixedX.has(nid)) {
      lines.push(`  u_${nid} = 0.0;`);
      lines.push(`  v_${nid} = 0.0;`);
    } else {
      lines.push(`  der(u_${nid}) = v_${nid};`);
      const adj = neighbors.get(nid)!;
      const forceTerms = adj.map((e) => `${e.k} * (u_${nid} - u_${e.other})`);
      const rhs = forceTerms.length > 0 ? `-(${forceTerms.join(" + ")})` : "0.0";
      lines.push(`  m_${nid} * der(v_${nid}) = ${rhs};`);
    }
  }

  const keTerms = nodeIds
    .filter((n) => !fixedX.has(n) && (massMap.get(n) ?? 0) > 0)
    .map((n) => `0.5 * m_${n} * v_${n}^2`);
  const ieTerms = couplings.map((c) => `0.5 * ${c.k} * (u_${c.j} - u_${c.i})^2`);
  lines.push(`  KineticEnergy = ${keTerms.length > 0 ? keTerms.join(" + ") : "0.0"};`);
  lines.push(`  InternalEnergy = ${ieTerms.length > 0 ? ieTerms.join(" + ") : "0.0"};`);
  lines.push("  TotalEnergy = KineticEnergy + InternalEnergy;");
  lines.push(`end ${modelName};`);

  return lines.join("\n") + "\n";
}
