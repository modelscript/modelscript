// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import { escapeXml } from "../../util/escape.js";
import type { PreprocessContext, PreprocessResult } from "./types.js";

export function buildCsvTelemetrySvg(headers: string[], rows: number[][], fallbackTitle: string): string {
  const width = 680;
  const height = 360;
  const padX = 56;
  const padTop = 68;
  const padBot = 42;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBot;
  const palette = ["#38bdf8", "#34d399", "#f43f5e", "#f59e0b", "#a855f7"];

  const seriesIndices: number[] = [];
  for (let c = 1; c < headers.length && seriesIndices.length < 4; c++) {
    seriesIndices.push(c);
  }
  if (seriesIndices.length === 0 && headers.length > 0) {
    seriesIndices.push(0);
  }

  const polylines: string[] = [];
  const legendItems: string[] = [];

  seriesIndices.forEach((colIdx, sIdx) => {
    const color = palette[sIdx % palette.length]!;
    const vals = rows.map((r) => r[colIdx] ?? 0).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return;
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(1e-6, maxV - minV);
    const pts = vals.map((v, i) => {
      const x = +(padX + (i / Math.max(1, vals.length - 1)) * plotW).toFixed(1);
      const y = +(padTop + plotH - ((v - minV) / span) * plotH).toFixed(1);
      return `${x},${y}`;
    });
    polylines.push(
      `<polyline fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}" />`,
    );
    const label = escapeXml(headers[colIdx] || `col_${colIdx}`);
    const lx = padX + sIdx * 145;
    legendItems.push(
      `<rect x="${lx}" y="${height - 24}" width="10" height="10" rx="2" fill="${color}" /><text x="${lx + 15}" y="${height - 15}" fill="#cbd5e1" font-family="monospace" font-size="10">${label}</text>`,
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
    <text x="24" y="28" fill="#e6edf3" font-family="monospace" font-size="12" font-weight="bold">CSV TELEMETRY // ${escapeXml(fallbackTitle)}</text>
    <text x="24" y="46" fill="#38bdf8" font-family="monospace" font-size="11">Channels: ${headers.length} | Samples: ${rows.length} | Normalized Multi-Trace Overlay</text>
    <rect x="${padX}" y="${padTop}" width="${plotW}" height="${plotH}" rx="4" fill="rgba(15, 23, 42, 0.65)" stroke="#1e293b" stroke-width="1"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.25}" x2="${padX + plotW}" y2="${padTop + plotH * 0.25}" stroke="#1e293b" stroke-dasharray="4 4"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.5}" x2="${padX + plotW}" y2="${padTop + plotH * 0.5}" stroke="#1e293b" stroke-dasharray="4 4"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.75}" x2="${padX + plotW}" y2="${padTop + plotH * 0.75}" stroke="#1e293b" stroke-dasharray="4 4"/>
    ${polylines.join("\n    ")}
    ${legendItems.join("\n    ")}
  </svg>`;
}

export function preprocessTabularArtifact(ctx: PreprocessContext): PreprocessResult {
  const { safeFilePath, originalFilename, baseTitle, content, inlineCode, viewType } = ctx;
  const lowerOrig = originalFilename.toLowerCase();
  let headers: string[] = [];
  let rows: number[][] = [];
  let structuredData: Record<string, unknown>[] | undefined;

  const rawBytes = fs.readFileSync(safeFilePath);
  const isHdf5Binary =
    rawBytes.length >= 8 &&
    rawBytes[0] === 0x89 &&
    rawBytes[1] === 0x48 &&
    rawBytes[2] === 0x44 &&
    rawBytes[3] === 0x46;

  if (isHdf5Binary) {
    const ascii = rawBytes.subarray(8).toString("latin1");
    const symbolNames: string[] = [];
    const identRe = /([a-zA-Z_][a-zA-Z0-9_]{1,31})\0/g;
    let m: RegExpExecArray | null;
    while ((m = identRe.exec(ascii)) !== null) {
      const tok = m[1]!;
      if (!/^(HDF|SNOD|TREE|HEAP|OHDR|GCOL|FRHP|BTHD|BTLF|FHDB|FSHD|OCHK)$/.test(tok) && !symbolNames.includes(tok)) {
        symbolNames.push(tok);
      }
    }
    const dv = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const runs: number[][] = [];
    let cur: number[] = [];
    for (let off = 8; off + 8 <= rawBytes.byteLength; off += 8) {
      const v = dv.getFloat64(off, true);
      if (Number.isFinite(v) && (v === 0 || (Math.abs(v) >= 1e-9 && Math.abs(v) <= 1e9))) {
        cur.push(Number(v.toPrecision(12)));
      } else {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 2) runs.push(cur);
    if (runs.length > 0) {
      headers = symbolNames.length > 0 ? symbolNames.slice(0, runs.length) : runs.map((_, i) => `dataset_${i + 1}`);
      const rowLen = Math.max(...runs.map((r) => r.length));
      for (let rIdx = 0; rIdx < rowLen; rIdx++) {
        rows.push(runs.map((colRun) => colRun[rIdx] ?? 0));
      }
      structuredData = rows.map((r) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          obj[h] = r[i];
        });
        return obj;
      });
    }
  } else if (lowerOrig.endsWith(".json") || content.trim().startsWith("{") || content.trim().startsWith("[")) {
    try {
      const parsedJson = JSON.parse(content);
      const records: Record<string, unknown>[] = Array.isArray(parsedJson)
        ? (parsedJson as Record<string, unknown>[])
        : parsedJson && typeof parsedJson === "object"
          ? (() => {
              const obj = parsedJson as Record<string, unknown>;
              const arrCols = Object.entries(obj).filter(([, v]) => Array.isArray(v));
              if (arrCols.length > 0 && typeof (arrCols[0]![1] as unknown[])[0] === "object") {
                return arrCols[0]![1] as Record<string, unknown>[];
              }
              if (arrCols.length > 0) {
                const len = Math.max(...arrCols.map(([, v]) => (v as unknown[]).length));
                return Array.from({ length: len }, (_, idx) => {
                  const rec: Record<string, unknown> = {};
                  for (const [k, arr] of arrCols) rec[k] = (arr as unknown[])[idx];
                  return rec;
                });
              }
              return [];
            })()
          : [];
      if (records.length > 0) {
        headers = Object.keys(records[0] || {});
        rows = records.map((rec) => headers.map((h) => Number(rec[h] ?? 0)));
        structuredData = records;
      }
    } catch {
      // Fall through to CSV/TSV parser
    }
  }

  if (headers.length === 0) {
    const delimiter = lowerOrig.endsWith(".tsv") || viewType === "tsv" ? "\t" : ",";
    const csvLines = content
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
    headers = (csvLines[0] ?? "")
      .split(delimiter)
      .map((h) => h.trim())
      .filter(Boolean);
    rows = csvLines.slice(1).map((line) => line.split(delimiter).map((c) => Number(c.trim())));
  }

  const svg = buildCsvTelemetrySvg(headers, rows, baseTitle);
  return {
    svg,
    metadata: {
      rowCount: rows.length,
      columnCount: headers.length,
      columns: headers,
    },
    viewConfigAdditions: {
      ...(structuredData
        ? { data: structuredData }
        : inlineCode
          ? { data: inlineCode, code: inlineCode, rawData: inlineCode }
          : {}),
      title: baseTitle,
      rowCount: rows.length,
      columnCount: headers.length,
      columns: headers,
      svg,
    },
  };
}
