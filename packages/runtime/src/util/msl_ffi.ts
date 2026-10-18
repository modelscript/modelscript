// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Portable pure-TypeScript implementations of Modelica Standard Library (MSL)
 * C external utility functions:
 *   - ModelicaStrings_* (string operations, parsing, scanning)
 *   - ModelicaStandardTables_* (1D/2D table interpolation, CombiTimeTable)
 *   - ModelicaIO_* (stream formatting and logging stubs)
 *
 * Allows full browser, Node, and WebAssembly execution of MSL models without native C toolchains.
 */

interface Table1DEntry {
  tableName: string;
  fileName: string;
  table: number[][];
  smoothness: number;
}

interface Table2DEntry {
  tableName: string;
  fileName: string;
  table: number[][];
  smoothness: number;
}

interface TimeTableEntry {
  fileName: string;
  tableName: string;
  table: number[][];
  startTime: number;
  columns: number[];
  smoothness: number;
  extrapolation: number;
  shiftTime: number;
}

const table1DStore = new Map<number, Table1DEntry>();
const table2DStore = new Map<number, Table2DEntry>();
const timeTableStore = new Map<number, TimeTableEntry>();
const ioMatrixStore = new Map<string, number[][]>();
let nextHandleId = 1;

/** Interpolation on 1D table: x is col 0, y is col colIdx (1-based) */
function interpolate1D(table: number[][], colIdx: number, u: number, smoothness = 1, extrapolation = 1): number {
  if (!table || table.length === 0) return 0.0;
  const n = table.length;
  if (n === 1) return table[0]![colIdx] ?? 0.0;

  const xMin = table[0]![0]!;
  const xMax = table[n - 1]![0]!;
  let uEff = u;

  if (extrapolation === 3 && xMax - xMin > 1e-15) {
    // Periodic extrapolation
    const period = xMax - xMin;
    uEff = xMin + ((((u - xMin) % period) + period) % period);
  } else if (u <= xMin) {
    if (extrapolation === 2 && n >= 2) {
      // Linear extrapolation through first two points
      const x0 = table[0]![0]!;
      const x1 = table[1]![0]!;
      const y0 = table[0]![colIdx] ?? 0.0;
      const y1 = table[1]![colIdx] ?? 0.0;
      if (smoothness === 2 || Math.abs(x1 - x0) < 1e-15) return y0;
      return y0 + ((u - x0) / (x1 - x0)) * (y1 - y0);
    }
    return table[0]![colIdx] ?? 0.0;
  } else if (u >= xMax) {
    if (extrapolation === 2 && n >= 2) {
      // Linear extrapolation through last two points
      const x0 = table[n - 2]![0]!;
      const x1 = table[n - 1]![0]!;
      const y0 = table[n - 2]![colIdx] ?? 0.0;
      const y1 = table[n - 1]![colIdx] ?? 0.0;
      if (smoothness === 2 || Math.abs(x1 - x0) < 1e-15) return y1;
      return y0 + ((u - x0) / (x1 - x0)) * (y1 - y0);
    }
    return table[n - 1]![colIdx] ?? 0.0;
  }

  // Binary search interval
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]![0]! <= uEff) lo = mid;
    else hi = mid;
  }

  const x0 = table[lo]![0]!;
  const x1 = table[hi]![0]!;
  const y0 = table[lo]![colIdx] ?? 0.0;
  const y1 = table[hi]![colIdx] ?? 0.0;

  // Smoothness.ConstantSegments === 2
  if (smoothness === 2 || Math.abs(x1 - x0) < 1e-15) return y0;
  const t = (uEff - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

const MSL_C_NAME_MAP: Record<string, string> = {
  "Modelica.Utilities.Strings.length": "ModelicaStrings_length",
  "Modelica.Utilities.Strings.compare": "ModelicaStrings_compare",
  "Modelica.Utilities.Strings.Advanced.skipWhiteSpace": "ModelicaStrings_skipWhiteSpace",
  "Modelica.Utilities.Strings.Advanced.scanReal": "ModelicaStrings_scanReal",
  "Modelica.Utilities.Strings.Advanced.scanInteger": "ModelicaStrings_scanInteger",
  "Modelica.Utilities.Strings.Advanced.scanString": "ModelicaStrings_scanString",
};

/** Check if a function name belongs to the MSL C FFI utility suite. */
export function isMslCFunction(funcName: string): boolean {
  if (MSL_C_NAME_MAP[funcName]) return true;
  return (
    funcName.startsWith("ModelicaStrings_") ||
    funcName.startsWith("ModelicaStandardTables_") ||
    funcName.startsWith("ModelicaIO_")
  );
}

/** Evaluate an MSL C FFI function with concrete argument values. */
export function evaluateMslCFunction(funcName: string, args: any[]): any {
  const resolvedName = MSL_C_NAME_MAP[funcName] ?? funcName;
  switch (resolvedName) {
    // ── ModelicaStrings ──
    case "ModelicaStrings_length": {
      const str = String(args[0] ?? "");
      return str.length;
    }
    case "ModelicaStrings_compare": {
      const s1 = String(args[0] ?? "");
      const s2 = String(args[1] ?? "");
      const caseSensitive = Boolean(args[2] ?? true);
      const cmp1 = caseSensitive ? s1 : s1.toLowerCase();
      const cmp2 = caseSensitive ? s2 : s2.toLowerCase();
      return cmp1 < cmp2 ? 1 : cmp1 > cmp2 ? 3 : 2; // Modelica convention: 1 (s1<s2), 2 (equal), 3 (s1>s2)
    }
    case "ModelicaStrings_skipWhiteSpace": {
      const str = String(args[0] ?? "");
      const startIndex = Math.max(1, Number(args[1] ?? 1)) - 1; // 1-based to 0-based
      let idx = startIndex;
      while (idx < str.length && /\s/.test(str[idx]!)) {
        idx++;
      }
      return idx + 1; // Return 1-based
    }
    case "ModelicaStrings_scanReal": {
      const str = String(args[0] ?? "");
      const startIndex = Math.max(1, Number(args[1] ?? 1)) - 1;
      const sub = str.substring(startIndex);
      const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(sub);
      if (match) {
        const val = parseFloat(match[1]!);
        const nextIdx = startIndex + match[1]!.length + 1;
        return [nextIdx, val];
      }
      return [startIndex + 1, 0.0];
    }
    case "ModelicaStrings_scanInteger": {
      const str = String(args[0] ?? "");
      const startIndex = Math.max(1, Number(args[1] ?? 1)) - 1;
      const sub = str.substring(startIndex);
      const match = /^([+-]?\d+)/.exec(sub);
      if (match) {
        const val = parseInt(match[1]!, 10);
        const nextIdx = startIndex + match[1]!.length + 1;
        return [nextIdx, val];
      }
      return [startIndex + 1, 0];
    }
    case "ModelicaStrings_scanString": {
      const str = String(args[0] ?? "");
      const startIndex = Math.max(1, Number(args[1] ?? 1)) - 1;
      const sub = str.substring(startIndex);
      const match = /^"((?:[^"\\]|\\.)*)"/.exec(sub);
      if (match) {
        const val = match[1]!;
        const nextIdx = startIndex + match[0]!.length + 1;
        return [nextIdx, val];
      }
      return [startIndex + 1, ""];
    }

    // ── ModelicaStandardTables (CombiTable1D) ──
    case "ModelicaStandardTables_CombiTable1D_init":
    case "ModelicaStandardTables_CombiTable1D_init2": {
      const handle = nextHandleId++;
      const tableName = String(args[0] ?? "");
      const fileName = String(args[1] ?? "");
      const table = Array.isArray(args[2]) ? args[2] : [];
      const smoothness = Number(args[5] ?? 1);
      table1DStore.set(handle, { tableName, fileName, table, smoothness });
      return handle;
    }
    case "ModelicaStandardTables_CombiTable1D_getValue": {
      const handle = Number(args[0] ?? 0);
      const icol = Number(args[1] ?? 1);
      const u = Number(args[2] ?? 0.0);
      const entry = table1DStore.get(handle);
      if (!entry) return 0.0;
      return interpolate1D(entry.table, icol, u, entry.smoothness, 1);
    }
    case "ModelicaStandardTables_CombiTable1D_close": {
      const handle = Number(args[0] ?? 0);
      table1DStore.delete(handle);
      return 0;
    }

    // ── ModelicaStandardTables (CombiTimeTable) ──
    case "ModelicaStandardTables_CombiTimeTable_init":
    case "ModelicaStandardTables_CombiTimeTable_init2": {
      const handle = nextHandleId++;
      const fileName = String(args[0] ?? "");
      const tableName = String(args[1] ?? "");
      const table = Array.isArray(args[2]) ? args[2] : [];
      const startTime = Number(args[5] ?? 0.0);
      const columns = Array.isArray(args[6]) ? args[6] : [1];
      const smoothness = Number(args[8] ?? 1);
      const extrapolation = Number(args[9] ?? 1);
      const shiftTime = Number(args[10] ?? 0.0);
      timeTableStore.set(handle, {
        fileName,
        tableName,
        table,
        startTime,
        columns,
        smoothness,
        extrapolation,
        shiftTime,
      });
      return handle;
    }
    case "ModelicaStandardTables_CombiTimeTable_getValue": {
      const handle = Number(args[0] ?? 0);
      const icol = Number(args[1] ?? 1);
      const timeIn = Number(args[2] ?? 0.0);
      const entry = timeTableStore.get(handle);
      if (!entry) return 0.0;
      const effectiveTime = timeIn - entry.shiftTime;
      return interpolate1D(entry.table, icol, effectiveTime, entry.smoothness, entry.extrapolation);
    }
    case "ModelicaStandardTables_CombiTimeTable_minimumTime": {
      const handle = Number(args[0] ?? 0);
      const entry = timeTableStore.get(handle);
      if (!entry || entry.table.length === 0) return 0.0;
      return entry.table[0]![0]! + entry.shiftTime;
    }
    case "ModelicaStandardTables_CombiTimeTable_maximumTime": {
      const handle = Number(args[0] ?? 0);
      const entry = timeTableStore.get(handle);
      if (!entry || entry.table.length === 0) return 0.0;
      return entry.table[entry.table.length - 1]![0]! + entry.shiftTime;
    }
    case "ModelicaStandardTables_CombiTimeTable_nextTimeEvent": {
      const handle = Number(args[0] ?? 0);
      const timeIn = Number(args[1] ?? 0.0);
      const entry = timeTableStore.get(handle);
      if (!entry || entry.table.length === 0) return 1e100;
      const effectiveTime = timeIn - entry.shiftTime;
      const tMin = entry.table[0]![0]!;
      const tMax = entry.table[entry.table.length - 1]![0]!;
      if (entry.extrapolation === 3 && entry.table.length >= 2 && tMax - tMin > 1e-15) {
        const period = tMax - tMin;
        const k = Math.floor((effectiveTime - tMin) / period);
        for (const row of entry.table) {
          const candidate = row[0]! + k * period;
          if (candidate > effectiveTime + 1e-12) {
            return candidate + entry.shiftTime;
          }
        }
        return tMin + (k + 1) * period + entry.shiftTime;
      }
      for (const row of entry.table) {
        const tRow = row[0]!;
        if (tRow > effectiveTime + 1e-12) {
          return tRow + entry.shiftTime;
        }
      }
      return 1e100;
    }
    case "ModelicaStandardTables_CombiTimeTable_close": {
      const handle = Number(args[0] ?? 0);
      timeTableStore.delete(handle);
      return 0;
    }

    // ── ModelicaStandardTables (CombiTable2D) ──
    case "ModelicaStandardTables_CombiTable2D_init":
    case "ModelicaStandardTables_CombiTable2D_init2": {
      const handle = nextHandleId++;
      const tableName = String(args[0] ?? "");
      const fileName = String(args[1] ?? "");
      const table = Array.isArray(args[2]) ? args[2] : [];
      const smoothness = Number(args[5] ?? 1);
      table2DStore.set(handle, { tableName, fileName, table, smoothness });
      return handle;
    }
    case "ModelicaStandardTables_CombiTable2D_getValue": {
      const handle = Number(args[0] ?? 0);
      const u1 = Number(args[1] ?? 0.0);
      const u2 = Number(args[2] ?? 0.0);
      const entry = table2DStore.get(handle);
      if (!entry || entry.table.length <= 1) return 0.0;
      // In MSL CombiTable2D format:
      // table[0][0] is dummy (usually 0.0)
      // table[0][j] (j>=1) are u2 grid points
      // table[i][0] (i>=1) are u1 grid points
      // table[i][j] (i>=1, j>=1) are function values
      const t = entry.table;
      const nRows = t.length;
      const nCols = t[0]!.length;
      if (nRows < 2 || nCols < 2) return 0.0;

      // Clamp u1 index
      let r = 1;
      while (r < nRows - 1 && t[r + 1]![0]! <= u1) r++;
      // Clamp u2 index
      let c = 1;
      while (c < nCols - 1 && t[0]![c + 1]! <= u2) c++;

      const u1_0 = t[r]![0]!;
      const u1_1 = t[r + 1] ? t[r + 1]![0]! : u1_0;
      const u2_0 = t[0]![c]!;
      const u2_1 = t[0]![c + 1] !== undefined ? t[0]![c + 1]! : u2_0;

      const f00 = t[r]![c] ?? 0.0;
      const f01 = t[r]![c + 1] ?? f00;
      const f10 = t[r + 1] ? (t[r + 1]![c] ?? f00) : f00;
      const f11 = t[r + 1] ? (t[r + 1]![c + 1] ?? f01) : f01;

      const du1 = Math.abs(u1_1 - u1_0) > 1e-15 ? (u1 - u1_0) / (u1_1 - u1_0) : 0.0;
      const du2 = Math.abs(u2_1 - u2_0) > 1e-15 ? (u2 - u2_0) / (u2_1 - u2_0) : 0.0;
      const w1 = Math.max(0, Math.min(1, du1));
      const w2 = Math.max(0, Math.min(1, du2));

      return (1 - w1) * (1 - w2) * f00 + (1 - w1) * w2 * f01 + w1 * (1 - w2) * f10 + w1 * w2 * f11;
    }
    case "ModelicaStandardTables_CombiTable2D_close": {
      const handle = Number(args[0] ?? 0);
      table2DStore.delete(handle);
      return 0;
    }

    // ── ModelicaIO ──
    case "ModelicaIO_readMatrixSizes": {
      const fileName = String(args[0] ?? "");
      const matrixName = String(args[1] ?? "");
      const stored = ioMatrixStore.get(`${fileName}::${matrixName}`);
      if (stored && stored.length > 0) {
        return [stored.length, stored[0]?.length ?? 0];
      }
      return [1, 1];
    }
    case "ModelicaIO_readRealMatrix": {
      const fileName = String(args[0] ?? "");
      const matrixName = String(args[1] ?? "");
      const nrow = Math.max(1, Number(args[2] ?? 1));
      const ncol = Math.max(1, Number(args[3] ?? 1));
      const stored = ioMatrixStore.get(`${fileName}::${matrixName}`);
      if (stored) {
        const out: number[][] = [];
        for (let r = 0; r < nrow; r++) {
          const srcRow = stored[r] ?? [];
          const row: number[] = [];
          for (let c = 0; c < ncol; c++) {
            row.push(Number(srcRow[c] ?? 0.0));
          }
          out.push(row);
        }
        return out;
      }
      return Array.from({ length: nrow }, () => new Array<number>(ncol).fill(0.0));
    }
    case "ModelicaIO_writeRealMatrix": {
      const fileName = String(args[0] ?? "");
      const matrixName = String(args[1] ?? "");
      const rawMatrix = args[2];
      if (Array.isArray(rawMatrix)) {
        const normalized: number[][] = rawMatrix.map((row: any) =>
          Array.isArray(row) ? row.map((v: any) => Number(v ?? 0.0)) : [Number(row ?? 0.0)],
        );
        ioMatrixStore.set(`${fileName}::${matrixName}`, normalized);
      }
      return 0;
    }

    default:
      return null;
  }
}
