// SPDX-License-Identifier: AGPL-3.0-or-later

import { flattenCifLayout, type CifFlattenOptions, type FlattenedCifLayout } from "../cad/geometry.js";
import { lookupMosisLayerRule } from "../catalog/cif-std-schemas.js";
import type { CifDocument } from "../types.js";

export interface CifToSvgOptions extends CifFlattenOptions {
  /** Output SVG width in pixels (default: 640). */
  width?: number;
  /** Output SVG height in pixels (default: 480). */
  height?: number;
  /** Padding ratio around layout bounding box (default: 0.1). */
  paddingRatio?: number;
  /** Include background rectangle and layer legend (default: true). */
  showLegend?: boolean;
  /** Optional title embedded in `<title>`. */
  title?: string;
}

const LAYER_DRAW_ORDER: readonly string[] = [
  "CWN",
  "NI",
  "CAA",
  "ND",
  "CPG",
  "NP",
  "CCA",
  "NC",
  "CMF",
  "NM",
  "CVA",
  "CMS",
];

function layerOrderRank(layer: string): number {
  const idx = LAYER_DRAW_ORDER.indexOf(layer.toUpperCase());
  return idx >= 0 ? idx : 100;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Projects a flattened CIF layout into a color-coded MOSIS SCMOS / Mead-Conway SVG diagram.
 */
export function layoutToSvg(layout: FlattenedCifLayout, options?: CifToSvgOptions): string {
  const width = options?.width ?? 640;
  const height = options?.height ?? 480;
  const paddingRatio = options?.paddingRatio ?? 0.1;
  const showLegend = options?.showLegend ?? true;
  const title = options?.title ?? "CIF 2.0 IC Mask Layout";

  const { bbox } = layout;
  const spanX = Math.max(bbox.width, 100);
  const spanY = Math.max(bbox.height, 100);
  const padX = spanX * paddingRatio;
  const padY = spanY * paddingRatio;

  const vbMinX = bbox.minX - padX;
  const vbWidth = spanX + 2 * padX;
  // Flip Y axis so standard Cartesian +Y points upward in SVG
  const vbMinY = -(bbox.maxY + padY);
  const vbHeight = spanY + 2 * padY;

  const strokeWidth = Math.max(vbWidth, vbHeight) * 0.004;

  const sortedLayers = Object.keys(layout.layerPolygons).sort(
    (a, b) => layerOrderRank(a) - layerOrderRank(b) || a.localeCompare(b),
  );

  const layerGroups: string[] = [];
  for (const layer of sortedLayers) {
    const polys = layout.layerPolygons[layer] ?? [];
    const rule = lookupMosisLayerRule(layer);
    const fill = rule?.color ?? "#64748b";
    const stroke = rule?.stroke ?? "#cbd5e1";
    const opacity = rule?.opacity ?? 0.7;

    const polyEls = polys.map((poly) => {
      const ptsAttr = poly.points.map((p) => `${p.x.toFixed(2)},${(-p.y).toFixed(2)}`).join(" ");
      return `    <polygon points="${ptsAttr}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(3)}"/>`;
    });

    layerGroups.push(
      `  <g id="layer-${escapeXml(layer)}" data-layer="${escapeXml(layer)}">\n${polyEls.join("\n")}\n  </g>`,
    );
  }

  let legendSvg = "";
  if (showLegend && sortedLayers.length > 0) {
    const itemHeight = vbHeight * 0.045;
    const fontSize = itemHeight * 0.7;
    const boxSize = itemHeight * 0.65;
    const lx = vbMinX + vbWidth * 0.02;
    const lyStart = vbMinY + vbHeight * 0.04;
    const items = sortedLayers.map((layer, i) => {
      const rule = lookupMosisLayerRule(layer);
      const fill = rule?.color ?? "#64748b";
      const stroke = rule?.stroke ?? "#cbd5e1";
      const y = lyStart + i * itemHeight;
      return (
        `    <rect x="${lx.toFixed(2)}" y="${y.toFixed(2)}" width="${boxSize.toFixed(2)}" height="${boxSize.toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="${(strokeWidth * 0.6).toFixed(3)}"/>` +
        `<text x="${(lx + boxSize * 1.35).toFixed(2)}" y="${(y + boxSize * 0.82).toFixed(2)}" font-family="monospace" font-size="${fontSize.toFixed(2)}" fill="#e2e8f0">${escapeXml(layer)}</text>`
      );
    });
    legendSvg = `\n  <g id="legend">\n${items.join("\n")}\n  </g>`;
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${vbMinX.toFixed(2)} ${vbMinY.toFixed(2)} ${vbWidth.toFixed(2)} ${vbHeight.toFixed(2)}">`,
    `  <title>${escapeXml(title)}</title>`,
    `  <rect x="${vbMinX.toFixed(2)}" y="${vbMinY.toFixed(2)}" width="${vbWidth.toFixed(2)}" height="${vbHeight.toFixed(2)}" fill="#0b1120"/>`,
    ...layerGroups,
    legendSvg,
    `</svg>`,
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

/**
 * Projects a parsed CIF 2.0 document into a color-coded SVG IC mask layout diagram.
 */
export function cifToSvg(doc: CifDocument, options?: CifToSvgOptions): string {
  const layout = flattenCifLayout(doc, options);
  return layoutToSvg(layout, options);
}
