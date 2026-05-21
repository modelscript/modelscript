// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @deprecated This module delegates to `@modelscript/compiler` for the
 * arena-native implementation. This re-export + adapter layer is provided
 * for backward compatibility during the migration.
 */

import {
  ArenaDAEBuilder,
  getArenaLiteralValue as compilerGetArenaLiteralValue,
  solveForVariableArena,
} from "@modelscript/compiler";
import type { ModelicaExpression } from "../systems/index.js";
import { materializeExpression, mirrorExpressionToArena } from "../systems/index.js";

export { collectArenaTerms, getArenaLiteralValue, solveForVariableArena } from "@modelscript/compiler";

/**
 * Solve `expr = 0` for `varName`.
 *
 * Returns an array of solution expressions (may be empty if no closed-form
 * solution is found). Each solution is an expression for varName.
 *
 * Tries polynomial solving (degree 1-4) first, then falls back.
 *
 * @deprecated Use `solveForVariableArena` from `@modelscript/compiler` for
 * arena-native code. This wrapper mirrors the expression into a temporary
 * arena and materializes the results back.
 */
export function solveForVariable(expr: ModelicaExpression, varName: string): ModelicaExpression[] {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const solutionIds = solveForVariableArena(arena, exprId, varName);

  // Check that solutions are not trivially zero / empty
  const results: ModelicaExpression[] = [];
  for (const solId of solutionIds) {
    const val = compilerGetArenaLiteralValue(arena, solId);
    // Always materialize — even zero is a valid solution
    if (val !== null || solId >= 0) {
      results.push(materializeExpression(arena, solId));
    }
  }
  return results;
}
