// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Projection to RFC-4180 CSV time-series table.
 */

import { cdfEpochToIso, parseTimeValueToCdfEpoch } from "../solver/epoch.js";
import type { CdfDocument } from "../types.js";

function csvCell(val: string | number): string {
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Projects a `CdfDocument`'s time-series variables to RFC-4180 CSV.
 * Vector variables (e.g. `B_GSE` with dim `[3]`) are expanded into `_0`, `_1`, `_2` columns,
 * and `CDF_EPOCH`/`CDF_TIME_TT2000` timestamps are formatted as ISO-8601 UTC strings.
 */
export function nasaCdfToCsv(doc: CdfDocument): string {
  const headers: string[] = [];
  const columnExtractors: Array<(rowIdx: number) => string | number> = [];

  for (const v of doc.variables) {
    const isVec = (v.numDims === 1 && (v.dimSizes[0] ?? 0) > 1) || v.values.some((r) => Array.isArray(r));
    if (isVec) {
      const width = v.dimSizes[0] ?? (Array.isArray(v.values[0]) ? v.values[0].length : 1);
      for (let c = 0; c < width; c++) {
        headers.push(`${v.name}_${c}`);
        columnExtractors.push((rowIdx) => {
          const rec = v.values[rowIdx];
          if (Array.isArray(rec)) return rec[c] ?? "";
          return c === 0 ? (rec ?? "") : "";
        });
      }
    } else {
      headers.push(v.name);
      const isTime = v.dataType === "CDF_EPOCH" || v.dataType === "CDF_TIME_TT2000";
      columnExtractors.push((rowIdx) => {
        const rec = v.values[rowIdx];
        if (rec === undefined) return "";
        if (isTime && (typeof rec === "number" || typeof rec === "string")) {
          const ms = parseTimeValueToCdfEpoch(rec, v.dataType);
          return ms !== undefined ? cdfEpochToIso(ms) : String(rec);
        }
        return Array.isArray(rec) ? rec.join(" ") : rec;
      });
    }
  }

  const maxRows = Math.max(0, ...doc.variables.map((v) => v.values.length));
  const lines: string[] = [headers.map(csvCell).join(",")];

  for (let r = 0; r < maxRows; r++) {
    lines.push(columnExtractors.map((fn) => csvCell(fn(r))).join(","));
  }
  return lines.join("\n") + "\n";
}
