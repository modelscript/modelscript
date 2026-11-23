// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG PAL/GAL Fuse-Matrix Grid Renderer (`renderJedecFuseMatrixSvg`).
 *
 * Renders intact (`0` = connected) vs blown (`1` = open) fuse cells across
 * product term rows and input-literal columns, grouped by output macrocell.
 */

import { formatHex16 } from "../parser/checksum.js";
import { extractJedecEquations } from "../solver/boolean-extractor.js";
import { getJedecDeviceProfile, type JedecDeviceProfile } from "../solver/device-profiles.js";
import type { JedecDocument } from "../types.js";

export interface JedecSvgOptions {
  /** Cell size in pixels (default: 12). */
  cellSize?: number | undefined;
  /** Maximum number of product term rows to render (default: all rows up to 132). */
  maxRows?: number | undefined;
  /** Color theme (default: `"dark"`). */
  theme?: "dark" | "light" | undefined;
  /** Optional device profile override. */
  profile?: JedecDeviceProfile | undefined;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Renders a pure, deterministic SVG PAL/GAL fuse-matrix grid for a parsed `JedecDocument`.
 */
export function renderJedecFuseMatrixSvg(doc: JedecDocument, options?: JedecSvgOptions): string {
  const profile = options?.profile ?? getJedecDeviceProfile(doc);
  const extraction = extractJedecEquations(doc, profile);
  const cell = options?.cellSize ?? 12;
  const isLight = options?.theme === "light";

  const rows = Math.min(profile.matrixRows, options?.maxRows ?? 132);
  const cols = profile.matrixCols;

  const palette = isLight
    ? {
        bg: "#f8fafc",
        panel: "#ffffff",
        border: "#cbd5e1",
        text: "#0f172a",
        muted: "#475569",
        intactFill: "#0284c7",
        intactStroke: "#0369a1",
        blownFill: "#e2e8f0",
        blownStroke: "#cbd5e1",
        oeRowTint: "#fef3c7",
        bandDivider: "#94a3b8",
        badgeBg: "#e0f2fe",
        badgeText: "#0369a1",
      }
    : {
        bg: "#0f172a",
        panel: "#1e293b",
        border: "#334155",
        text: "#f8fafc",
        muted: "#94a3b8",
        intactFill: "#38bdf8",
        intactStroke: "#7dd3fc",
        blownFill: "#1e293b",
        blownStroke: "#334155",
        oeRowTint: "#451a03",
        bandDivider: "#475569",
        badgeBg: "#0c4a6e",
        badgeText: "#7dd3fc",
      };

  const marginLeft = 92;
  const marginTop = 76;
  const marginRight = 24;
  const marginBottom = 38;

  const gridWidth = Math.max(cols * cell, 240);
  const gridHeight = Math.max(rows * cell, 120);
  const totalWidth = marginLeft + gridWidth + marginRight;
  const totalHeight = marginTop + gridHeight + marginBottom;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" role="img" aria-label="JEDEC ${escapeXml(profile.deviceName)} Fuse Matrix">`,
  );
  parts.push(`<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="${palette.bg}"/>`);

  // Header bar
  const titleText = `${profile.deviceName} Fuse Matrix (${rows}x${cols})`;
  const statsText = `QF=${doc.fuses.length} | Intact(0)=${extraction.utilization.intactFuses} | Blown(1)=${extraction.utilization.blownFuses} | C=${formatHex16(doc.computedFuseChecksum)}`;
  parts.push(
    `<text x="14" y="22" font-family="monospace" font-size="13" font-weight="bold" fill="${palette.text}">${escapeXml(titleText)}</text>`,
  );
  parts.push(
    `<text x="14" y="38" font-family="monospace" font-size="10" fill="${palette.muted}">${escapeXml(statsText)}</text>`,
  );

  // Column pair headers (pin / true & comp)
  for (const pair of profile.columnPairs) {
    if (pair.trueCol >= cols) continue;
    const xCenter = marginLeft + pair.trueCol * cell + cell;
    parts.push(
      `<text x="${xCenter}" y="${marginTop - 16}" text-anchor="middle" font-family="monospace" font-size="8" font-weight="bold" fill="${palette.text}">${escapeXml(pair.signalName)}</text>`,
    );
    parts.push(
      `<text x="${marginLeft + pair.trueCol * cell + cell / 2}" y="${marginTop - 5}" text-anchor="middle" font-family="monospace" font-size="7" fill="${palette.muted}">T</text>`,
    );
    if (pair.compCol < cols) {
      parts.push(
        `<text x="${marginLeft + pair.compCol * cell + cell / 2}" y="${marginTop - 5}" text-anchor="middle" font-family="monospace" font-size="7" fill="${palette.muted}">C</text>`,
      );
    }
  }

