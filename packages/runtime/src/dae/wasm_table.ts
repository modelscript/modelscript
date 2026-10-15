// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, ExprKind } from "./wasm_dae.js";

export interface CachedTable1D {
  table: number[][];
  columns: number[];
  shiftTime: number;
  timeScale: number;
  startTime: number;
}

export function extractTableArrayLiteral(arena: DAEBuilder, exprId: number): any {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.ArrayCtor) {
    const count = arena.getExprData1(exprId);
    const elems: any[] = [];
    elems.push(extractTableArrayLiteral(arena, arena.getExprLeft(exprId)));
    for (let i = 1; i < count; i++) {
      elems.push(extractTableArrayLiteral(arena, arena.getExprLeft(exprId + i)));
    }
    return elems;
  }
  return null;
}

export function interpolate1DTable(table: number[][], colIdx: number, u: number): number {
  if (!table || table.length === 0) return 0.0;
  const n = table.length;
  if (n === 1) return table[0]![colIdx] ?? 0.0;

  if (u <= table[0]![0]!) return table[0]![colIdx] ?? 0.0;
  if (u >= table[n - 1]![0]!) return table[n - 1]![colIdx] ?? 0.0;

  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]![0]! <= u) lo = mid;
    else hi = mid;
  }

  while (hi < n - 1 && table[hi]![0]! <= u) {
    lo = hi;
    hi++;
  }

  const x0 = table[lo]![0]!;
  const x1 = table[hi]![0]!;
  const y0 = table[lo]![colIdx] ?? 0.0;
  const y1 = table[hi]![colIdx] ?? 0.0;

  if (Math.abs(x1 - x0) < 1e-15) return y1;
  const t = (u - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

export function getOrCreateCachedTable(arena: DAEBuilder, tableVarNameId: number): CachedTable1D | null {
  const arenaAny = arena as any;
  if (!arenaAny._cachedTables) {
    arenaAny._cachedTables = new Map<number, CachedTable1D>();
  }
  const cachedMap: Map<number, CachedTable1D> = arenaAny._cachedTables;
  if (cachedMap.has(tableVarNameId)) {
    return cachedMap.get(tableVarNameId)!;
  }

  const tableVarName = arena.interner.resolve(tableVarNameId) ?? "";
  const prefix = tableVarName.replace(/\.tableID$/, "");

  let tableData: number[][] | null = null;
  const tableIdx = arena.getVarIdxByName(`${prefix}.table`);
  if (tableIdx >= 0) {
    const tableExpr = arena.getVarExpression(tableIdx);
    const data = extractTableArrayLiteral(arena, tableExpr);
    if (Array.isArray(data)) tableData = data;
  }
  if (!tableData) {
    if (arena.getVarIdxByName(`${prefix}.table[1,1]`) >= 0) {
      tableData = [];
      let r = 1;
      while (true) {
        if (arena.getVarIdxByName(`${prefix}.table[${r},1]`) < 0) break;
        const row: number[] = [];
        let c = 1;
        while (true) {
          const vIdx = arena.getVarIdxByName(`${prefix}.table[${r},${c}]`);
          if (vIdx < 0) break;
          const exprId = arena.getVarExpression(vIdx);
          const val =
            (exprId >= 0
              ? arena.getExprKind(exprId) === ExprKind.IntLiteral
                ? arena.getExprData1(exprId)
                : arena.getExprRealValue(exprId)
              : arena.getVarStartValue(vIdx)) ?? 0;
          row.push(val);
          c++;
        }
        if (row.length === 0) break;
        tableData.push(row);
        r++;
      }
    }
  }
  if (!tableData || tableData.length === 0) return null;

  let columns: number[] = [1];
  const colsIdx = arena.getVarIdxByName(`${prefix}.columns`);
  if (colsIdx >= 0) {
    const colsExpr = arena.getVarExpression(colsIdx);
    const colsData = extractTableArrayLiteral(arena, colsExpr);
    if (Array.isArray(colsData)) {
      columns = colsData.map(Number);
    }
  } else if (arena.getVarIdxByName(`${prefix}.columns[1]`) >= 0) {
    columns = [];
    let i = 1;
    while (true) {
      const vIdx = arena.getVarIdxByName(`${prefix}.columns[${i}]`);
      if (vIdx < 0) break;
      const exprId = arena.getVarExpression(vIdx);
      const val =
        (exprId >= 0
          ? arena.getExprKind(exprId) === ExprKind.IntLiteral
            ? arena.getExprData1(exprId)
            : arena.getExprRealValue(exprId)
          : arena.getVarStartValue(vIdx)) ?? i;
      columns.push(Math.round(val));
      i++;
    }
  }

  const shiftIdx = arena.getVarIdxByName(`${prefix}.shiftTime`);
  let shiftTime = 0.0;
  if (shiftIdx >= 0) {
    const shiftExpr = arena.getVarExpression(shiftIdx);
    const val = extractTableArrayLiteral(arena, shiftExpr);
    if (typeof val === "number") shiftTime = val;
  }

  const scaleIdx = arena.getVarIdxByName(`${prefix}.timeScale`);
  let timeScale = 1.0;
  if (scaleIdx >= 0) {
    const scaleExpr = arena.getVarExpression(scaleIdx);
    const val = extractTableArrayLiteral(arena, scaleExpr);
    if (typeof val === "number") timeScale = val;
  }

  const startIdx = arena.getVarIdxByName(`${prefix}.startTime`);
  let startTime = 0.0;
  if (startIdx >= 0) {
    const startExpr = arena.getVarExpression(startIdx);
    const val = extractTableArrayLiteral(arena, startExpr);
    if (typeof val === "number") startTime = val;
  }

  const record: CachedTable1D = {
    table: tableData,
    columns,
    shiftTime,
    timeScale,
    startTime,
  };
  cachedMap.set(tableVarNameId, record);
  return record;
}

export function evalTimeTableValue(cached: CachedTable1D | null, icol: number, timeIn: number): number {
  if (!cached || !cached.table || cached.table.length === 0) return 0.0;
  const table = cached.table;
  const effTime = (timeIn - cached.shiftTime) / (cached.timeScale || 1.0);
  const colInTable = cached.columns && cached.columns.length >= icol ? cached.columns[icol - 1] - 1 : icol;
  return interpolate1DTable(table, colInTable, effTime);
}

export function evalTimeTableTmin(cached: CachedTable1D | null): number {
  return cached && cached.table.length > 0 ? (cached.table[0][0] + cached.shiftTime) * (cached.timeScale || 1.0) : 0;
}

export function evalTimeTableTmax(cached: CachedTable1D | null): number {
  return cached && cached.table.length > 0
    ? (cached.table[cached.table.length - 1][0] + cached.shiftTime) * (cached.timeScale || 1.0)
    : 0;
}
