// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Projection from IGES 5.3 to SVG 2D Technical Drawing.
 */

import { evaluateIgesDocument, type EvaluateIgesOptions } from "../cad/evaluator.js";
import type { IgesDocument, Point3D } from "../types.js";

export type SvgProjectionView = "xy" | "xz" | "yz" | "iso";

export interface IgesToSvgOptions extends EvaluateIgesOptions {
  view?: SvgProjectionView;
  width?: number;
  height?: number;
  padding?: number;
  strokeColor?: string;
  backgroundColor?: string;
  title?: string;
}

function projectPoint(p: Point3D, view: SvgProjectionView): [number, number] {
  switch (view) {
    case "xy":
      return [p[0], -p[1]];
    case "xz":
      return [p[0], -p[2]];
    case "yz":
      return [p[1], -p[2]];
    case "iso": {
      const cos30 = 0.8660254037844386;
      const sin30 = 0.5;
      const x = (p[0] - p[1]) * cos30;
      const y = -((p[0] + p[1]) * sin30 + p[2]);
      return [x, y];
    }
  }
}

function fmtCoord(n: number): string {
  return Number(n.toFixed(4)).toString();
}

/**
 * Project an IGES 5.3 document into a standalone SVG technical drawing.
 */
export function igesToSvg(input: IgesDocument | string, options: IgesToSvgOptions = {}): string {
  const view = options.view ?? "xy";
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const padding = options.padding ?? 24;
  const strokeColor = options.strokeColor ?? "#38bdf8";
  const backgroundColor = options.backgroundColor ?? "#0f172a";

  const evaluation = evaluateIgesDocument(input, options);

  const projectedPolylines: Array<{ pts: Array<[number, number]>; entityType: number; de: number }> = [];
  const projectedPoints: Array<{ pt: [number, number]; de: number }> = [];
  const projectedTriangles: Array<{ pts: [number, number][]; de: number }> = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const track = ([x, y]: [number, number]): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const ev of evaluation.entities) {
    for (const poly of ev.polylines) {
      if (poly.length === 1) {
        const pt = projectPoint(poly[0]!, view);
        track(pt);
        projectedPoints.push({ pt, de: ev.deNumber });
      } else if (poly.length >= 2) {
        const pts = poly.map((p) => {
          const pp = projectPoint(p, view);
          track(pp);
          return pp;
        });
        projectedPolylines.push({ pts, entityType: ev.entityType, de: ev.deNumber });
      }
    }
    if (ev.mesh) {
      for (const [a, b, c] of ev.mesh.triangles) {
        const pa = projectPoint(ev.mesh.vertices[a]!, view);
        const pb = projectPoint(ev.mesh.vertices[b]!, view);
        const pc = projectPoint(ev.mesh.vertices[c]!, view);
        track(pa);
        track(pb);
        track(pc);
        projectedTriangles.push({ pts: [pa, pb, pc], de: ev.deNumber });
      }
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }

  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = padding + (width - 2 * padding - spanX * scale) * 0.5 - minX * scale;
  const offsetY = padding + (height - 2 * padding - spanY * scale) * 0.5 - minY * scale;

  const mapPt = ([x, y]: [number, number]): [number, number] => [x * scale + offsetX, y * scale + offsetY];

  const elements: string[] = [];
  elements.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${backgroundColor}"/>`);

  if (options.title) {
    elements.push(`<title>${options.title.replace(/[<>&]/g, "")}</title>`);
  }

  for (const tri of projectedTriangles) {
    const ptsAttr = tri.pts
      .map(mapPt)
      .map(([x, y]) => `${fmtCoord(x)},${fmtCoord(y)}`)
      .join(" ");
    elements.push(
      `<polygon data-de="${tri.de}" points="${ptsAttr}" fill="${strokeColor}" fill-opacity="0.14" stroke="${strokeColor}" stroke-width="0.8"/>`,
    );
  }

  for (const pl of projectedPolylines) {
    if (pl.pts.length === 2) {
      const [x1, y1] = mapPt(pl.pts[0]!);
      const [x2, y2] = mapPt(pl.pts[1]!);
      elements.push(
        `<line data-de="${pl.de}" data-type="${pl.entityType}" x1="${fmtCoord(x1)}" y1="${fmtCoord(y1)}" x2="${fmtCoord(x2)}" y2="${fmtCoord(y2)}" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round"/>`,
      );
    } else {
      const ptsAttr = pl.pts
        .map(mapPt)
        .map(([x, y]) => `${fmtCoord(x)},${fmtCoord(y)}`)
        .join(" ");
      elements.push(
        `<polyline data-de="${pl.de}" data-type="${pl.entityType}" points="${ptsAttr}" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  }

  for (const pt of projectedPoints) {
    const [cx, cy] = mapPt(pt.pt);
    elements.push(
      `<circle data-de="${pt.de}" data-type="116" cx="${fmtCoord(cx)}" cy="${fmtCoord(cy)}" r="3" fill="#f97316"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n` +
    elements.map((e) => `  ${e}`).join("\n") +
    `\n</svg>\n`
  );
}
