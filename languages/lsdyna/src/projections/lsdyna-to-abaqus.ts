// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LsDynaDeck, LsDynaElementKind } from "../types.js";

function abaqusElementType(kind: LsDynaElementKind, nodeCount: number): string {
  if (kind === "BEAM") return "T3D2";
  if (kind === "SHELL") return nodeCount <= 3 ? "S3R" : "S4R";
  return nodeCount <= 4 ? "C3D4" : "C3D8R";
}

/**
 * Projects an LS-DYNA `.k` explicit dynamics keyword deck into an Abaqus `.inp` input deck.
 */
export function lsdynaToAbaqus(deck: LsDynaDeck): string {
  const lines: string[] = [];

  lines.push("*HEADING");
  lines.push(` ${deck.title || "LS-DYNA Projected Model"}`);
  lines.push("** Projected from LS-DYNA (.k) by @modelscript/lsdyna");

  // 1. Nodes
  if (deck.nodes.size > 0) {
    lines.push("*NODE");
    const sortedNodes = Array.from(deck.nodes.values()).sort((a, b) => a.nid - b.nid);
    for (const n of sortedNodes) {
      lines.push(`${n.nid}, ${n.x}, ${n.y}, ${n.z}`);
    }
  }

  // 2. Elements grouped by (pid, abaqusType)
  const grouped = new Map<
    string,
    { pid: number; abqType: string; elements: Array<{ eid: number; nodes: number[] }> }
  >();
  for (const el of deck.elements.values()) {
    const abqType = abaqusElementType(el.kind, el.nodes.length);
    const key = `${el.pid}:${abqType}`;
    let grp = grouped.get(key);
    if (!grp) {
      grp = { pid: el.pid, abqType, elements: [] };
      grouped.set(key, grp);
    }
    grp.elements.push({ eid: el.eid, nodes: el.nodes });
  }
  for (const grp of grouped.values()) {
    lines.push(`*ELEMENT, TYPE=${grp.abqType}, ELSET=PART_${grp.pid}`);
    for (const el of grp.elements) {
      lines.push(`${el.eid}, ${el.nodes.join(", ")}`);
    }
  }

  // 3. Node Sets
  for (const nset of deck.nodeSets.values()) {
    lines.push(`*NSET, NSET=NSET_${nset.sid}`);
    lines.push(nset.nodes.join(", "));
  }

  // 4. Sections per part
  for (const part of deck.parts.values()) {
    const sec = deck.sections.get(part.secid);
    if (!sec) continue;
    if (sec.kind === "SOLID") {
      lines.push(`*SOLID SECTION, ELSET=PART_${part.pid}, MATERIAL=MAT_${part.mid}`);
    } else if (sec.kind === "SHELL") {
      lines.push(`*SHELL SECTION, ELSET=PART_${part.pid}, MATERIAL=MAT_${part.mid}`);
      lines.push(`${sec.thickness ?? 0.01}, ${sec.nip ?? 2}`);
    } else {
      lines.push(`*SOLID SECTION, ELSET=PART_${part.pid}, MATERIAL=MAT_${part.mid}`);
      lines.push(`${sec.area ?? 1.0}`);
    }
  }

  // 5. Materials
  for (const mat of deck.materials.values()) {
    lines.push(`*MATERIAL, NAME=MAT_${mat.mid}`);
    lines.push("*DENSITY");
    lines.push(`${mat.ro}`);
    lines.push("*ELASTIC");
    lines.push(`${mat.e}, ${mat.pr}`);
    if (
      (mat.type === "MAT_PLASTIC_KINEMATIC" || mat.type === "MAT_PIECEWISE_LINEAR_PLASTICITY") &&
      mat.sigy &&
      mat.sigy > 0
    ) {
      lines.push("*PLASTIC");
      lines.push(`${mat.sigy}, 0.0`);
      if (mat.etan && mat.etan > 0) {
        lines.push(`${mat.sigy + mat.etan * 0.1}, 0.1`);
      }
    }
  }

  // 6. Amplitudes (*DEFINE_CURVE)
  for (const curve of deck.curves.values()) {
    lines.push(`*AMPLITUDE, NAME=CURVE_${curve.lcid}`);
    const pairs = curve.points.map((p) => `${p.abscissa}, ${p.ordinate}`);
    lines.push(pairs.join(", "));
  }

  // 7. Initial velocities
  if (deck.initialVelocities.length > 0) {
    lines.push("*INITIAL CONDITIONS, TYPE=VELOCITY");
    for (const iv of deck.initialVelocities) {
      const target = iv.nsid === 0 ? "ALL" : `NSET_${iv.nsid}`;
      if (iv.vx !== 0) lines.push(`${target}, 1, ${iv.vx}`);
      if (iv.vy !== 0) lines.push(`${target}, 2, ${iv.vy}`);
      if (iv.vz !== 0) lines.push(`${target}, 3, ${iv.vz}`);
    }
  }

  // 8. Explicit Dynamic Step
  const endTime = deck.controlTermination?.endtim ?? 0.01;
  lines.push("*STEP, NAME=EXPLICIT_STEP");
  lines.push("*DYNAMIC, EXPLICIT");
  lines.push(`, ${endTime}`);

  if (deck.boundaries.length > 0) {
    lines.push("*BOUNDARY");
    for (const spc of deck.boundaries) {
      const target = spc.targetType === "NODE" ? String(spc.targetId) : `NSET_${spc.targetId}`;
      if (spc.dofx) lines.push(`${target}, 1, 1, 0.0`);
      if (spc.dofy) lines.push(`${target}, 2, 2, 0.0`);
      if (spc.dofz) lines.push(`${target}, 3, 3, 0.0`);
      if (spc.dofrx) lines.push(`${target}, 4, 4, 0.0`);
      if (spc.dofry) lines.push(`${target}, 5, 5, 0.0`);
      if (spc.dofrz) lines.push(`${target}, 6, 6, 0.0`);
    }
  }

  if (deck.loads.length > 0) {
    for (const load of deck.loads) {
      const ampClause = load.lcid > 0 ? `, AMPLITUDE=CURVE_${load.lcid}` : "";
      lines.push(`*CLOAD${ampClause}`);
      lines.push(`${load.nid}, ${load.dof}, ${load.sf}`);
    }
  }

  lines.push("*END STEP");
  return lines.join("\n") + "\n";
}
