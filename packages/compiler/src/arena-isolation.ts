// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, ExprKind } from "./dae-arena.js";

/**
 * Checks if the arena equation is explicitly solvable for the target variable.
 * An equation is explicitly solvable if it's of the form `Var = Expr` or `Expr = Var`
 * and `Var` does not appear in `Expr`.
 *
 * @returns The ExprId of the isolated expression, or -1 if not explicitly solvable.
 */
export function isExplicitlySolvableArena(arena: ArenaDAEBuilder, eqIdx: number, targetVarIdx: number): number {
  const left = arena.getEqLhs(eqIdx);
  const right = arena.getEqRhs(eqIdx);

  const isTargetVar = (exprId: number) => {
    if (arena.getExprKind(exprId) === ExprKind.Name) {
      const nameId = arena.getExprData1(exprId);
      return arena.getVarNameId(targetVarIdx) === nameId;
    }
    // Also handle der(x) if targetVarIdx is the derivative variable
    if (arena.getExprKind(exprId) === ExprKind.Der) {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        // This is a naive check. A proper check would format `der(x)` and check if it matches the targetVarIdx name.
        // For now, we assume the simulator has resolved der(x) correctly.
        const targetName = arena.getVarName(targetVarIdx);
        if (targetName.startsWith("der(")) return true;
      }
    }
    return false;
  };

  const containsVar = (exprId: number): boolean => {
    if (exprId === -1) return false;
    if (isTargetVar(exprId)) return true;

    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Binary) {
      return containsVar(arena.getExprLeft(exprId)) || containsVar(arena.getExprRight(exprId));
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate || kind === ExprKind.Der || kind === ExprKind.Pre) {
      return containsVar(arena.getExprLeft(exprId));
    }
    if (kind === ExprKind.Call) {
      const count = arena.getExprRight(exprId);
      const first = arena.getExprLeft(exprId);
      for (let i = 0; i < count; i++) {
        if (containsVar(first + i)) return true;
      }
    }
    return false;
  };

  if (isTargetVar(left)) {
    if (!containsVar(right)) return right;
  }
  if (isTargetVar(right)) {
    if (!containsVar(left)) return left;
  }

  return -1;
}

/**
 * Attempts to symbolically isolate the target variable in the equation.
 * E.g., if equation is `x + 5 = y` and target is `x`, it returns `y - 5`.
 * Currently implements basic linear isolation.
 */
export function isolateSymbolicallyArena(arena: ArenaDAEBuilder, eqIdx: number, targetVarIdx: number): number {
  const explicitRhs = isExplicitlySolvableArena(arena, eqIdx, targetVarIdx);
  if (explicitRhs !== -1) return explicitRhs;

  // Basic isolation logic (Phase 3d)
  // For now, we only handle very simple linear cases or leave it as implicit if we can't.
  // A full arena-native e-graph simplifier/isolator goes here.

  // TODO: implement full arena-native isolation
  return -1;
}
