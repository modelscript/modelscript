// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic integration (anti-differentiation) engine.
 * Bridges the legacy AST representation with the new Arena DAE calculus engine.
 */

import {
  ArenaDAEBuilder,
  integrateArenaExpr,
  limitArena,
  nthDerivativeArena,
  taylorSeriesArena,
} from "@modelscript/compiler";
import type { ModelicaExpression } from "../systems/index.js";
import { materializeExpression, mirrorExpressionToArena } from "../systems/index.js";

/**
 * Symbolically integrate an expression with respect to a variable.
 */
export function integrateExpr(expr: ModelicaExpression, varName: string): ModelicaExpression | null {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const resultId = integrateArenaExpr(arena, exprId, varName);
  if (resultId === null) return null;
  return materializeExpression(arena, resultId);
}

/**
 * Compute the Taylor series expansion of an expression around a point.
 */
export function taylorSeries(
  expr: ModelicaExpression,
  varName: string,
  point: number,
  order: number,
): ModelicaExpression {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const resultId = taylorSeriesArena(arena, exprId, varName, point, order);
  return materializeExpression(arena, resultId);
}

/**
 * Evaluate a basic limit of expr as varName → point.
 */
export function limit(expr: ModelicaExpression, varName: string, point: number, maxIterations = 5): number | null {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  return limitArena(arena, exprId, varName, point, maxIterations);
}

/**
 * Compute the nth derivative of an expression.
 */
export function nthDerivative(expr: ModelicaExpression, varName: string, n: number): ModelicaExpression {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const resultId = nthDerivativeArena(arena, exprId, varName, n);
  return materializeExpression(arena, resultId);
}
