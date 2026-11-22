// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — KiCad 8 `.kicad_pcb` Exporter.
 *
 * Emits a standards-compliant KiCad 8 S-expression `.kicad_pcb` file from
 * ModelScript's canonical `PCBLayout`, enabling round-trip workflows with
 * Modelica, SPICE, IPC-2581, and `@modelscript/cad`.
 */

import type { PCBLayout } from "@modelscript/cad/ecad";
import { canonicalLayerToKiCad } from "./cad-bridge.js";

export interface KiCadExportOptions {
  version?: string;
  generator?: string;
}

function quote(str: string): string {
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function boardToLocalPad(fpAt: [number, number], fpRotDeg: number, padBoard: [number, number]): [number, number] {
  const dx = padBoard[0] - fpAt[0];
  const dy = padBoard[1] - fpAt[1];
  const rad = (fpRotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/**
 * Serializes a canonical `PCBLayout` into a KiCad 8 `.kicad_pcb` S-expression string.
 */
export function exportToKiCadPcb(layout: PCBLayout, options?: KiCadExportOptions): string {
  const version = options?.version ?? "20240108";
  const generator = options?.generator ?? "modelscript";

  const lines: string[] = [];
  lines.push(`(kicad_pcb`);
  lines.push(`  (version ${version})`);
  lines.push(`  (generator ${quote(generator)})`);

  // Layers
  lines.push(`  (layers`);
  lines.push(`    (0 "F.Cu" signal)`);
  lines.push(`    (31 "B.Cu" signal)`);
  lines.push(`    (36 "B.SilkS" user "B.Silkscreen")`);
  lines.push(`    (37 "F.SilkS" user "F.Silkscreen")`);
  lines.push(`    (38 "B.Mask" user)`);
  lines.push(`    (39 "F.Mask" user)`);
  lines.push(`    (44 "Edge.Cuts" user)`);
  lines.push(`  )`);

  // Setup & Stackup
  if (layout.stackup && layout.stackup.length > 0) {
    lines.push(`  (setup`);
    lines.push(`    (stackup`);
    for (const sl of layout.stackup) {
      const kName = canonicalLayerToKiCad(sl.name);
      const kType = sl.type === "CONDUCTOR" ? "copper" : sl.type === "DIELECTRIC" ? "core" : sl.type.toLowerCase();
      lines.push(`      (layer ${quote(kName)}`);
      lines.push(`        (type ${quote(kType)})`);
      if (sl.thicknessMm !== undefined) lines.push(`        (thickness ${fmt(sl.thicknessMm)})`);
      if (sl.material) lines.push(`        (material ${quote(sl.material)})`);
      if (sl.dielectricConstant !== undefined) lines.push(`        (epsilon_r ${fmt(sl.dielectricConstant)})`);
      if (sl.lossTangent !== undefined) lines.push(`        (loss_tangent ${fmt(sl.lossTangent)})`);
      lines.push(`      )`);
    }
    lines.push(`    )`);
    lines.push(`  )`);
  }

  // Build net ID table (0 is always unconnected "")
  const netIdMap = new Map<string, number>();
  netIdMap.set("", 0);
  lines.push(`  (net 0 "")`);
  let nextNetId = 1;
  const registerNet = (name: string): number => {
    if (!name) return 0;
    const existing = netIdMap.get(name);
    if (existing !== undefined) return existing;
    const id = nextNetId++;
    netIdMap.set(name, id);
    lines.push(`  (net ${id} ${quote(name)})`);
    return id;
  };
  for (const n of layout.netlist.nets) registerNet(n.id);
  for (const t of layout.traces) registerNet(t.net);
  for (const p of layout.pads) registerNet(p.net);
  for (const v of layout.vias) registerNet(v.net);
  for (const z of layout.zones ?? []) registerNet(z.net);

  // Group pads by component
  const padsByComp = new Map<string, typeof layout.pads>();
  for (const pad of layout.pads) {
    const list = padsByComp.get(pad.component) ?? [];
    list.push(pad);
    padsByComp.set(pad.component, list);
  }

  // Footprints
  for (const comp of layout.netlist.components) {
    const pl = comp.placement;
    const fx = pl?.x ?? 0;
    const fy = pl?.y ?? 0;
    const frot = pl?.angle ?? 0;
    const flayer = canonicalLayerToKiCad(pl?.layer ?? "TopCopper");
    const libId = pl?.footprint ?? "ModelScript:Generic";
    const bomEntry = layout.bom?.[comp.name];

    lines.push(`  (footprint ${quote(libId)}`);
    lines.push(`    (layer ${quote(flayer)})`);
    lines.push(`    (at ${fmt(fx)} ${fmt(fy)}${frot !== 0 ? ` ${fmt(frot)}` : ""})`);
    lines.push(`    (property "Reference" ${quote(comp.name)})`);
    lines.push(`    (property "Value" ${quote(bomEntry?.value ?? comp.name)})`);
    if (bomEntry?.mpn) lines.push(`    (property "MPN" ${quote(bomEntry.mpn)})`);
    if (bomEntry?.dnp) lines.push(`    (attr smd dnp)`);

    const compPads = padsByComp.get(comp.name) ?? [];
    for (let idx = 0; idx < compPads.length; idx++) {
      const p = compPads[idx]!;
      const pinNum = comp.pins[idx] ?? String(idx + 1);
      const localAt = boardToLocalPad([fx, fy], frot, p.center);
      const padType = p.drill > 0 ? "thru_hole" : "smd";
      const kLayer = canonicalLayerToKiCad(p.layer);
      const pLayers = p.drill > 0 ? `"*.Cu" "*.Mask"` : quote(kLayer);
      const netId = registerNet(p.net);
      const drillPart = p.drill > 0 ? ` (drill ${fmt(p.drill)})` : "";
      lines.push(
        `    (pad ${quote(pinNum)} ${padType} ${p.shape} (at ${fmt(localAt[0])} ${fmt(localAt[1])}) (size ${fmt(p.width)} ${fmt(p.height)})${drillPart} (layers ${pLayers}) (net ${netId} ${quote(p.net)}))`,
      );
    }
    lines.push(`  )`);
  }

  // Board Outline (Edge.Cuts gr_line segments)
  if (layout.outline && layout.outline.vertices.length >= 3) {
    const verts = layout.outline.vertices;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!;
      const b = verts[(i + 1) % verts.length]!;
      lines.push(
        `  (gr_line (start ${fmt(a[0])} ${fmt(a[1])}) (end ${fmt(b[0])} ${fmt(b[1])}) (layer "Edge.Cuts") (width 0.1))`,
      );
    }
  }

  // Segments
  for (const t of layout.traces) {
    const netId = registerNet(t.net);
    lines.push(
      `  (segment (start ${fmt(t.start[0])} ${fmt(t.start[1])}) (end ${fmt(t.end[0])} ${fmt(t.end[1])}) (width ${fmt(t.width)}) (layer ${quote(canonicalLayerToKiCad(t.layer))}) (net ${netId}))`,
    );
  }

  // Arcs
  for (const a of layout.arcs ?? []) {
    const netId = registerNet(a.net);
    lines.push(
      `  (arc (start ${fmt(a.start[0])} ${fmt(a.start[1])}) (mid ${fmt(a.mid[0])} ${fmt(a.mid[1])}) (end ${fmt(a.end[0])} ${fmt(a.end[1])}) (width ${fmt(a.width)}) (layer ${quote(canonicalLayerToKiCad(a.layer))}) (net ${netId}))`,
    );
  }

  // Vias
  for (const v of layout.vias) {
    const netId = registerNet(v.net);
    const outer = v.drill + 2 * v.annularRing;
    lines.push(
      `  (via (at ${fmt(v.center[0])} ${fmt(v.center[1])}) (size ${fmt(outer)}) (drill ${fmt(v.drill)}) (layers "F.Cu" "B.Cu") (net ${netId}))`,
    );
  }

  // Copper Zones
  for (const z of layout.zones ?? []) {
    const netId = registerNet(z.net);
    lines.push(`  (zone (net ${netId}) (net_name ${quote(z.net)}) (layer ${quote(canonicalLayerToKiCad(z.layer))})`);
    if (z.clearance !== undefined) {
      lines.push(`    (connect_pads (clearance ${fmt(z.clearance)}))`);
    }
    lines.push(`    (polygon (pts ${z.vertices.map(([x, y]) => `(xy ${fmt(x)} ${fmt(y)})`).join(" ")}))`);
    lines.push(`  )`);
  }

  lines.push(`)`);
  return lines.join("\n");
}
