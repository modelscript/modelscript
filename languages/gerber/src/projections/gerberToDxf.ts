// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ASCII AutoCAD DXF Projection for Gerber RS-274-D & RS-274X PCB layers.
 */

import { lowerGerberToGeometry } from "../cad/geometry.js";
import type { GerberDocument } from "../types.js";

export interface GerberDxfOptions {
  /** DXF layer name for copper features (default: "COPPER"). */
  layerName?: string | undefined;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(6) : "0.000000";
}

function radToDeg360(rad: number): number {
  let deg = (rad * 180) / Math.PI;
  deg = deg % 360;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Projects a parsed `GerberDocument` into a standards-compliant ASCII DXF (AC1015 / R2000) string in millimeters.
 */
export function gerberToDxf(doc: GerberDocument, options: GerberDxfOptions = {}): string {
  const geom = lowerGerberToGeometry(doc);
  const layer = options.layerName ?? "COPPER";
  const lines: string[] = [];

  const pair = (code: number, value: string | number): void => {
    lines.push(String(code));
    lines.push(String(value));
  };

  // HEADER section (millimeters: $INSUNITS = 4)
  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1015");
  pair(9, "$INSUNITS");
  pair(70, 4);
  pair(0, "ENDSEC");

  // TABLES section
  pair(0, "SECTION");
  pair(2, "TABLES");
  pair(0, "TABLE");
  pair(2, "LAYER");
  pair(70, 1);
  pair(0, "LAYER");
  pair(2, layer);
  pair(70, 0);
  pair(62, 30);
  pair(6, "CONTINUOUS");
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");

  // ENTITIES section
  pair(0, "SECTION");
  pair(2, "ENTITIES");

  // Strokes -> LINE / ARC / CIRCLE
  for (const s of geom.strokes) {
    if (s.polarity === "C") continue;
    if (s.kind === "LINE") {
      pair(0, "LINE");
      pair(8, layer);
      pair(10, fmt(s.start.x));
      pair(20, fmt(s.start.y));
      pair(30, "0.000000");
      pair(11, fmt(s.end.x));
      pair(21, fmt(s.end.y));
      pair(31, "0.000000");
    } else if (s.center && s.radius !== undefined && s.startAngleRad !== undefined && s.sweepAngleRad !== undefined) {
      if (s.sweepAngleRad >= 2 * Math.PI - 1e-6) {
        pair(0, "CIRCLE");
        pair(8, layer);
        pair(10, fmt(s.center.x));
        pair(20, fmt(s.center.y));
        pair(30, "0.000000");
        pair(40, fmt(s.radius));
      } else {
        // DXF ARC is always counter-clockwise from startAngle (50) to endAngle (51)
        const endAngleRad = s.clockwise ? s.startAngleRad - s.sweepAngleRad : s.startAngleRad + s.sweepAngleRad;
        const dxfStart = s.clockwise ? radToDeg360(endAngleRad) : radToDeg360(s.startAngleRad);
        const dxfEnd = s.clockwise ? radToDeg360(s.startAngleRad) : radToDeg360(endAngleRad);
        pair(0, "ARC");
        pair(8, layer);
        pair(10, fmt(s.center.x));
        pair(20, fmt(s.center.y));
        pair(30, "0.000000");
        pair(40, fmt(s.radius));
        pair(50, fmt(dxfStart));
        pair(51, fmt(dxfEnd));
      }
    }
  }

  // Flashes -> CIRCLE or closed LWPOLYLINE
  for (const f of geom.flashes) {
    if (f.polarity === "C") continue;
    if (f.shape === "R") {
      const x0 = f.center.x - 0.5 * f.widthMm;
      const y0 = f.center.y - 0.5 * f.heightMm;
      const x1 = f.center.x + 0.5 * f.widthMm;
      const y1 = f.center.y + 0.5 * f.heightMm;
      pair(0, "LWPOLYLINE");
      pair(8, layer);
      pair(90, 4);
      pair(70, 1); // closed
      pair(10, fmt(x0));
      pair(20, fmt(y0));
      pair(10, fmt(x1));
      pair(20, fmt(y0));
      pair(10, fmt(x1));
      pair(20, fmt(y1));
      pair(10, fmt(x0));
      pair(20, fmt(y1));
    } else if (f.shape === "P") {
      const n = Math.max(3, f.vertices ?? 6);
      const r = 0.5 * f.widthMm;
      const rotRad = ((f.rotationDeg ?? 0) * Math.PI) / 180;
      pair(0, "LWPOLYLINE");
      pair(8, layer);
      pair(90, n);
      pair(70, 1);
      for (let i = 0; i < n; i++) {
        const a = rotRad + (2 * Math.PI * i) / n;
        pair(10, fmt(f.center.x + r * Math.cos(a)));
        pair(20, fmt(f.center.y + r * Math.sin(a)));
      }
    } else {
      pair(0, "CIRCLE");
      pair(8, layer);
      pair(10, fmt(f.center.x));
      pair(20, fmt(f.center.y));
      pair(30, "0.000000");
      pair(40, fmt(0.5 * f.widthMm));
    }

    if (f.holeDiameterMm > 0) {
      pair(0, "CIRCLE");
      pair(8, layer);
      pair(10, fmt(f.center.x));
      pair(20, fmt(f.center.y));
      pair(30, "0.000000");
      pair(40, fmt(0.5 * f.holeDiameterMm));
    }
  }

  // Regions -> closed LWPOLYLINE contours
  for (const r of geom.regions) {
    if (r.polarity === "C") continue;
    for (const contour of r.contours) {
      if (contour.length === 0) continue;
      pair(0, "LWPOLYLINE");
      pair(8, layer);
      pair(90, contour.length);
      pair(70, 1);
      for (const seg of contour) {
        pair(10, fmt(seg.start.x));
        pair(20, fmt(seg.start.y));
      }
    }
  }

  pair(0, "ENDSEC");
  pair(0, "EOF");

  return lines.join("\n") + "\n";
}
