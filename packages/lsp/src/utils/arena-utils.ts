// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEPrinter, DAEBuilder, ExprKind, VarType, Variability } from "@modelscript/runtime";

function resolveAttrString(arena: DAEBuilder, varIdx: number, attrName: string): string | undefined {
  const exprId = arena.getVarAttrExprId(varIdx, attrName);
  if (exprId === undefined || exprId < 0) return undefined;
  if (arena.getExprKind(exprId) === ExprKind.StringLiteral) {
    return arena.interner.resolve(arena.getExprData1(exprId));
  }
  return undefined;
}

/**
 * Port getParameterInfo to work on DAEBuilder.
 */
export function getArenaParameterInfo(arena: DAEBuilder): any[] {
  const infos: any[] = [];
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    if (arena.getVarVariability(i) !== Variability.Parameter) continue;
    const name = arena.getVarName(i);
    const startVal = arena.getVarStartValue(i);
    const varType = arena.getVarType(i);
    let type: "real" | "integer" | "boolean" | "enumeration" = "real";
    let step = 0.1;
    if (varType === VarType.Boolean) {
      type = "boolean";
      step = 1;
    } else if (varType === VarType.Integer) {
      type = "integer";
      step = 1;
    }
    const unit = resolveAttrString(arena, i, "displayUnit") ?? resolveAttrString(arena, i, "unit");
    const description = arena.getVarDescription(i);
    const minVal = evaluateArenaExprToNum(arena, arena.getVarAttrExprId(i, "min"));
    const maxVal = evaluateArenaExprToNum(arena, arena.getVarAttrExprId(i, "max"));
    infos.push({
      name,
      type,
      defaultValue: startVal,
      step,
      ...(unit ? { unit } : {}),
      ...(description ? { description } : {}),
      ...(minVal !== null ? { min: minVal } : {}),
      ...(maxVal !== null ? { max: maxVal } : {}),
    });
  }
  return infos;
}

export function getArenaOutputStringIds(arena: DAEBuilder): number[] | undefined {
  const tier0Ids: number[] = [];
  const tier1Ids: number[] = [];
  const tier2Ids: number[] = [];
  const derIds: number[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    if (arena.hiddenVarIndices?.has(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) continue;
    if (arena.getVarShape(i).length > 0) continue;
    const name = arena.getVarName(i);
    const nameId = arena.getVarNameId(i);
    seen.add(nameId);
    if (arena.isVarFixed(i)) {
      tier0Ids.push(nameId);
    } else if (
      name.split(".").length <= 2 &&
      !name.startsWith("ground.") &&
      !name.endsWith(".T_heatPort") &&
      !name.endsWith(".R_actual")
    ) {
      tier1Ids.push(nameId);
    } else {
      tier2Ids.push(nameId);
    }
  }

  for (let e = 0; e < arena.exprCount; e++) {
    if (arena.getExprKind(e) === ExprKind.Der) {
      const argId = arena.getExprData1(e);
      if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
        const baseName = arena.interner.resolve(arena.getExprData1(argId));
        if (baseName) {
          const baseIdx = arena.getVarIdxByName(baseName);
          if (baseIdx >= 0 && !arena.isVarRemoved(baseIdx) && !arena.hiddenVarIndices?.has(baseIdx)) {
            const derId = arena.interner.intern(`der(${baseName})`);
            if (!seen.has(derId)) {
              seen.add(derId);
              derIds.push(derId);
            }
          }
        }
      }
    }
  }

  const ids = [...tier0Ids, ...tier1Ids, ...tier2Ids, ...derIds];
  return ids.length > 0 ? ids : undefined;
}

export function getArenaVariableMetadata(
  arena: DAEBuilder,
  states: string[],
): Record<string, { unit?: string; description?: string }> {
  const meta: Record<string, { unit?: string; description?: string }> = {};
  for (const state of states) {
    const isDer = state.startsWith("der(") && state.endsWith(")");
    const lookupName = isDer ? state.slice(4, -1) : state;
    const varIdx = arena.getVarIdxByName(lookupName);
    if (varIdx >= 0) {
      const baseUnit = resolveAttrString(arena, varIdx, "displayUnit") ?? resolveAttrString(arena, varIdx, "unit");
      const baseDesc = arena.getVarDescription(varIdx);
      const unit = isDer ? (baseUnit ? `${baseUnit}/s` : "1/s") : baseUnit;
      const description = isDer ? (baseDesc ? `der(${baseDesc})` : `Time derivative of ${lookupName}`) : baseDesc;
      if (unit || description) {
        meta[state] = {
          ...(unit ? { unit } : {}),
          ...(description ? { description } : {}),
        };
      }
    }
  }
  return meta;
}

export function printArenaExpression(arena: DAEBuilder, exprId: number): string {
  const chunks: string[] = [];
  const writer = {
    write: (s: string) => {
      chunks.push(s);
    },
  };
  const printer = new ArenaDAEPrinter(writer, arena);
  printer.printExpr(exprId);
  return chunks.join("");
}

export function evaluateArenaExprToNum(arena: DAEBuilder, exprId: number | undefined): number | null {
  if (exprId === undefined || exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) {
    return arena.getExprRealValue(exprId);
  }
  if (kind === ExprKind.IntLiteral) {
    return arena.getExprData1(exprId);
  }
  return null;
}
