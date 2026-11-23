// SPDX-License-Identifier: AGPL-3.0-or-later

import { flattenCifLayout, type CifFlattenOptions, type FlattenedCifLayout } from "../cad/geometry.js";
import { lookupMosisLayerRule } from "../catalog/cif-std-schemas.js";
import type { CifDocument } from "../types.js";

export interface CifToGdtOptions extends CifFlattenOptions {
  /** Library name in the GDT header (default: `"CIF_LIB"`). */
  libraryName?: string;
  /** Top cell name in the GDT output (default: `"TOP"`). */
  cellName?: string;
  /** Database unit in meters (default: `1e-8` = 0.01 µm = 1 CIF unit). */
  dbUnitMeters?: number;
  /** User unit in meters (default: `1e-6` = 1 µm). */
  userUnitMeters?: number;
}

function fmtCoord(v: number): string {
  const rounded = Math.round(v * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/\.?0+$/, "");
}

function gdsLayerNumberFor(layer: string): number {
  const rule = lookupMosisLayerRule(layer);
  if (rule) return rule.gdsLayer;
  // Deterministic fallback layer number (60..120) for custom user layers
  let hash = 0;
  for (let i = 0; i < layer.length; i++) {
    hash = (hash * 31 + layer.charCodeAt(i)) % 61;
  }
  return 60 + hash;
}

/**
 * Projects a flattened CIF layout into GDSII GDT (Graphical Data Text) format.
 */
export function layoutToGdt(layout: FlattenedCifLayout, options?: CifToGdtOptions): string {
  const libName = options?.libraryName ?? "CIF_LIB";
  const cellName = options?.cellName ?? "TOP";
  const dbUnit = options?.dbUnitMeters ?? 1e-8;
  const userUnit = options?.userUnitMeters ?? 1e-6;
  const userPerDb = dbUnit / userUnit;

  const lines: string[] = [
    `gds2{600`,
    `m=1979-07-01 00:00:00 a=1979-07-01 00:00:00`,
    `lib '${libName}' ${userPerDb} ${dbUnit}`,
    `cell{c=1979-07-01 00:00:00 m=1979-07-01 00:00:00 '${cellName}'`,
  ];

  for (const poly of layout.polygons) {
    if (poly.points.length < 3) continue;
    const gdsLayer = gdsLayerNumberFor(poly.layer);
    // GDSII boundary polygons are explicitly closed (last point repeats first point)
    const closedPts = [...poly.points, poly.points[0]!];
    const xyList = closedPts.map((p) => `${fmtCoord(p.x / 100)} ${fmtCoord(p.y / 100)}`).join(" ");
    lines.push(`b{${gdsLayer} xy(${xyList})}`);
  }

  lines.push("}");
  lines.push("}");
  return lines.join("\n") + "\n";
}

/**
 * Projects a parsed CIF 2.0 document into GDSII GDT (Graphical Data Text) format.
 */
export function cifToGdt(doc: CifDocument, options?: CifToGdtOptions): string {
  const layout = flattenCifLayout(doc, options);
  return layoutToGdt(layout, options);
}
