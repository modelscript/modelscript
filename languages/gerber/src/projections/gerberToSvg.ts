// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SVG Projection for Gerber RS-274-D & RS-274X PCB layers.
 */

import { lowerGerberToGeometry } from "../cad/geometry.js";
import type { GerberDocument, GerberFlashPad } from "../types.js";

export interface GerberSvgOptions {
  /** Padding around bounding box in mm (default: 1.0 mm). */
  paddingMm?: number | undefined;
  /** Dark copper fill/stroke color (default: "#d97706"). */
  copperColor?: string | undefined;
  /** Background / clear-polarity color (default: "#0f172a"). */
  backgroundColor?: string | undefined;
  /** Optional title metadata. */
  title?: string | undefined;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? Number(n.toFixed(4)).toString() : "0";
}

function renderFlashSvg(flash: GerberFlashPad, color: string, bgColor: string): string {
  const cx = flash.center.x;
  const cy = -flash.center.y; // flip Y for SVG (+Y down)
  const parts: string[] = [];

  if (flash.shape === "R") {
    const x = cx - 0.5 * flash.widthMm;
    const y = cy - 0.5 * flash.heightMm;
    parts.push(
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(flash.widthMm)}" height="${fmt(flash.heightMm)}" fill="${color}"/>`,
    );
  } else if (flash.shape === "O") {
    const x = cx - 0.5 * flash.widthMm;
    const y = cy - 0.5 * flash.heightMm;
    const rx = 0.5 * Math.min(flash.widthMm, flash.heightMm);
    parts.push(
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(flash.widthMm)}" height="${fmt(flash.heightMm)}" rx="${fmt(rx)}" ry="${fmt(rx)}" fill="${color}"/>`,
    );
  } else if (flash.shape === "P") {
    const n = Math.max(3, flash.vertices ?? 6);
    const r = 0.5 * flash.widthMm;
    const rotRad = ((flash.rotationDeg ?? 0) * Math.PI) / 180;
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = rotRad + (2 * Math.PI * i) / n;
      const px = cx + r * Math.cos(a);
      const py = cy - r * Math.sin(a);
      pts.push(`${fmt(px)},${fmt(py)}`);
    }
    parts.push(`<polygon points="${pts.join(" ")}" fill="${color}"/>`);
  } else {
    parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(0.5 * flash.widthMm)}" fill="${color}"/>`);
  }

  if (flash.holeDiameterMm > 0) {
    parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(0.5 * flash.holeDiameterMm)}" fill="${bgColor}"/>`);
  }

  return parts.join("\n    ");
}

/**
 * Projects a parsed `GerberDocument` into a standalone SVG string (coordinates in mm).
 */
export function gerberToSvg(doc: GerberDocument, options: GerberSvgOptions = {}): string {
  const geom = lowerGerberToGeometry(doc);
  const pad = options.paddingMm ?? 1.0;
  const copperColor = options.copperColor ?? "#d97706";
  const bgColor = options.backgroundColor ?? "#0f172a";

  const bb = geom.boundingBox;
  const vbX = bb.minX - pad;
  const vbY = -(bb.maxY + pad);
  const vbW = Math.max(1, bb.width + 2 * pad);
  const vbH = Math.max(1, bb.height + 2 * pad);

  const elements: string[] = [];

  // Regions
  for (const reg of geom.regions) {
    const color = reg.polarity === "D" ? copperColor : bgColor;
    const pathParts: string[] = [];
    for (const contour of reg.contours) {
      if (contour.length === 0) continue;
      const first = contour[0]!;
      pathParts.push(`M ${fmt(first.start.x)} ${fmt(-first.start.y)}`);
      for (const seg of contour) {
        if (seg.kind === "LINE") {
          pathParts.push(`L ${fmt(seg.end.x)} ${fmt(-seg.end.y)}`);
        } else if (seg.radius !== undefined && seg.sweepAngleRad !== undefined) {
          const largeArc = seg.sweepAngleRad > Math.PI ? 1 : 0;
          // In SVG Y-down coordinates, CW in Gerber (Y-up) is CCW in SVG (sweepFlag = 1 for CW in Y-up? Let's verify:
          // Y-up CW goes from (1,0)->(0,-1); in Y-down that's (1,0)->(0,1) which is CW in Y-down = sweepFlag 1!
          const sweepFlag = seg.clockwise ? 1 : 0;
          pathParts.push(
            `A ${fmt(seg.radius)} ${fmt(seg.radius)} 0 ${largeArc} ${sweepFlag} ${fmt(seg.end.x)} ${fmt(-seg.end.y)}`,
          );
        }
      }
      pathParts.push("Z");
    }
    if (pathParts.length > 0) {
      elements.push(`    <path d="${pathParts.join(" ")}" fill="${color}" fill-rule="evenodd"/>`);
    }
  }

  // Strokes (lines & arcs)
  for (const s of geom.strokes) {
    const color = s.polarity === "D" ? copperColor : bgColor;
    if (s.kind === "LINE") {
      elements.push(
        `    <line x1="${fmt(s.start.x)}" y1="${fmt(-s.start.y)}" x2="${fmt(s.end.x)}" y2="${fmt(-s.end.y)}" stroke="${color}" stroke-width="${fmt(s.widthMm)}" stroke-linecap="round"/>`,
      );
    } else if (s.center && s.radius !== undefined && s.sweepAngleRad !== undefined) {
      if (s.sweepAngleRad >= 2 * Math.PI - 1e-6) {
        elements.push(
          `    <circle cx="${fmt(s.center.x)}" cy="${fmt(-s.center.y)}" r="${fmt(s.radius)}" fill="none" stroke="${color}" stroke-width="${fmt(s.widthMm)}"/>`,
        );
      } else {
        const largeArc = s.sweepAngleRad > Math.PI ? 1 : 0;
        const sweepFlag = s.clockwise ? 1 : 0;
        elements.push(
          `    <path d="M ${fmt(s.start.x)} ${fmt(-s.start.y)} A ${fmt(s.radius)} ${fmt(s.radius)} 0 ${largeArc} ${sweepFlag} ${fmt(s.end.x)} ${fmt(-s.end.y)}" fill="none" stroke="${color}" stroke-width="${fmt(s.widthMm)}" stroke-linecap="round"/>`,
        );
      }
    }
  }

  // Flashes
  for (const f of geom.flashes) {
    const color = f.polarity === "D" ? copperColor : bgColor;
    elements.push(`    ${renderFlashSvg(f, color, bgColor)}`);
  }

  const titleXml = options.title ? `\n  <title>${options.title}</title>` : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" width="${fmt(vbW)}mm" height="${fmt(vbH)}mm">${titleXml}`,
    `  <rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="${bgColor}"/>`,
    `  <g id="gerber-copper">`,
    ...elements,
    `  </g>`,
    `</svg>`,
    "",
  ].join("\n");
}
