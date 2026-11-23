// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  analyzeDxfGeometry,
  arcSweepRadians,
  evaluateBulgeArc,
  evaluateSplinePoints,
  sampleEllipsePoints,
} from "../cad/geometry.js";
import type { DxfDocument, DxfEntity } from "../types.js";

/** Standard AutoCAD Color Index (ACI) hex palette for primary engineering indices. */
const ACI_HEX: Record<number, string> = {
  1: "#ef4444", // Red
  2: "#eab308", // Yellow
  3: "#22c55e", // Green
  4: "#06b6d4", // Cyan
  5: "#3b82f6", // Blue
  6: "#d946ef", // Magenta
  7: "#e2e8f0", // White / Light Slate
  8: "#64748b", // Dark Gray
  9: "#94a3b8", // Light Gray
  30: "#f97316", // Orange
};

function resolveStrokeColor(ent: DxfEntity, doc: DxfDocument, defaultColor: string): string {
  const aci = ent.color && ent.color !== 256 ? ent.color : doc.layers.get(ent.layer)?.color;
  if (aci && ACI_HEX[aci]) return ACI_HEX[aci]!;
  return defaultColor;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? Number(n.toFixed(4)).toString() : "0";
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface DxfToSvgOptions {
  padding?: number | undefined;
  strokeWidth?: number | undefined;
  background?: string | undefined;
  defaultColor?: string | undefined;
}

/**
 * Projects a parsed {@link DxfDocument} (with `INSERT` blocks expanded) into a standalone SVG string.
 */
export function dxfToSvg(doc: DxfDocument, options: DxfToSvgOptions = {}): string {
  const report = analyzeDxfGeometry(doc);
  const bb = report.boundingBox;
  const width = Math.max(1, bb.maxX - bb.minX);
  const height = Math.max(1, bb.maxY - bb.minY);
  const pad = options.padding ?? Math.max(width, height) * 0.05;
  const strokeWidth = options.strokeWidth ?? Math.max(width, height) * 0.004;
  const defaultColor = options.defaultColor ?? "#e2e8f0";
  const bg = options.background ?? "#0f172a";

  const vbX = bb.minX - pad;
  const vbY = -(bb.maxY + pad);
  const vbW = width + pad * 2;
  const vbH = height + pad * 2;

  // Group entities by layer
  const byLayer = new Map<string, DxfEntity[]>();
  for (const ent of report.flatEntities) {
    const arr = byLayer.get(ent.layer) ?? [];
    arr.push(ent);
    byLayer.set(ent.layer, arr);
  }

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" width="800" height="600">`,
  );
  lines.push(`  <rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="${bg}"/>`);

  for (const [layerName, ents] of byLayer) {
    lines.push(
      `  <g data-layer="${escapeXml(layerName)}" fill="none" stroke-width="${fmt(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const ent of ents) {
      const stroke = resolveStrokeColor(ent, doc, defaultColor);
      switch (ent.type) {
        case "LINE":
          lines.push(
            `    <line x1="${fmt(ent.start.x)}" y1="${fmt(-ent.start.y)}" x2="${fmt(ent.end.x)}" y2="${fmt(-ent.end.y)}" stroke="${stroke}"/>`,
          );
          break;

        case "CIRCLE":
          lines.push(
            `    <circle cx="${fmt(ent.center.x)}" cy="${fmt(-ent.center.y)}" r="${fmt(ent.radius)}" stroke="${stroke}"/>`,
          );
          break;

        case "ARC": {
          const sRad = (ent.startAngle * Math.PI) / 180;
          const sweep = arcSweepRadians(ent.startAngle, ent.endAngle);
          const eRad = sRad + sweep;
          const x1 = ent.center.x + ent.radius * Math.cos(sRad);
          const y1 = ent.center.y + ent.radius * Math.sin(sRad);
          const x2 = ent.center.x + ent.radius * Math.cos(eRad);
          const y2 = ent.center.y + ent.radius * Math.sin(eRad);
          const largeArc = sweep > Math.PI ? 1 : 0;
          // Y is flipped in SVG, so CCW in DXF is sweep-flag=0 in SVG
          lines.push(
            `    <path d="M ${fmt(x1)} ${fmt(-y1)} A ${fmt(ent.radius)} ${fmt(ent.radius)} 0 ${largeArc} 0 ${fmt(x2)} ${fmt(-y2)}" stroke="${stroke}"/>`,
          );
          break;
        }

        case "LWPOLYLINE": {
          if (ent.vertices.length < 2) break;
          const n = ent.vertices.length;
          const segs = ent.closed ? n : n - 1;
          const first = ent.vertices[0]!;
          const parts: string[] = [`M ${fmt(first.x)} ${fmt(-first.y)}`];
          for (let i = 0; i < segs; i++) {
            const p1 = ent.vertices[i]!;
            const p2 = ent.vertices[(i + 1) % n]!;
            const arc = evaluateBulgeArc(p1, p2, p1.bulge);
            if (arc) {
              const largeArc = Math.abs(arc.sweepAngle) > Math.PI ? 1 : 0;
              const sweepFlag = arc.sweepAngle > 0 ? 0 : 1;
              parts.push(
                `A ${fmt(arc.radius)} ${fmt(arc.radius)} 0 ${largeArc} ${sweepFlag} ${fmt(p2.x)} ${fmt(-p2.y)}`,
              );
            } else {
              parts.push(`L ${fmt(p2.x)} ${fmt(-p2.y)}`);
            }
          }
          if (ent.closed) parts.push("Z");
          lines.push(`    <path d="${parts.join(" ")}" stroke="${stroke}"/>`);
          break;
        }

        case "POLYLINE": {
          if (ent.vertices.length < 2) break;
          const pts = ent.vertices.map((v) => `${fmt(v.x)},${fmt(-v.y)}`).join(" ");
          const tag = ent.closed ? "polygon" : "polyline";
          lines.push(`    <${tag} points="${pts}" stroke="${stroke}"/>`);
          break;
        }

        case "ELLIPSE": {
          const pts = sampleEllipsePoints(ent, 48);
          if (pts.length < 2) break;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(-p.y)}`).join(" ");
          lines.push(`    <path d="${d}" stroke="${stroke}"/>`);
          break;
        }

        case "SPLINE": {
          const pts = evaluateSplinePoints(ent, 48);
          if (pts.length < 2) break;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(-p.y)}`).join(" ");
          lines.push(`    <path d="${d}" stroke="${stroke}"/>`);
          break;
        }

        case "3DFACE": {
          const pts = ent.vertices.map((v) => `${fmt(v.x)},${fmt(-v.y)}`).join(" ");
          lines.push(`    <polygon points="${pts}" stroke="${stroke}" fill="${stroke}" fill-opacity="0.15"/>`);
          break;
        }

        case "POINT":
          lines.push(
            `    <circle cx="${fmt(ent.position.x)}" cy="${fmt(-ent.position.y)}" r="${fmt(strokeWidth * 1.5)}" fill="${stroke}" stroke="none"/>`,
          );
          break;

        case "TEXT":
        case "MTEXT":
          lines.push(
            `    <text x="${fmt(ent.position.x)}" y="${fmt(-ent.position.y)}" fill="${stroke}" font-size="${fmt(ent.height)}" stroke="none">${escapeXml(ent.text)}</text>`,
          );
          break;

        default:
          break;
      }
    }
    lines.push("  </g>");
  }

  lines.push("</svg>");
  return lines.join("\n") + "\n";
}
