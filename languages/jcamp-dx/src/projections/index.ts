// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projections from JCAMP-DX spectra to CSV and structured JSON formats.
 */

import { parseJcampDx } from "../parser/jcamp-parser.js";
import type { JcampBlock, JcampDocument } from "../types.js";

function resolveBlock(input: string | JcampDocument | JcampBlock): JcampBlock {
  if (typeof input === "string") {
    const doc = parseJcampDx(input);
    if (!doc.primary) {
      throw new Error("No JCAMP-DX spectrum block found in input.");
    }
    return doc.primary;
  }
  if ("blocks" in input) {
    if (!input.primary) {
      throw new Error("No primary JCAMP-DX spectrum block found in document.");
    }
    return input.primary;
  }
  return input;
}

export interface CsvProjectionOptions {
  delimiter?: string;
  includeHeader?: boolean;
  precision?: number;
}

/**
 * Projects a JCAMP-DX spectrum into CSV format (`x,y`).
 */
export function jcampDxToCsv(input: string | JcampDocument | JcampBlock, options: CsvProjectionOptions = {}): string {
  const block = resolveBlock(input);
  const delimiter = options.delimiter ?? ",";
  const includeHeader = options.includeHeader ?? true;
  const pts = block.points.length > 0 ? block.points : block.peakTable;

  const lines: string[] = [];
  if (includeHeader) {
    const xHeader = (block.xUnits || "X").replace(/,/g, ";");
    const yHeader = (block.yUnits || "Y").replace(/,/g, ";");
    lines.push(`${xHeader}${delimiter}${yHeader}`);
  }
  for (const p of pts) {
    const xStr = options.precision !== undefined ? p.x.toFixed(options.precision) : String(p.x);
    const yStr = options.precision !== undefined ? p.y.toFixed(options.precision) : String(p.y);
    lines.push(`${xStr}${delimiter}${yStr}`);
  }
  return lines.join("\n") + "\n";
}

export interface JcampJsonSpectrum {
  title: string;
  jcampDxVersion: string;
  dataType: string;
  origin?: string;
  owner?: string;
  xUnits?: string;
  yUnits?: string;
  firstX?: number;
  lastX?: number;
  nPoints: number;
  xFactor: number;
  yFactor: number;
  points: Array<{ x: number; y: number }>;
  peakTable: Array<{ x: number; y: number }>;
}

/**
 * Projects a JCAMP-DX spectrum into a structured JSON object (or JSON string when `pretty` is specified).
 */
export function jcampDxToJson(input: string | JcampDocument | JcampBlock): JcampJsonSpectrum {
  const block = resolveBlock(input);
  return {
    title: block.title,
    jcampDxVersion: block.jcampDxVersion,
    dataType: block.dataType,
    ...(block.origin !== undefined ? { origin: block.origin } : {}),
    ...(block.owner !== undefined ? { owner: block.owner } : {}),
    ...(block.xUnits !== undefined ? { xUnits: block.xUnits } : {}),
    ...(block.yUnits !== undefined ? { yUnits: block.yUnits } : {}),
    ...(block.firstX !== undefined ? { firstX: block.firstX } : {}),
    ...(block.lastX !== undefined ? { lastX: block.lastX } : {}),
    nPoints: block.points.length > 0 ? block.points.length : block.peakTable.length,
    xFactor: block.xFactor ?? 1,
    yFactor: block.yFactor ?? 1,
    points: block.points.map((p) => ({ x: p.x, y: p.y })),
    peakTable: block.peakTable.map((p) => ({ x: p.x, y: p.y })),
  };
}
