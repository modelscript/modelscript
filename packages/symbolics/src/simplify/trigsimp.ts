// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArenaDAEBuilder,
  trigExpand as compilerTrigExpand,
  trigSimplify as compilerTrigSimplify,
} from "@modelscript/compiler";
import type { ModelicaExpression } from "../systems/index.js";
import { materializeExpression, mirrorExpressionToArena } from "../systems/index.js";

export { TRIG_EXPAND_RULES, TRIG_RULES } from "@modelscript/compiler";

/**
 * Simplify an expression using extended trigonometric identities.
 * Uses the E-Graph equality saturation engine with trig-specific rules.
 */
export function trigSimplify(expr: ModelicaExpression, maxIterations = 30): ModelicaExpression {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const simpId = compilerTrigSimplify(arena, exprId, maxIterations);
  return materializeExpression(arena, simpId);
}

/**
 * Expand trigonometric expressions using addition formulas.
 * sin(a+b) → sin(a)cos(b) + cos(a)sin(b), etc.
 */
export function trigExpand(expr: ModelicaExpression, maxIterations = 20): ModelicaExpression {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const simpId = compilerTrigExpand(arena, exprId, maxIterations);
  return materializeExpression(arena, simpId);
}
