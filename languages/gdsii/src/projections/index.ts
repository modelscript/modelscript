// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projections for `@modelscript/gdsii`:
 * - `gdsiiToCif`: Caltech Intermediate Form (CIF) ASCII layout export
 * - `gdsiiToSvg`: Layered vector SVG schematic / mask layout export
 */

import { DEFAULT_CMOS_LAYER_STACK, lowerGdsiiToGeometry, type GdsiiLowerOptions } from "../cad/index.js";
import type { GdsiiLayerStackEntry, GdsiiLibrary } from "../types.js";

export interface GdsiiSvgOptions extends GdsiiLowerOptions {
  layerStack?: GdsiiLayerStackEntry[] | undefined;
  widthPx?: number | undefined;
  heightPx?: number | undefined;
  paddingFrac?: number | undefined;
}

/**
 * Projects a `GdsiiLibrary` into Caltech Intermediate Form (CIF 2.0) ASCII layout.
 */
export function gdsiiToCif(library: GdsiiLibrary): string {
  const lines: string[] = [];
  lines.push(`(GDSII Library: ${library.name}, version ${library.version});`);

  const structIndex = new Map<string, number>();
  library.structures.forEach((s, idx) => {
    structIndex.set(s.name, idx + 1);
  });

  // CIF scale factor A B (in centimicrons: 100 centimicrons = 1 um)
  const dbInCmUm = Math.max(1, Math.round(library.units.dbUnitInMeters * 1e8));

  for (const struct of library.structures) {
    const id = structIndex.get(struct.name) ?? 1;
    lines.push(`DS ${id} ${dbInCmUm} 1;`);
    lines.push(`9 ${struct.name};`);

    let currentLayer: number | null = null;
    for (const el of struct.elements) {
      if (el.kind === "boundary") {
        if (currentLayer !== el.layer) {
          lines.push(`L L${el.layer};`);
          currentLayer = el.layer;
        }
        const pts = el.xy.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
        lines.push(`P ${pts};`);
      } else if (el.kind === "path") {
        if (currentLayer !== el.layer) {
          lines.push(`L L${el.layer};`);
          currentLayer = el.layer;
        }
        const w = Math.round(Math.abs(el.width ?? 0));
        const pts = el.xy.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
        lines.push(`W ${w} ${pts};`);
      } else if (el.kind === "sref") {
        const targetId = structIndex.get(el.sname) ?? 0;
        const transforms: string[] = [];
        if (el.strans?.reflectX) transforms.push("MY");
        if (el.angle && Math.abs(el.angle) > 1e-6) {
          const rad = (el.angle * Math.PI) / 180;
          transforms.push(`R ${Math.round(Math.cos(rad) * 1000)},${Math.round(Math.sin(rad) * 1000)}`);
        }
        transforms.push(`T ${Math.round(el.xy.x)},${Math.round(el.xy.y)}`);
        lines.push(`C ${targetId} ${transforms.join(" ")};`);
      } else if (el.kind === "aref") {
        const targetId = structIndex.get(el.sname) ?? 0;
        const cols = Math.max(1, el.columns);
        const rows = Math.max(1, el.rows);
        const p0 = el.xy[0];
        const colDx = (el.xy[1].x - p0.x) / cols;
        const colDy = (el.xy[1].y - p0.y) / cols;
        const rowDx = (el.xy[2].x - p0.x) / rows;
        const rowDy = (el.xy[2].y - p0.y) / rows;
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const tx = Math.round(p0.x + c * colDx + r * rowDx);
            const ty = Math.round(p0.y + c * colDy + r * rowDy);
            lines.push(`C ${targetId} T ${tx},${ty};`);
          }
        }
      }
    }
    lines.push(`DF;`);
  }

  const topId = library.structures.length;
  if (topId > 0) {
    lines.push(`C ${topId};`);
  }
  lines.push(`E`);
  return lines.join("\n") + "\n";
}

/**
 * Projects a flattened `GdsiiLibrary` into a layered SVG mask diagram.
 */
export function gdsiiToSvg(library: GdsiiLibrary, options?: GdsiiSvgOptions): string {
  const flat = lowerGdsiiToGeometry(library, options);
  const stack = options?.layerStack ?? DEFAULT_CMOS_LAYER_STACK;
  const colorByLayer = new Map<number, { color: string; name: string }>();
  for (const entry of stack) {
    colorByLayer.set(entry.layer, { color: entry.color, name: entry.name });
  }

  const widthPx = options?.widthPx ?? 640;
  const heightPx = options?.heightPx ?? 480;
  const padFrac = options?.paddingFrac ?? 0.1;

  const bbox = flat.bboxUm ?? { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 };
  const padX = Math.max(bbox.width * padFrac, 0.5);
  const padY = Math.max(bbox.height * padFrac, 0.5);
  const vx = bbox.minX - padX;
  const vy = -(bbox.maxY + padY);
  const vw = Math.max(bbox.width + 2 * padX, 1);
  const vh = Math.max(bbox.height + 2 * padY, 1);

  const byLayer = new Map<number, typeof flat.polygons>();
  for (const poly of flat.polygons) {
    const arr = byLayer.get(poly.layer) ?? [];
    arr.push(poly);
    byLayer.set(poly.layer, arr);
  }

  const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b);
  const groups: string[] = [];
  for (const layer of sortedLayers) {
    const meta = colorByLayer.get(layer) ?? { color: "#94a3b8", name: `L${layer}` };
    const polys = byLayer.get(layer)!;
    const polyEls = polys.map((p) => {
      const ptsStr = p.pointsUm.map((pt) => `${pt.x.toFixed(4)},${(-pt.y).toFixed(4)}`).join(" ");
      return `    <polygon points="${ptsStr}" fill="${meta.color}" fill-opacity="0.45" stroke="${meta.color}" stroke-width="${(Math.max(vw, vh) * 0.004).toFixed(4)}" />`;
    });
    groups.push(`  <g data-layer="${layer}" data-name="${meta.name}">\n${polyEls.join("\n")}\n  </g>`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="${vx.toFixed(4)} ${vy.toFixed(4)} ${vw.toFixed(4)} ${vh.toFixed(4)}">`,
    `  <title>${flat.topStructure || library.name}</title>`,
    `  <rect x="${vx.toFixed(4)}" y="${vy.toFixed(4)}" width="${vw.toFixed(4)}" height="${vh.toFixed(4)}" fill="#0f172a" />`,
    ...groups,
    `</svg>`,
    "",
  ].join("\n");
}
