// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, ExprKind, UnaryOp } from "./wasm_dae.js";

export interface CachedTable1D {
  table: number[][];
  columns: number[];
  shiftTime: number;
  timeScale: number;
  startTime: number;
  hasTimeScaled?: boolean;
}

export function extractTableArrayLiteral(arena: DAEBuilder, exprId: number): any {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.Negate) {
    const inner = extractTableArrayLiteral(arena, arena.getExprLeft(exprId));
    return typeof inner === "number" ? -inner : null;
  }
  if (kind === ExprKind.Unary) {
    const op = arena.getExprData1(exprId) as UnaryOp;
    const inner = extractTableArrayLiteral(arena, arena.getExprLeft(exprId));
    if (typeof inner !== "number") return null;
    if (op === UnaryOp.Negate) return -inner;
    if (op === UnaryOp.Not) return inner === 0 ? 1 : 0;
    return inner;
  }
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
    const data = tableExpr !== undefined ? extractTableArrayLiteral(arena, tableExpr) : null;
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
          const extracted = exprId !== undefined && exprId >= 0 ? extractTableArrayLiteral(arena, exprId) : null;
          const val = (typeof extracted === "number" ? extracted : arena.getVarStartValue(vIdx)) ?? 0;
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

  let columns: number[] = [];
  const colsIdx = arena.getVarIdxByName(`${prefix}.columns`);
  if (colsIdx >= 0) {
    const colsExpr = arena.getVarExpression(colsIdx);
    const colsData = colsExpr !== undefined ? extractTableArrayLiteral(arena, colsExpr) : null;
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
      const extracted = exprId !== undefined && exprId >= 0 ? extractTableArrayLiteral(arena, exprId) : null;
      const val = (typeof extracted === "number" ? extracted : arena.getVarStartValue(vIdx)) ?? i + 1;
      columns.push(Math.round(val));
      i++;
    }
  }

  const shiftIdx = arena.getVarIdxByName(`${prefix}.shiftTime`);
  let shiftTime = 0.0;
  if (shiftIdx >= 0) {
    const shiftExpr = arena.getVarExpression(shiftIdx);
    const val = shiftExpr !== undefined ? extractTableArrayLiteral(arena, shiftExpr) : null;
    shiftTime = typeof val === "number" ? val : arena.getVarStartValue(shiftIdx);
  }

  const scaleIdx = arena.getVarIdxByName(`${prefix}.timeScale`);
  let timeScale = 1.0;
  if (scaleIdx >= 0) {
    const scaleExpr = arena.getVarExpression(scaleIdx);
    const val = scaleExpr !== undefined ? extractTableArrayLiteral(arena, scaleExpr) : null;
    const rawScale = typeof val === "number" ? val : arena.getVarStartValue(scaleIdx);
    if (rawScale !== 0) timeScale = rawScale;
  }

  const startIdx = arena.getVarIdxByName(`${prefix}.startTime`);
  let startTime = 0.0;
  if (startIdx >= 0) {
    const startExpr = arena.getVarExpression(startIdx);
    const val = startExpr !== undefined ? extractTableArrayLiteral(arena, startExpr) : null;
    startTime = typeof val === "number" ? val : arena.getVarStartValue(startIdx);
  }

  const hasTimeScaled = arena.getVarIdxByName(`${prefix}.timeScaled`) >= 0;

  const record: CachedTable1D = {
    table: tableData,
    columns,
    shiftTime,
    timeScale,
    startTime,
    hasTimeScaled,
  };
  cachedMap.set(tableVarNameId, record);
  return record;
}

export function evalTable1DValue(cached: CachedTable1D | null, icol: number, u: number): number {
  if (!cached || !cached.table || cached.table.length === 0) return 0.0;
  const table = cached.table;
  const colInTable =
    cached.columns && cached.columns.length >= icol && cached.columns[icol - 1]! >= 2
      ? cached.columns[icol - 1]! - 1
      : icol;
  return interpolate1DTable(table, colInTable, u);
}

export const evalSimTable1DValue = evalTable1DValue;

export function evalTimeTableValue(
  cached: CachedTable1D | null,
  icol: number,
  timeIn: number,
  isAlreadyScaled = false,
  isAlreadyShifted = false,
): number {
  if (!cached || !cached.table || cached.table.length === 0) return 0.0;
  const table = cached.table;
  const scale = cached.timeScale || 1.0;
  const alreadyScaled = isAlreadyScaled || Boolean(cached.hasTimeScaled);
  const effTime = alreadyScaled
    ? isAlreadyShifted
      ? timeIn
      : timeIn - cached.shiftTime / scale
    : (isAlreadyShifted ? timeIn : timeIn - cached.shiftTime) / scale;
  const colInTable =
    cached.columns && cached.columns.length >= icol && cached.columns[icol - 1]! >= 2
      ? cached.columns[icol - 1]! - 1
      : icol;
  return interpolate1DTable(table, colInTable, effTime);
}

export const evalSimTimeTableValue = evalTimeTableValue;

export function evalTimeTableTmin(cached: CachedTable1D | null): number {
  return cached && cached.table.length > 0 ? (cached.table[0]![0]! + cached.shiftTime) * (cached.timeScale || 1.0) : 0;
}

export function evalTimeTableTmax(cached: CachedTable1D | null): number {
  return cached && cached.table.length > 0
    ? (cached.table[cached.table.length - 1]![0]! + cached.shiftTime) * (cached.timeScale || 1.0)
    : 0;
}
