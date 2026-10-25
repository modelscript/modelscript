// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtTableMap } from "../types.js";

/**
 * Parses GT-SUITE tabular performance map data (.dat, .txt, .inp).
 */
export function parseGtTableMap(rawText: string, defaultId = "map1"): GtTableMap {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("//") && !l.startsWith("!"));

  let id = defaultId;
  let type: GtTableMap["type"] = "generic";
  let columnHeaders: string[] = [];
  const data: number[][] = [];

  for (const line of lines) {
    // Check for metadata tags
    if (line.toUpperCase().startsWith("NAME:") || line.toUpperCase().startsWith("ID:")) {
      id = line.split(":")[1]?.trim() ?? id;
      continue;
    }
    if (line.toUpperCase().startsWith("TYPE:")) {
      const rawType = line.split(":")[1]?.trim().toLowerCase();
      if (rawType?.includes("comp")) type = "compressor";
      else if (rawType?.includes("turb")) type = "turbine";
      else if (rawType?.includes("valve") || rawType?.includes("lift")) type = "valve_lift";
      else if (rawType?.includes("mfb") || rawType?.includes("burn")) type = "mfb_burn";
      continue;
    }
    if (line.toUpperCase().startsWith("COLUMNS:") || line.toUpperCase().startsWith("HEADERS:")) {
      columnHeaders =
        line
          .split(":")[1]
          ?.split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0) ?? [];
      continue;
    }

    // Number rows
    const parts = line
      .split(/[,\s\t]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const numericParts = parts.map(Number);
    if (numericParts.every((n) => !Number.isNaN(n))) {
      data.push(numericParts);
    } else if (columnHeaders.length === 0 && parts.some((p) => Number.isNaN(Number(p)))) {
      // Treat non-numeric row as headers
      columnHeaders = parts;
    }
  }

  // Detect type from headers if not explicitly given
  if (type === "generic" && columnHeaders.length > 0) {
    const hStr = columnHeaders.join(" ").toLowerCase();
    if (hStr.includes("pr") || hStr.includes("speed") || hStr.includes("flow")) {
      type = "compressor";
    } else if (hStr.includes("crank") || hStr.includes("lift")) {
      type = "valve_lift";
    } else if (hStr.includes("burn") || hStr.includes("mfb")) {
      type = "mfb_burn";
    }
  }

  return {
    id,
    type,
    columnHeaders,
    data,
  };
}

/**
 * Bilinear / 1D lookup and interpolation helper on tabular map data.
 */
export function interpolateMap1D(data: number[][], xVal: number, xCol = 0, yCol = 1): number {
  if (data.length === 0) return 0;
  if (data.length === 1) return data[0]![yCol] ?? 0;

  // Clamp left
  if (xVal <= data[0]![xCol]!) return data[0]![yCol]!;
  // Clamp right
  const last = data[data.length - 1]!;
  if (xVal >= last[xCol]!) return last[yCol]!;

  // Search interval
  for (let i = 0; i < data.length - 1; i++) {
    const x0 = data[i]![xCol]!;
    const x1 = data[i + 1]![xCol]!;
    if (xVal >= x0 && xVal <= x1) {
      const y0 = data[i]![yCol]!;
      const y1 = data[i + 1]![yCol]!;
      const alpha = (xVal - x0) / (x1 - x0 + 1e-12);
      return y0 + alpha * (y1 - y0);
    }
  }

  return last[yCol]!;
}
