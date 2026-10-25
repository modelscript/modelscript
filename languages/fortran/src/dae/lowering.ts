// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for Fortran.
 *
 * Lowers procedural equations, state derivative assignments (SD(i) = expr),
 * and algebraic relations directly into @modelscript/runtime's linear-memory DAEBuilder.
 */

import { BinOp, Causality, EqKind, IDaeBuilder, VarType, Variability } from "@modelscript/runtime";

export interface FortranDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
}

/**
 * Lowers Fortran statements (such as EASY5 state derivatives SD(i) = ... and algebraic assignments)
 * directly into the DAEBuilder arena.
 */
export function lowerFortranToDae(
  builder: IDaeBuilder,
  lines: string[],
  prefix: string = "fortran",
): FortranDaeLoweringResult {
  const stateVarIndices: number[] = [];
  let equationCount = 0;
  const varMap = new Map<string, number>();

  function getOrAddVar(name: string, isContinuousState: boolean = false): number {
    const key = name.toUpperCase();
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
    const line = rawLine.trim();
    if (!line || line.startsWith("!")) continue;

    // Check for assignment: Target = Value
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0 || /^[><!=]=/.test(line.slice(eqIdx - 1))) continue;

    const target = line.slice(0, eqIdx).trim();
    const rhs = line.slice(eqIdx + 1).trim();

    // 1. EASY5 State Derivative: SD(i) = expr -> der(S_i) = expr
    const sdMatch = /^SD\s*\(\s*([0-9]+)\s*\)$/i.exec(target);
    if (sdMatch) {
      const stateNum = sdMatch[1]!;
      const stateVarName = `s_${stateNum}`;
      const stateVarIdx = getOrAddVar(stateVarName, true);

      // Create der(stateVar) expression
      const derExprId = builder.addDer(stateVarIdx);
      const rhsExprId = lowerExprToArena(builder, rhs, getOrAddVar);

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
      const rhsExprId = lowerExprToArena(builder, rhs, getOrAddVar);

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

function lowerExprToArena(
  builder: IDaeBuilder,
  expr: string,
  getOrAddVar: (name: string, isContinuousState?: boolean) => number,
): number {
  const trimmed = expr.trim();

  // Numeric literal
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return builder.addRealLiteral(parseFloat(trimmed));
  }

  // EASY5 State Reference: S(i)
  const sMatch = /^S\s*\(\s*([0-9]+)\s*\)$/i.exec(trimmed);
  if (sMatch) {
    const varIdx = getOrAddVar(`s_${sMatch[1]!}`, true);
    return builder.addName(varIdx);
  }

  // Variable reference
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    const varIdx = getOrAddVar(trimmed, false);
    return builder.addName(varIdx);
  }

  // Simple additive/multiplicative expressions
  // Check addition / subtraction at top level
  const addIdx = findTopLevelOp(trimmed, ["+", "-"]);
  if (addIdx > 0) {
    const op = trimmed[addIdx]!;
    const leftStr = trimmed.slice(0, addIdx).trim();
    const rightStr = trimmed.slice(addIdx + 1).trim();
    const leftId = lowerExprToArena(builder, leftStr, getOrAddVar);
    const rightId = lowerExprToArena(builder, rightStr, getOrAddVar);
    const binOp = op === "+" ? BinOp.Add : BinOp.Sub;
    return builder.addBinaryExpr(binOp, leftId, rightId);
  }

  // Check multiplication / division at top level
  const mulIdx = findTopLevelOp(trimmed, ["*", "/"]);
  if (mulIdx > 0) {
    const op = trimmed[mulIdx]!;
    const leftStr = trimmed.slice(0, mulIdx).trim();
    const rightStr = trimmed.slice(mulIdx + 1).trim();
    const leftId = lowerExprToArena(builder, leftStr, getOrAddVar);
    const rightId = lowerExprToArena(builder, rightStr, getOrAddVar);
    const binOp = op === "*" ? BinOp.Mul : BinOp.Div;
    return builder.addBinaryExpr(binOp, leftId, rightId);
  }

  // Parentheses stripping: (inner)
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return lowerExprToArena(builder, trimmed.slice(1, -1), getOrAddVar);
  }

  // Fallback default
  return builder.addRealLiteral(0.0);
}

function findTopLevelOp(str: string, ops: string[]): number {
  let depth = 0;
  for (let i = str.length - 1; i >= 0; i--) {
    const ch = str[i]!;
    if (ch === ")") depth++;
    else if (ch === "(") depth--;
    if (depth === 0 && ops.includes(ch)) {
      // Ensure it's not a leading unary sign
      if (i > 0 && !/[+\-*/^(]/.test(str[i - 1]!)) {
        return i;
      }
    }
  }
  return -1;
}