  // Macrocell band labels & OE row tinting
  const oeRowSet = new Set<number>();
  for (const mc of profile.macrocells) {
    if (mc.startRow >= rows) continue;
    const bandY = marginTop + mc.startRow * cell;
    const bandRows = Math.min(mc.rowCount, rows - mc.startRow);
    const bandH = bandRows * cell;

    if (mc.hasOeRow) {
      oeRowSet.add(mc.startRow);
      parts.push(
        `<rect x="${marginLeft}" y="${bandY}" width="${gridWidth}" height="${cell}" fill="${palette.oeRowTint}" fill-opacity="0.45"/>`,
      );
    }

    // Macrocell label on left
    const labelY = bandY + bandH / 2 + 3;
    parts.push(
      `<rect x="10" y="${bandY + 2}" width="44" height="${Math.max(bandH - 4, 10)}" rx="3" fill="${palette.badgeBg}" stroke="${palette.border}" stroke-width="0.8"/>`,
    );
    parts.push(
      `<text x="32" y="${labelY}" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="${palette.badgeText}">${escapeXml(mc.signalName)}</text>`,
    );

    // Band separator line
    if (mc.startRow > 0) {
      parts.push(
        `<line x1="${marginLeft}" y1="${bandY}" x2="${marginLeft + gridWidth}" y2="${bandY}" stroke="${palette.bandDivider}" stroke-width="1.2"/>`,
      );
    }
  }

  // Row index labels and fuse cells
  for (let r = 0; r < rows; r++) {
    const y = marginTop + r * cell;
    const isOe = oeRowSet.has(r);
    const rowLabel = isOe ? `OE` : `PT${r}`;
    parts.push(
      `<text x="${marginLeft - 6}" y="${y + cell - 2}" text-anchor="end" font-family="monospace" font-size="7.5" fill="${isOe ? "#f59e0b" : palette.muted}">${rowLabel}</text>`,
    );

    const baseAddr = r * cols;
    for (let c = 0; c < cols; c++) {
      const addr = baseAddr + c;
      const bit = addr < doc.fuses.length ? (doc.fuses[addr] ?? 0) : 0;
      const x = marginLeft + c * cell;
      if (bit === 0) {
        // Intact fuse (0 = connected): filled dot/square
        parts.push(
          `<rect x="${x + 1.5}" y="${y + 1.5}" width="${cell - 3}" height="${cell - 3}" rx="2" fill="${palette.intactFill}" stroke="${palette.intactStroke}" stroke-width="0.6" data-fuse="${addr}" data-state="0"/>`,
        );
      } else {
        // Blown fuse (1 = open): hollow dim cell
        parts.push(
          `<rect x="${x + 2}" y="${y + 2}" width="${cell - 4}" height="${cell - 4}" rx="1.5" fill="${palette.blownFill}" stroke="${palette.blownStroke}" stroke-width="0.5" data-fuse="${addr}" data-state="1"/>`,
        );
      }
    }
  }

  // Outer matrix frame
  parts.push(
    `<rect x="${marginLeft}" y="${marginTop}" width="${gridWidth}" height="${gridHeight}" fill="none" stroke="${palette.border}" stroke-width="1.2"/>`,
  );

  // Legend at bottom
  const legendY = totalHeight - 16;
  parts.push(
    `<rect x="${marginLeft}" y="${legendY - 8}" width="10" height="10" rx="2" fill="${palette.intactFill}" stroke="${palette.intactStroke}" stroke-width="0.8"/>`,
  );
  parts.push(
    `<text x="${marginLeft + 15}" y="${legendY}" font-family="monospace" font-size="9.5" fill="${palette.text}">Intact Fuse (0 = Connected)</text>`,
  );

  const leg2X = marginLeft + 195;
  parts.push(
    `<rect x="${leg2X}" y="${legendY - 8}" width="10" height="10" rx="1.5" fill="${palette.blownFill}" stroke="${palette.blownStroke}" stroke-width="0.8"/>`,
  );
  parts.push(
    `<text x="${leg2X + 15}" y="${legendY}" font-family="monospace" font-size="9.5" fill="${palette.muted}">Blown Fuse (1 = Open)</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}
