// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ProSTEP iViP IDX v4.0 (ECAD-MCAD Incremental Design Exchange).
 *
 * Bidirectional XML exchange between ECAD (`PCBLayout`) and MCAD (`step` /
 * `pcba-3d.ts`), carrying board outline, board thickness, keepout regions,
 * mounting holes, and 3D component placement/height envelopes.
 */

import type { BoardOutline, KeepoutRegion, PCBLayout } from "./gerber.js";
import type { NetlistComponent } from "./netlist.js";

export interface IdxExportOptions {
  designName?: string;
  boardThicknessMm?: number;
  defaultComponentHeightMm?: number;
  componentHeightsMm?: Record<string, number>;
}

export interface IdxComponentEnvelope {
  refDes: string;
  packageName: string;
  x: number;
  y: number;
  rotation: number;
  side: "TOP" | "BOTTOM";
  heightMm: number;
}

export interface IdxParseResult {
  designName: string;
  boardThicknessMm: number;
  outline: BoardOutline | null;
  keepouts: KeepoutRegion[];
  components: IdxComponentEnvelope[];
  mountingHoles: { x: number; y: number; diameterMm: number }[];
  diagnostics: string[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Exports a `PCBLayout` to a ProSTEP iViP IDX v4.0 baseline XML document.
 */
export function exportToIdx(layout: PCBLayout, options?: IdxExportOptions): string {
  const designName = options?.designName ?? "ModelScript_PCBA";
  const thickness =
    options?.boardThicknessMm ?? layout.stackup?.reduce((acc, s) => acc + (s.thicknessMm ?? 0), 0) ?? 1.6;
  const defaultHeight = options?.defaultComponentHeightMm ?? 2.0;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<EDMDDataSet xmlns="http://www.prostep.org/EDMD/4.0" name="${esc(designName)}">`);
  lines.push(`  <Header>`);
  lines.push(`    <CreatorSystem>ModelScript ECAD-MCAD Engine</CreatorSystem>`);
  lines.push(`    <GlobalUnitLength>MILLIMETER</GlobalUnitLength>`);
  lines.push(`    <BoardThickness>${fmt(thickness > 0 ? thickness : 1.6)}</BoardThickness>`);
  lines.push(`  </Header>`);
  lines.push(`  <Body>`);

  // Board Outline
  if (layout.outline && layout.outline.vertices.length >= 3) {
    lines.push(
      `    <Item id="BOARD_OUTLINE" geometryType="BOARD_OUTLINE" thickness="${fmt(thickness > 0 ? thickness : 1.6)}">`,
    );
    lines.push(`      <PolyCurve>`);
    for (const [x, y] of layout.outline.vertices) {
      lines.push(`        <Point x="${fmt(x)}" y="${fmt(y)}"/>`);
    }
    lines.push(`      </PolyCurve>`);
    lines.push(`    </Item>`);
  }

  // Keepout Regions
  for (let i = 0; i < (layout.keepouts ?? []).length; i++) {
    const ko = layout.keepouts![i]!;
    const gType = ko.noComponents ? "KEEPOUT_AREA_COMPONENT" : "KEEPOUT_AREA_ROUTE";
    lines.push(`    <Item id="KEEPOUT_${i + 1}" geometryType="${gType}" layer="${esc(ko.layer)}">`);
    lines.push(`      <PolyCurve>`);
    for (const [x, y] of ko.vertices) {
      lines.push(`        <Point x="${fmt(x)}" y="${fmt(y)}"/>`);
    }
    lines.push(`      </PolyCurve>`);
    lines.push(`    </Item>`);
  }

  // Mounting Holes (NPTH pads with drill > 1.5mm)
  for (let i = 0; i < layout.pads.length; i++) {
    const p = layout.pads[i]!;
    if (p.drill >= 1.5) {
      lines.push(
        `    <Item id="HOLE_${i + 1}" geometryType="MOUNTING_HOLE" x="${fmt(p.center[0])}" y="${fmt(p.center[1])}" diameter="${fmt(p.drill)}"/>`,
      );
    }
  }

  // Placed 3D Components
  for (const comp of layout.netlist.components) {
    const pl = comp.placement;
    const side = pl?.layer.toLowerCase().includes("bottom") ? "BOTTOM" : "TOP";
    const pkg = pl?.footprint ?? "SMD";
    const h = options?.componentHeightsMm?.[comp.name] ?? defaultHeight;
    lines.push(
      `    <Item id="${esc(comp.name)}" geometryType="COMPONENT" refDes="${esc(comp.name)}" package="${esc(pkg)}" side="${side}" x="${fmt(pl?.x ?? 0)}" y="${fmt(pl?.y ?? 0)}" rotation="${fmt(pl?.angle ?? 0)}" height="${fmt(h)}"/>`,
    );
  }

  lines.push(`  </Body>`);
  lines.push(`</EDMDDataSet>`);
  return lines.join("\n");
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

/**
 * Parses a ProSTEP iViP IDX v4.0 XML document into board outline, keepouts,
 * mounting holes, and 3D component envelopes.
 */
export function parseIdx(xml: string): IdxParseResult {
  const diagnostics: string[] = [];
  const rootMatch = /<EDMDDataSet([^>]*)>/.exec(xml);
  if (!rootMatch) {
    diagnostics.push("Missing <EDMDDataSet> root element.");
    return {
      designName: "",
      boardThicknessMm: 1.6,
      outline: null,
      keepouts: [],
      components: [],
      mountingHoles: [],
      diagnostics,
    };
  }

  const rootAttrs = parseAttrs(rootMatch[1]!);
  const designName = rootAttrs["name"] ?? "IDX_BOARD";
  const thickMatch = /<BoardThickness>([^<]+)<\/BoardThickness>/.exec(xml);
  const boardThicknessMm = thickMatch ? Number.parseFloat(thickMatch[1]!) || 1.6 : 1.6;

  let outline: BoardOutline | null = null;
  const keepouts: KeepoutRegion[] = [];
  const components: IdxComponentEnvelope[] = [];
  const mountingHoles: { x: number; y: number; diameterMm: number }[] = [];

  // Block <Item ...>...</Item>
  const blockItemRe = /<Item([^>]*?)>([\s\S]*?)<\/Item>/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockItemRe.exec(xml)) !== null) {
    const attrs = parseAttrs(bm[1]!);
    const body = bm[2]!;
    const gType = attrs["geometryType"] ?? "";
    const pts: [number, number][] = [];
    const ptRe = /<Point([^>]*?)\/>/g;
    let pm: RegExpExecArray | null;
    while ((pm = ptRe.exec(body)) !== null) {
      const pa = parseAttrs(pm[1]!);
      pts.push([Number.parseFloat(pa["x"] ?? "0"), Number.parseFloat(pa["y"] ?? "0")]);
    }
    if (gType === "BOARD_OUTLINE" && pts.length >= 3) {
      outline = { vertices: pts };
    } else if (gType.startsWith("KEEPOUT_AREA") && pts.length >= 3) {
      keepouts.push({
        layer: attrs["layer"] ?? "ALL",
        vertices: pts,
        noComponents: gType === "KEEPOUT_AREA_COMPONENT",
        noTracks: gType === "KEEPOUT_AREA_ROUTE",
      });
    }
  }

  // Self-closing <Item .../>
  const selfItemRe = /<Item([^>]*?)\/>/g;
  let sm: RegExpExecArray | null;
  while ((sm = selfItemRe.exec(xml)) !== null) {
    const attrs = parseAttrs(sm[1]!);
    const gType = attrs["geometryType"] ?? "";
    if (gType === "COMPONENT") {
      components.push({
        refDes: attrs["refDes"] ?? attrs["id"] ?? "",
        packageName: attrs["package"] ?? "SMD",
        x: Number.parseFloat(attrs["x"] ?? "0"),
        y: Number.parseFloat(attrs["y"] ?? "0"),
        rotation: Number.parseFloat(attrs["rotation"] ?? "0"),
        side: attrs["side"]?.toUpperCase() === "BOTTOM" ? "BOTTOM" : "TOP",
        heightMm: Number.parseFloat(attrs["height"] ?? "2"),
      });
    } else if (gType === "MOUNTING_HOLE") {
      mountingHoles.push({
        x: Number.parseFloat(attrs["x"] ?? "0"),
        y: Number.parseFloat(attrs["y"] ?? "0"),
        diameterMm: Number.parseFloat(attrs["diameter"] ?? "3.2"),
      });
    }
  }

  return { designName, boardThicknessMm, outline, keepouts, components, mountingHoles, diagnostics };
}

/**
 * Applies mechanical changes (outline, keepouts, component placements) from an
 * IDX exchange file back onto a `PCBLayout`.
 */
export function applyIdxToLayout(layout: PCBLayout, idx: IdxParseResult): PCBLayout {
  const byRef = new Map<string, IdxComponentEnvelope>();
  for (const c of idx.components) byRef.set(c.refDes, c);

  const updatedComponents: NetlistComponent[] = layout.netlist.components.map((comp) => {
    const mcad = byRef.get(comp.name);
    if (!mcad) return comp;
    return {
      ...comp,
      placement: {
        footprint: mcad.packageName || comp.placement?.footprint || null,
        layer: mcad.side === "BOTTOM" ? "BottomCopper" : "TopCopper",
        x: mcad.x,
        y: mcad.y,
        angle: mcad.rotation,
      },
    };
  });

  const next: PCBLayout = {
    ...layout,
    outline: idx.outline ?? layout.outline,
    netlist: { ...layout.netlist, components: updatedComponents },
  };
  if (idx.keepouts.length > 0) next.keepouts = idx.keepouts;
  return next;
}
