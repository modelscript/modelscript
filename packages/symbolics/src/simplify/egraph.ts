// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, egraphSimplify as compilerEgraphSimplify } from "@modelscript/compiler";
import type { ModelicaExpression } from "../systems/index.js";
import { materializeExpression, mirrorExpressionToArena } from "../systems/index.js";

export {
  BackoffScheduler,
  DEFAULT_RULES,
  EGraph,
  rewrite,
  runEqualitySaturation,
  SimpleScheduler,
} from "@modelscript/compiler";
export type { EClassId, ENode, RewriteRule } from "@modelscript/compiler";

/**
 * Simplify a ModelicaExpression using Equality Saturation via the compiler's Arena-native E-Graph engine.
 */
export function egraphSimplify(expr: ModelicaExpression, maxIterations = 20): ModelicaExpression {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const simpId = compilerEgraphSimplify(arena, exprId, maxIterations);
  return materializeExpression(arena, simpId);
}
