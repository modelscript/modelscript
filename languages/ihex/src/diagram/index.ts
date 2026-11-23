// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG Memory-Map Segment Layout Bar & Address-Range Diagram for `@modelscript/ihex`.
 */

import { hexDword } from "../parser/index.js";
import { solveIhexImage, type IhexSolveOptions } from "../solver/index.js";
import type { IhexModel } from "../types.js";

const SEGMENT_PALETTE = ["#38bdf8", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#2dd4bf", "#60a5fa"];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KiB`;
  return `${n} B`;
}

export interface IhexDiagramOptions extends IhexSolveOptions {
  width?: number | undefined;
  title?: string | undefined;
}

/**
 * Renders a pure vector SVG memory-map diagram showing:
 * - Proportional address-space segment layout bar with gap indicators
 * - Entry-point marker (`03` CS:IP or `05` EIP)
 * - Detailed address-range bars per segment with CRC-32 & byte-size badges
 */
export function renderIhexMemoryMapSvg(model: IhexModel, options: IhexDiagramOptions = {}): string {
  const solved = solveIhexImage(model, options);
  const map = solved.memoryMap;
  const width = Math.max(520, options.width ?? 760);
  const padX = 28;
  const barW = width - padX * 2;
  const title = options.title ?? `${model.name} (${model.format})`;

  const segRows = Math.min(map.segments.length, 16);
  const rowH = 34;
  const headerH = 64;
  const overviewH = 92;
  const footerH = 44;
  const height = headerH + overviewH + Math.max(1, segRows) * rowH + footerH + 24;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#0f172a" />`);

  // Header
  parts.push(`<text x="${padX}" y="28" fill="#f8fafc" font-size="14" font-weight="700">${escapeXml(title)}</text>`);
  parts.push(
    `<text x="${padX}" y="48" fill="#94a3b8" font-size="11">` +
      `Data: ${formatBytes(map.totalDataBytes)} · Segments: ${map.segments.length} · ` +
      `CRC-32: 0x${hexDword(solved.imageCrc32)} · Fletcher-16: 0x${solved.imageFletcher16.toString(16).toUpperCase().padStart(4, "0")} · ` +
      `Flash Util: ${(solved.flashUtilization * 100).toFixed(1)}%` +
      `</text>`,
  );

  // Overview bar
  const barY = headerH + 14;
  const barH = 34;
  parts.push(
    `<text x="${padX}" y="${barY - 4}" fill="#cbd5e1" font-size="10" font-weight="600">ADDRESS SPACE MAP</text>`,
  );
  parts.push(
    `<rect x="${padX}" y="${barY}" width="${barW}" height="${barH}" rx="4" fill="#1e293b" stroke="#334155" stroke-width="1" />`,
  );

  if (map.segments.length === 0) {
    parts.push(
      `<text x="${width / 2}" y="${barY + 21}" text-anchor="middle" fill="#64748b" font-size="11">No data records in Intel HEX image</text>`,
    );
  } else {
    const span = Math.max(1, map.totalSpanBytes);
    for (let i = 0; i < map.segments.length; i++) {
      const seg = map.segments[i]!;
      const color = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]!;
      const relX = (seg.startAddress - map.minAddress) / span;
      const relW = seg.length / span;
      const rx = padX + relX * barW;
      const rw = Math.max(4, relW * barW);
      const clampedW = Math.min(rw, padX + barW - rx);

      parts.push(
        `<g data-line="${seg.startLine}">` +
          `<rect x="${rx.toFixed(2)}" y="${barY + 2}" width="${clampedW.toFixed(2)}" height="${barH - 4}" rx="3" fill="${color}" fill-opacity="0.88" stroke="#0f172a" stroke-width="1">` +
          `<title>SEG #${seg.index}: 0x${hexDword(seg.startAddress)}..0x${hexDword(seg.endAddress)} (${seg.length} B, CRC32 0x${hexDword(seg.crc32)})</title>` +
          `</rect>` +
          `</g>`,
      );
    }

    // Entry point marker if present
    const entryAddr =
      model.startLinearAddress ??
      (model.startSegmentAddress !== undefined
        ? ((model.startSegmentAddress.cs << 4) + model.startSegmentAddress.ip) >>> 0
        : undefined);
    if (entryAddr !== undefined && entryAddr >= map.minAddress && entryAddr <= map.maxAddress) {
      const ex = padX + ((entryAddr - map.minAddress) / span) * barW;
      parts.push(
        `<line x1="${ex.toFixed(2)}" y1="${barY - 4}" x2="${ex.toFixed(2)}" y2="${barY + barH + 4}" stroke="#f43f5e" stroke-width="2" />`,
      );
      parts.push(
        `<text x="${Math.min(width - 96, Math.max(padX, ex + 4)).toFixed(1)}" y="${barY + barH + 16}" fill="#fda4af" font-size="9.5">ENTRY 0x${hexDword(entryAddr)}</text>`,
      );
    }

    // Min / Max address ticks
    parts.push(
      `<text x="${padX}" y="${barY + barH + 16}" fill="#94a3b8" font-size="10">0x${hexDword(map.minAddress)}</text>`,
    );
    parts.push(
      `<text x="${padX + barW}" y="${barY + barH + 16}" text-anchor="end" fill="#94a3b8" font-size="10">0x${hexDword(map.maxAddress)}</text>`,
    );
  }

  // Per-segment breakdown rows
  const listTop = headerH + overviewH;
  parts.push(
    `<text x="${padX}" y="${listTop - 6}" fill="#cbd5e1" font-size="10" font-weight="600">MEMORY SEGMENTS (${map.segments.length})</text>`,
  );

  for (let i = 0; i < segRows; i++) {
    const seg = map.segments[i]!;
    const y = listTop + i * rowH;
    const color = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]!;
    const pct = map.totalDataBytes > 0 ? (seg.length / map.totalDataBytes) * 100 : 0;

    parts.push(`<g data-line="${seg.startLine}">`);
    parts.push(
      `<rect x="${padX}" y="${y}" width="${barW}" height="${rowH - 6}" rx="4" fill="#1e293b" stroke="#334155" stroke-width="1" />`,
    );
    parts.push(`<rect x="${padX}" y="${y}" width="6" height="${rowH - 6}" rx="2" fill="${color}" />`);
    parts.push(
      `<text x="${padX + 16}" y="${y + 18}" fill="#f1f5f9" font-size="11" font-weight="600">SEG ${seg.index}</text>`,
    );
    parts.push(
      `<text x="${padX + 76}" y="${y + 18}" fill="#38bdf8" font-size="11">0x${hexDword(seg.startAddress)} – 0x${hexDword(seg.endAddress)}</text>`,
    );
    parts.push(
      `<text x="${padX + 278}" y="${y + 18}" fill="#cbd5e1" font-size="10.5">${formatBytes(seg.length)} (${pct.toFixed(1)}%)</text>`,
    );
    parts.push(
      `<text x="${padX + barW - 12}" y="${y + 18}" text-anchor="end" fill="#94a3b8" font-size="10">CRC32: 0x${hexDword(seg.crc32)} · ${seg.recordCount} recs</text>`,
    );
    parts.push(`</g>`);
  }

  // Footer
  const footerY = height - 16;
  parts.push(
    `<text x="${padX}" y="${footerY}" fill="#64748b" font-size="10">` +
      `Fill: 0x${map.fillByte.toString(16).toUpperCase().padStart(2, "0")} · ` +
      `Gap: ${formatBytes(map.totalGapBytes)} · ` +
      `Records: ${solved.validChecksumCount}/${solved.recordCount} valid` +
      `</text>`,
  );
  parts.push(`</svg>`);

  return parts.join("\n");
}
