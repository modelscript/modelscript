// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG memory-region layout bar and entry-point diagram generator for Motorola S-Record images.
 */

import { solveSrecMemory } from "../solver/index.js";
import type { SrecFile, SrecMemoryRegion, SrecSolveResult } from "../types.js";

export interface SrecDiagramRegionBox {
  index: number;
  startAddress: number;
  endAddress: number;
  size: number;
  x: number;
  width: number;
  color: string;
  label: string;
  firstLine: number;
}

export interface SrecDiagramData {
  title: string;
  width: number;
  height: number;
  solved: SrecSolveResult;
  boxes: SrecDiagramRegionBox[];
  entryMarkerX?: number | undefined;
}

const REGION_PALETTE = [
  "#38bdf8", // sky
  "#34d399", // emerald
  "#a78bfa", // violet
  "#fb923c", // orange
  "#f472b6", // pink
  "#facc15", // yellow
];

function hexAddr(addr: number, digits: number = 8): string {
  return `0x${(addr >>> 0).toString(16).toUpperCase().padStart(digits, "0")}`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${bytes} B`;
}

/**
 * Computes layout geometry for the Motorola S-Record memory-region bar diagram.
 */
export function buildSrecDiagramData(file: SrecFile): SrecDiagramData {
  const solved = solveSrecMemory(file);
  const width = 760;
  const barX = 40;
  const barW = width - 80;
  const rowHeight = 24;
  const height = Math.max(220, 150 + solved.regions.length * rowHeight);

  const boxes: SrecDiagramRegionBox[] = [];
  const span = Math.max(1, solved.addressSpan);

  if (solved.regions.length > 0) {
    // Proportional mapping with minimum visible width per region
    const addrDigits = solved.maxAddress > 0xffffff ? 8 : solved.maxAddress > 0xffff ? 6 : 4;
    for (let i = 0; i < solved.regions.length; i++) {
      const reg: SrecMemoryRegion = solved.regions[i]!;
      const relStart = (reg.startAddress - solved.minAddress) / span;
      const relSize = reg.size / span;
      const x = barX + relStart * barW;
      const w = Math.max(8, relSize * barW);
      boxes.push({
        index: reg.index,
        startAddress: reg.startAddress,
        endAddress: reg.endAddress,
        size: reg.size,
        x,
        width: Math.min(w, barX + barW - x),
        color: REGION_PALETTE[i % REGION_PALETTE.length]!,
        label: `R${reg.index} ${hexAddr(reg.startAddress, addrDigits)} (${formatSize(reg.size)})`,
        firstLine: reg.firstLine,
      });
    }
  }

  let entryMarkerX: number | undefined;
  if (
    solved.startAddress !== undefined &&
    solved.addressSpan > 0 &&
    solved.startAddress >= solved.minAddress &&
    solved.startAddress <= solved.maxAddress
  ) {
    entryMarkerX = barX + ((solved.startAddress - solved.minAddress) / span) * barW;
  }

  return {
    title: file.headerText || file.name || "Motorola S-Record Image",
    width,
    height,
    solved,
    boxes,
    entryMarkerX,
  };
}

/**
 * Renders a deterministic pure-SVG memory-region layout bar with entry-point indicator and region table.
 */
export function renderSrecMemoryMapSvg(file: SrecFile): string {
  const data = buildSrecDiagramData(file);
  const { width, height, solved, boxes, entryMarkerX } = data;
  const addrDigits = solved.maxAddress > 0xffffff ? 8 : solved.maxAddress > 0xffff ? 6 : 4;
  const barX = 40;
  const barY = 66;
  const barW = width - 80;
  const barH = 38;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#0f172a"/>`,
    `<text x="40" y="28" fill="#f8fafc" font-size="14" font-weight="bold">${escapeXml(data.title)}</text>`,
    `<text x="40" y="46" fill="#94a3b8" font-size="11">` +
      `Regions: ${solved.regions.length}  |  Payload: ${formatSize(solved.totalDataBytes)}  |  ` +
      `Span: ${formatSize(solved.addressSpan)}  |  CRC-32: 0x${(solved.overallCrc32 >>> 0).toString(16).toUpperCase().padStart(8, "0")}` +
      `</text>`,
    // Memory address space track
    `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="4" fill="#1e293b" stroke="#334155" stroke-width="1.2"/>`,
  ];

  // Region blocks
  for (const box of boxes) {
    parts.push(
      `<g data-line="${box.firstLine}">` +
        `<rect x="${box.x.toFixed(1)}" y="${barY + 2}" width="${box.width.toFixed(1)}" height="${barH - 4}" rx="3" fill="${box.color}" fill-opacity="0.85" stroke="#0f172a" stroke-width="1">` +
        `<title>${escapeXml(box.label)}</title>` +
        `</rect>` +
        `</g>`,
    );
  }

  // Min / Max address axis labels
  if (solved.regions.length > 0) {
    parts.push(
      `<text x="${barX}" y="${barY + barH + 15}" fill="#94a3b8" font-size="10">${hexAddr(solved.minAddress, addrDigits)}</text>`,
    );
    parts.push(
      `<text x="${barX + barW}" y="${barY + barH + 15}" text-anchor="end" fill="#94a3b8" font-size="10">${hexAddr(solved.maxAddress, addrDigits)}</text>`,
    );
  } else {
    parts.push(
      `<text x="${width / 2}" y="${barY + 23}" text-anchor="middle" fill="#64748b" font-size="11">No data records (S1/S2/S3)</text>`,
    );
  }

  // Entry-point indicator triangle & label
  if (solved.startAddress !== undefined) {
    const markerX = entryMarkerX ?? barX;
    const epColor = solved.entryPointValid ? "#22c55e" : "#f59e0b";
    parts.push(
      `<polygon points="${markerX.toFixed(1)},${barY - 2} ${(markerX - 5).toFixed(1)},${barY - 10} ${(markerX + 5).toFixed(1)},${barY - 10}" fill="${epColor}"/>`,
    );
    parts.push(
      `<line x1="${markerX.toFixed(1)}" y1="${barY}" x2="${markerX.toFixed(1)}" y2="${barY + barH}" stroke="${epColor}" stroke-width="1.6" stroke-dasharray="3,2"/>`,
    );
    parts.push(
      `<text x="${Math.min(width - 140, Math.max(barX, markerX + 8)).toFixed(1)}" y="${barY - 4}" fill="${epColor}" font-size="10" font-weight="bold">Entry ${hexAddr(solved.startAddress, addrDigits)}</text>`,
    );
  }

  // Legend / Region summary rows
  let rowY = 144;
  for (const box of boxes) {
    const reg = solved.regions[box.index]!;
    const crcHex = (reg.crc32 >>> 0).toString(16).toUpperCase().padStart(8, "0");
    parts.push(
      `<g data-line="${box.firstLine}">` +
        `<rect x="40" y="${rowY - 9}" width="10" height="10" rx="2" fill="${box.color}"/>` +
        `<text x="58" y="${rowY}" fill="#e2e8f0" font-size="11">Region ${box.index}: ${hexAddr(reg.startAddress, addrDigits)} .. ${hexAddr(reg.endAddress, addrDigits)}</text>` +
        `<text x="410" y="${rowY}" fill="#94a3b8" font-size="11">${formatSize(reg.size)} (${reg.recordCount} recs)</text>` +
        `<text x="585" y="${rowY}" fill="#64748b" font-size="11">CRC32 0x${crcHex}</text>` +
        `</g>`,
    );
    rowY += 24;
  }

  parts.push(`</svg>`);
  return parts.join("");
}
