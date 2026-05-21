// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica CAS bindings — backward-compatible wrapper.
 *
 * Delegates all compile-time CAS operations to the arena-native
 * implementation in `@modelscript/compiler`. Legacy callers that
 * pass `ModelicaExpression[]` args get automatic mirror/materialize
 * round-tripping through a temporary `ArenaDAEBuilder`.
 *
 * @deprecated Prefer importing from `@modelscript/compiler` directly.
 */

import {
  ArenaDAEBuilder,
  CAS_FUNCTIONS_ARENA,
  evaluateCASFunctionArena,
  isCASFunctionArena,
} from "@modelscript/compiler";
import type { ModelicaExpression } from "../systems/index.js";
import { ModelicaExpressionValue, materializeExpression, mirrorExpressionToArena } from "../systems/index.js";

// ── Re-export arena-native API ──

export {
  CAS_FUNCTIONS_ARENA,
  MODELSCRIPT_CAS_PACKAGE,
  evaluateCASFunctionArena,
  isCASFunctionArena,
} from "@modelscript/compiler";

// ─────────────────────────────────────────────────────────────────────
// Legacy API
// ─────────────────────────────────────────────────────────────────────

/**
 * Registry of CAS functions operating on legacy `ModelicaExpression` ASTs.
 *
 * Each entry delegates to the arena-native implementation by mirroring
 * args into a temporary `ArenaDAEBuilder`, calling `evaluateCASFunctionArena`,
 * and materializing the result back.
 *
 * @deprecated Use `CAS_FUNCTIONS_ARENA` from `@modelscript/compiler`.
 */
export const CAS_FUNCTIONS = new Map<string, (args: ModelicaExpression[]) => ModelicaExpression | null>();
for (const name of CAS_FUNCTIONS_ARENA.keys()) {
  CAS_FUNCTIONS.set(name, (args) => evaluateCASFunction(name, args));
}

/**
 * Attempt to evaluate a CAS function call at compile-time.
 * Returns the result expression, or null if the function is not a CAS function.
 *
 * @deprecated Use `evaluateCASFunctionArena` from `@modelscript/compiler`.
 */
export function evaluateCASFunction(functionName: string, args: ModelicaExpression[]): ModelicaExpression | null {
  const arena = new ArenaDAEBuilder();

  // Mirror each argument into the arena, unwrapping ModelicaExpressionValue wrappers
  const arenaArgs = args.map((arg) => {
    const unwrapped = unwrapExpr(arg);
    return unwrapped ? mirrorExpressionToArena(arena, unwrapped) : -1;
  });

  const resultId = evaluateCASFunctionArena(arena, functionName, arenaArgs);
  if (resultId === null || resultId < 0) return null;

  return materializeExpression(arena, resultId);
}

/**
 * Check if a function name is a CAS function.
 *
 * @deprecated Use `isCASFunctionArena` from `@modelscript/compiler`.
 */
export function isCASFunction(name: string): boolean {
  return isCASFunctionArena(name);
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

function unwrapExpr(expr: ModelicaExpression | null | undefined): ModelicaExpression | null {
  if (!expr) return null;
  if (expr instanceof ModelicaExpressionValue) return expr.value;
  return expr;
}
