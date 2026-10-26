// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for C.
 *
 * Lowers continuous state derivative assignments (dx[i] = expr, der_x = expr)
 * and explicit algebraic relations directly into @modelscript/runtime's linear-memory IDaeBuilder.
 */

import { BinOp, Causality, EqKind, IDaeBuilder, VarType, Variability } from "@modelscript/runtime";

export interface CDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
}

export function lowerCToDae(builder: IDaeBuilder, lines: string[], prefix: string = "c_blk"): CDaeLoweringResult {
  const stateVarIndices: number[] = [];
  let equationCount = 0;
  const varMap = new Map<string, number>();

  function getOrAddVar(name: string, isContinuousState: boolean = false): number {
    const key = name.toLowerCase();
    if (varMap.has(key)) return varMap.get(key)!;

    const varName = `${prefix}_${name}`;
    const idx = builder.addVariable(
      varName,
      VarType.Real,
      isContinuousState ? Variability.Continuous : Variability.Discrete,
      Causality.Local,
      0.0,
    );
    varMap.set(key, idx);
    if (isContinuousState) {
      stateVarIndices.push(idx);
    }
    return idx;
  }

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("/*")) continue;

    // Strip trailing semicolon
    if (line.endsWith(";")) {
      line = line.slice(0, -1).trim();
    }

    // Check for assignment: Target = Value
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0 || /^[><!=]=/.test(line.slice(eqIdx - 1))) continue;

    const target = line.slice(0, eqIdx).trim();
    const rhs = line.slice(eqIdx + 1).trim();

    // 1. ODE State Derivative: dx[i] = expr or der_x = expr -> der(s_i) = expr
    const dxSubscriptMatch = /^(?:dx|der_x|s_dot|x_dot)\s*\[\s*([0-9]+)\s*\]$/i.exec(target);
    if (dxSubscriptMatch) {
      const stateNum = dxSubscriptMatch[1]!;
      const stateVarName = `s_${stateNum}`;
      const stateVarIdx = getOrAddVar(stateVarName, true);

      const derExprId = builder.addDer(stateVarIdx);
      const rhsExprId = lowerCExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, derExprId, rhsExprId);
      equationCount++;
      continue;
    }

    const derPrefixMatch = /^der_([A-Za-z_][A-Za-z0-9_]*)$/i.exec(target);
    if (derPrefixMatch) {
      const stateVarName = derPrefixMatch[1]!;
      const stateVarIdx = getOrAddVar(stateVarName, true);

      const derExprId = builder.addDer(stateVarIdx);
      const rhsExprId = lowerCExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, derExprId, rhsExprId);
      equationCount++;
      continue;
    }

    // 2. Algebraic Assignment: Var = expr
    const varMatch = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
    if (varMatch) {
      const varName = varMatch[1]!;
      const varIdx = getOrAddVar(varName, false);
      const lhsExprId = builder.addName(varIdx);
      const rhsExprId = lowerCExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
      equationCount++;
      continue;
    }
  }

  return {
    stateVarIndices,
    equationCount,
  };
}

function lowerCExprToArena(
  builder: IDaeBuilder,
  expr: string,
  getOrAddVar: (name: string, isContinuousState?: boolean) => number,
): number {
  const trimmed = expr.trim();

  // Numeric literal
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?[fFlLuU]*$/.test(trimmed)) {
    return builder.addRealLiteral(parseFloat(trimmed.replace(/[fFlLuU]/g, "")));
  }

  // State Array Subscript: x[i] or s[i]
  const stateSubMatch = /^(?:x|s)\s*\[\s*([0-9]+)\s*\]$/i.exec(trimmed);
  if (stateSubMatch) {
    const varIdx = getOrAddVar(`s_${stateSubMatch[1]!}`, true);
    return builder.addName(varIdx);
  }

  // Variable reference
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    const varIdx = getOrAddVar(trimmed, false);
    return builder.addName(varIdx);
  }

  // Top level addition / subtraction
  const addIdx = findTopLevelOp(trimmed, ["+", "-"]);
  if (addIdx > 0) {
    const op = trimmed[addIdx]!;
    const leftStr = trimmed.slice(0, addIdx).trim();
    const rightStr = trimmed.slice(addIdx + 1).trim();
    const leftId = lowerCExprToArena(builder, leftStr, getOrAddVar);
    const rightId = lowerCExprToArena(builder, rightStr, getOrAddVar);
    const binOp = op === "+" ? BinOp.Add : BinOp.Sub;
    return builder.addBinaryExpr(binOp, leftId, rightId);
  }

  // Top level multiplication / division
  const mulIdx = findTopLevelOp(trimmed, ["*", "/"]);
  if (mulIdx > 0) {
    const op = trimmed[mulIdx]!;
    const leftStr = trimmed.slice(0, mulIdx).trim();
    const rightStr = trimmed.slice(mulIdx + 1).trim();
    const leftId = lowerCExprToArena(builder, leftStr, getOrAddVar);
    const rightId = lowerCExprToArena(builder, rightStr, getOrAddVar);
    const binOp = op === "*" ? BinOp.Mul : BinOp.Div;
    return builder.addBinaryExpr(binOp, leftId, rightId);
  }

  // Parentheses: (inner)
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return lowerCExprToArena(builder, trimmed.slice(1, -1), getOrAddVar);
  }

  return builder.addRealLiteral(0.0);
}

function findTopLevelOp(str: string, ops: string[]): number {
  let depth = 0;
  for (let i = str.length - 1; i >= 0; i--) {
    const ch = str[i]!;
    if (ch === ")") depth++;
    else if (ch === "(") depth--;
    if (depth === 0 && ops.includes(ch)) {
      if (i > 0 && !/[+\-*/^(]/.test(str[i - 1]!)) {
        return i;
      }
    }
  }
  return -1;
}
