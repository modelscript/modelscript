// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveAnchorWorldPoint } from "../threads/anchor-projector.js";
import { routeCanvasWire } from "../threads/wire-router.js";
import { TileAdapterRegistry } from "../tiles/registry.js";
import type { CanvasDocument, CanvasWire } from "./canvas-document.js";

function escapeSvg(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const WIRE_STROKE: Record<CanvasWire["kind"], string> = {
  "fmi-signal": "#10b981",
  "shared-parameter": "#38bdf8",
  "requirement-trace": "#a855f7",
  "annotation-link": "#94a3b8",
};

export interface CanvasSvgExportOptions {
  padding?: number | undefined;
  includeLegend?: boolean | undefined;
  registry?: TileAdapterRegistry | undefined;
}

/**
 * Exports a Polyglot Infinite Spatial Canvas document to a standalone,
 * high-DPI vector SVG suitable for design reviews, documentation, and PDF printing.
 */
export function exportCanvasToSvg(doc: CanvasDocument, options: CanvasSvgExportOptions = {}): string {
  const padding = options.padding ?? 48;
  const includeLegend = options.includeLegend ?? true;
  const registry = options.registry ?? new TileAdapterRegistry();

  const frames = Object.values(doc.frames);
  const tiles = Object.values(doc.tiles).sort((a, b) => a.zIndex - b.zIndex);
  const wires = Object.values(doc.wires);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of [...frames, ...tiles]) {
    minX = Math.min(minX, item.bounds.x);
    minY = Math.min(minY, item.bounds.y);
    maxX = Math.max(maxX, item.bounds.x + item.bounds.width);
    maxY = Math.max(maxY, item.bounds.y + item.bounds.height);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const vx = minX - padding;
  const vy = minY - padding - 36;
  const vw = Math.max(320, maxX - minX + padding * 2);
  const vh = Math.max(240, maxY - minY + padding * 2 + 72);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${Math.round(vw)}" height="${Math.round(vh)}">`,
    `  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#0b1120"/>`,
    `  <text x="${vx + 20}" y="${vy + 26}" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="16" font-weight="700">${escapeSvg(doc.name)}</text>`,
  ];

  // 1. Frames
  for (const frame of frames) {
    parts.push(
      `  <g data-frame-id="${escapeSvg(frame.id)}">`,
      `    <rect x="${frame.bounds.x}" y="${frame.bounds.y}" width="${frame.bounds.width}" height="${frame.bounds.height}" rx="12" fill="${escapeSvg(frame.color)}22" stroke="${escapeSvg(frame.color)}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
      `    <text x="${frame.bounds.x + 12}" y="${frame.bounds.y + 20}" fill="#cbd5e1" font-family="system-ui, sans-serif" font-size="12" font-weight="600">${escapeSvg(frame.title)}</text>`,
      `  </g>`,
    );
  }

  // 2. Polyglot Tiles
  for (const tile of tiles) {
    const desc = registry.resolveDescriptor(tile.languageId, tile.artifactUri);
    const { x, y, width, height } = tile.bounds;
    const healthColor =
      tile.health === "error"
        ? "#ef4444"
        : tile.health === "stale" || tile.health === "warning"
          ? "#f59e0b"
          : "#10b981";

    parts.push(
      `  <g data-tile-id="${escapeSvg(tile.id)}">`,
      `    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="#111827" stroke="#334155" stroke-width="1.2"/>`,
      `    <rect x="${x}" y="${y}" width="${width}" height="34" rx="10" fill="#1e293b"/>`,
      `    <line x1="${x}" y1="${y + 34}" x2="${x + width}" y2="${y + 34}" stroke="${escapeSvg(desc.accentColor)}" stroke-width="2"/>`,
      `    <circle cx="${x + 14}" cy="${y + 17}" r="4" fill="${healthColor}"/>`,
      `    <text x="${x + 24}" y="${y + 21}" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="12" font-weight="600">${escapeSvg(tile.title)}</text>`,
      `    <text x="${x + width - 10}" y="${y + 21}" text-anchor="end" fill="${escapeSvg(desc.accentColor)}" font-family="monospace" font-size="10">${escapeSvg(tile.languageId.toUpperCase())}</text>`,
      `    <text x="${x + 12}" y="${y + 54}" fill="#94a3b8" font-family="monospace" font-size="10">${escapeSvg(tile.artifactUri)}</text>`,
    );

    const anchors = (tile.pinnedAnchors ?? []).slice(0, 6);
    anchors.forEach((a, idx) => {
      const rowY = y + 74 + idx * 22;
      if (rowY < y + height - 10) {
        parts.push(
          `    <rect x="${x + 10}" y="${rowY - 12}" width="${width - 20}" height="18" rx="4" fill="#0f172a"/>`,
          `    <text x="${x + 18}" y="${rowY}" fill="#e2e8f0" font-family="system-ui, sans-serif" font-size="10">${escapeSvg(a.label)}</text>`,
          `    <text x="${x + width - 18}" y="${rowY}" text-anchor="end" fill="${escapeSvg(desc.accentColor)}" font-family="monospace" font-size="10">${escapeSvg(a.currentValue ?? a.unit ?? a.kind)}</text>`,
        );
      }
    });

    parts.push(`  </g>`);
  }

  // 3. Visual Threads & FMI Wires
  for (const wire of wires) {
    const srcTile = doc.tiles[wire.source.tileId];
    const dstTile = doc.tiles[wire.target.tileId];
    if (!srcTile || !dstTile) continue;

    const srcPt = resolveAnchorWorldPoint(srcTile, wire.source.anchorPath, { isSource: true, lod: "interactive" });
    const dstPt = resolveAnchorWorldPoint(dstTile, wire.target.anchorPath, { isSource: false, lod: "interactive" });
    const geom = routeCanvasWire(wire, srcPt, dstPt);

    const color =
      wire.status === "conflict"
        ? "#ef4444"
        : wire.status === "stale" || wire.status === "unit-mismatch"
          ? "#f59e0b"
          : WIRE_STROKE[wire.kind];
    const dash = wire.status === "stale" ? ` stroke-dasharray="6 4"` : "";

    parts.push(
      `  <g data-wire-id="${escapeSvg(wire.id)}">`,
      `    <path d="${geom.svgPath}" fill="none" stroke="${color}" stroke-width="${wire.kind === "fmi-signal" ? 2.5 : 2}"${dash}/>`,
      `    <circle cx="${geom.start.x}" cy="${geom.start.y}" r="4" fill="${color}"/>`,
      `    <circle cx="${geom.end.x}" cy="${geom.end.y}" r="4" fill="${color}"/>`,
    );
    if (wire.liveValue) {
      parts.push(
        `    <text x="${geom.labelPoint.x}" y="${geom.labelPoint.y - 6}" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="10">${escapeSvg(wire.liveValue)}</text>`,
      );
    }
    parts.push(`  </g>`);
  }

  // 4. Thread Legend
  if (includeLegend) {
    const ly = vy + vh - 24;
    parts.push(
      `  <g data-role="legend" font-family="system-ui, sans-serif" font-size="11">`,
      `    <circle cx="${vx + 24}" cy="${ly}" r="4" fill="#10b981"/><text x="${vx + 34}" y="${ly + 4}" fill="#cbd5e1">FMI Signal</text>`,
      `    <circle cx="${vx + 124}" cy="${ly}" r="4" fill="#38bdf8"/><text x="${vx + 134}" y="${ly + 4}" fill="#cbd5e1">Shared Parameter</text>`,
      `    <circle cx="${vx + 258}" cy="${ly}" r="4" fill="#a855f7"/><text x="${vx + 268}" y="${ly + 4}" fill="#cbd5e1">Requirement Trace</text>`,
      `    <circle cx="${vx + 394}" cy="${ly}" r="4" fill="#ef4444"/><text x="${vx + 404}" y="${ly + 4}" fill="#cbd5e1">Conflict / Fail</text>`,
      `  </g>`,
    );
  }

  parts.push(`</svg>`);
  return `${parts.join("\n")}\n`;
}
