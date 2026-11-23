// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG PCM Major/Minor Frame Commutator Grid Visualizer for IRIG 106 Chapter 9 TMATS.
 */

import { parseIrig106 } from "../parser/tmats-parser.js";
import { buildCommutatorGrid, type CommutatorGridResult } from "../solver/commutator.js";
import type { TmatsModel } from "../types.js";

export interface CommutatorSvgOptions {
  pcmIndex?: number;
  cellWidth?: number;
  cellHeight?: number;
  maxCols?: number;
  maxRows?: number;
}

const CHANNEL_PALETTE = [
  { fill: "#1d4ed8", stroke: "#60a5fa", text: "#eff6ff" },
  { fill: "#047857", stroke: "#34d399", text: "#ecfdf5" },
  { fill: "#b45309", stroke: "#fbbf24", text: "#fffbeb" },
  { fill: "#6d28d9", stroke: "#c084fc", text: "#f5f3ff" },
  { fill: "#0e7490", stroke: "#22d3ee", text: "#ecfeff" },
  { fill: "#be185d", stroke: "#f472b6", text: "#fdf2f8" },
  { fill: "#4d7c0f", stroke: "#a3e635", text: "#f7fee7" },
  { fill: "#c2410c", stroke: "#fb923c", text: "#fff7ed" },
];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatRate(hz: number): string {
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(2)} kHz`;
  return `${hz.toFixed(2)} Hz`;
}

function formatBitRate(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(3)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(2)} kbps`;
  return `${bps} bps`;
}

/**
 * Renders a deterministic pure SVG PCM Major/Minor Frame Commutator Grid showing
 * sync words, color-coded measurement slots, conflict highlights, and a rate legend.
 */
export function renderIrig106CommutatorSvg(
  modelOrSource: TmatsModel | string | CommutatorGridResult,
  options: CommutatorSvgOptions = {},
): string {
  const grid: CommutatorGridResult =
    typeof modelOrSource === "string"
      ? buildCommutatorGrid(parseIrig106(modelOrSource), options.pcmIndex)
      : "grid" in modelOrSource
        ? modelOrSource
        : buildCommutatorGrid(modelOrSource, options.pcmIndex);

  const cellW = options.cellWidth ?? 96;
  const cellH = options.cellHeight ?? 34;
  const maxCols = options.maxCols ?? 24;
  const maxRows = options.maxRows ?? 16;

  const totalCols = grid.wordsPerMinorFrame + 1; // data words + SYNC column
  const visibleDataCols = Math.min(grid.wordsPerMinorFrame, Math.max(1, maxCols - 1));
  const visibleCols = visibleDataCols + 1;
  const visibleRows = Math.min(Math.max(1, grid.minorFramesPerMajorFrame), maxRows);

  const padLeft = 74;
  const padTop = 76;
  const padRight = 24;
  const legendCols = 3;
  const legendRows = Math.max(1, Math.ceil(grid.schedules.length / legendCols));
  const legendHeight = 36 + legendRows * 22;

  const width = Math.max(540, padLeft + visibleCols * cellW + padRight);
  const height = padTop + visibleRows * cellH + 34 + legendHeight;

  // Deterministic color map per measurement
  const colorMap = new Map<string, (typeof CHANNEL_PALETTE)[number]>();
  grid.schedules.forEach((s, i) => {
    colorMap.set(s.name, CHANNEL_PALETTE[i % CHANNEL_PALETTE.length]!);
  });

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#0f172a" rx="8"/>`);

  // Header
  parts.push(
    `<text x="18" y="26" fill="#f8fafc" font-size="13" font-weight="700">IRIG 106 PCM Commutator — ${escapeXml(grid.dataLinkName)}</text>`,
  );
  const subtitle = `${formatBitRate(grid.bitRateBps)} | ${grid.wordLengthBits}-bit words | Minor: ${formatRate(grid.minorFrameRateHz)} (${grid.wordsPerMinorFrame} words, ${grid.bitsPerMinorFrame} bits) | Major: ${formatRate(grid.majorFrameRateHz)} (${grid.minorFramesPerMajorFrame} frames) | Sync: ${grid.syncPattern || "NONE"}`;
  parts.push(`<text x="18" y="44" fill="#94a3b8" font-size="10">${escapeXml(subtitle)}</text>`);

  // Column headers
  for (let c = 0; c < visibleDataCols; c++) {
    const x = padLeft + c * cellW + cellW / 2;
    parts.push(`<text x="${x}" y="${padTop - 8}" fill="#94a3b8" font-size="10" text-anchor="middle">W${c + 1}</text>`);
  }
  const syncColX = padLeft + visibleDataCols * cellW + cellW / 2;
  parts.push(
    `<text x="${syncColX}" y="${padTop - 8}" fill="#c084fc" font-size="10" font-weight="700" text-anchor="middle">SYNC</text>`,
  );

  // Grid cells
  for (let r = 0; r < visibleRows; r++) {
    const y = padTop + r * cellH;
    parts.push(
      `<text x="${padLeft - 10}" y="${y + cellH / 2 + 4}" fill="#94a3b8" font-size="10" text-anchor="end">MF ${r + 1}</text>`,
    );

    const row = grid.grid[r];
    if (!row) continue;

    // Data word columns
    for (let c = 0; c < visibleDataCols; c++) {
      const cell = row[c];
      const x = padLeft + c * cellW;
      if (!cell || cell.assignments.length === 0) {
        parts.push(
          `<rect x="${x + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="#1e293b" stroke="#334155" stroke-width="1"/>`,
        );
        parts.push(
          `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 3.5}" fill="#475569" font-size="9" text-anchor="middle">—</text>`,
        );
      } else {
        const primary = cell.assignments[0]!;
        const style = cell.hasConflict
          ? { fill: "#7f1d1d", stroke: "#ef4444", text: "#fef2f2" }
          : (colorMap.get(primary.measurementName) ?? CHANNEL_PALETTE[0]!);
        const label =
          cell.assignments.length > 1
            ? `${primary.measurementName.slice(0, 7)}+${cell.assignments.length - 1}`
            : primary.measurementName.slice(0, 11);
        parts.push(
          `<g data-line="${primary.line}">` +
            `<rect x="${x + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${cell.hasConflict ? "2" : "1.2"}"/>` +
            `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 3.5}" fill="${style.text}" font-size="9.5" font-weight="600" text-anchor="middle">${escapeXml(label)}</text>` +
            `</g>`,
        );
      }
    }

    // Sync word column (last entry in row)
    const syncCell = row[row.length - 1];
    const sx = padLeft + visibleDataCols * cellW;
    const syncLabel = grid.syncPattern ? grid.syncPattern.slice(0, 10) : "NO SYNC";
    const syncStroke = grid.syncPattern ? "#a855f7" : "#ef4444";
    const syncFill = grid.syncPattern ? "#3b0764" : "#450a0a";
    parts.push(
      `<g data-line="${syncCell?.assignments[0]?.line ?? 1}">` +
        `<rect x="${sx + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="${syncFill}" stroke="${syncStroke}" stroke-width="1.5"/>` +
        `<text x="${sx + cellW / 2}" y="${y + cellH / 2 + 3.5}" fill="#f3e8ff" font-size="9.5" font-weight="700" text-anchor="middle">${escapeXml(syncLabel)}</text>` +
        `</g>`,
    );
  }

  // Truncation notice if frame exceeds viewport
  if (totalCols > visibleCols || grid.minorFramesPerMajorFrame > visibleRows) {
    parts.push(
      `<text x="${padLeft}" y="${padTop + visibleRows * cellH + 16}" fill="#64748b" font-size="9">Showing ${visibleRows}/${grid.minorFramesPerMajorFrame} minor frames × ${visibleDataCols}/${grid.wordsPerMinorFrame} data words (+ SYNC)</text>`,
    );
  }

  // Legend
  const legendTop = padTop + visibleRows * cellH + 34;
  parts.push(
    `<text x="18" y="${legendTop}" fill="#cbd5e1" font-size="10.5" font-weight="700">Measurement Channels (${grid.schedules.length}) — Utilization: ${grid.utilizationPercent.toFixed(1)}%</text>`,
  );

  const colWidth = Math.floor((width - 36) / legendCols);
  grid.schedules.forEach((sched, idx) => {
    const col = idx % legendCols;
    const rowIdx = Math.floor(idx / legendCols);
    const lx = 18 + col * colWidth;
    const ly = legendTop + 18 + rowIdx * 22;
    const style = colorMap.get(sched.name) ?? CHANNEL_PALETTE[0]!;
    const unitTag = sched.engineeringUnits ? ` [${sched.engineeringUnits}]` : "";
    const text = `${sched.name}: ${formatRate(sched.sampleRateHz)}${unitTag}`;
    parts.push(
      `<rect x="${lx}" y="${ly - 10}" width="11" height="11" rx="2.5" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1"/>` +
        `<text x="${lx + 16}" y="${ly - 1}" fill="#e2e8f0" font-size="9.5">${escapeXml(text)}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}
