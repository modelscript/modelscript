/**
 * @modelscript/cad — Boolean / CSG operations.
 *
 * Boolean operations are stored as tree nodes; they are evaluated during
 * STEP compilation.  In Phase 1 (pure-TS), booleans are approximated by
 * emitting each operand as a separate BREP body.  In Phase 4 (OCCT),
 * they become exact BREP boolean operations.
 */

import type { BooleanSolid, Solid } from "./types.js";
import { SolidKind } from "./types.js";

/**
 * Combine two or more solids into a single union.
 *
 * @example
 * ```ts
 * const frame = union(body, arm1, arm2, arm3, arm4);
 * ```
 */
export function union(a: Solid, b: Solid, ...rest: Solid[]): Solid {
  let result: Solid = Object.freeze<BooleanSolid>({
    kind: SolidKind.Union,
    name: `Union_${a.name}_${b.name}`,
    left: a,
    right: b,
  });
  for (const s of rest) {
    result = Object.freeze<BooleanSolid>({
      kind: SolidKind.Union,
      name: `Union_${result.name}_${s.name}`,
      left: result,
      right: s,
    });
  }
  return result;
}

/**
 * Subtract the tool solid from the base solid.
 *
 * @example
 * ```ts
 * const drilled = subtract(block, hole);
 * ```
 */
export function subtract(base: Solid, tool: Solid): BooleanSolid {
  return Object.freeze({
    kind: SolidKind.Subtract,
    name: `Subtract_${base.name}_${tool.name}`,
    left: base,
    right: tool,
  });
}

/**
 * Compute the intersection of two solids.
 *
 * @example
 * ```ts
 * const common = intersect(a, b);
 * ```
 */
export function intersect(a: Solid, b: Solid): BooleanSolid {
  return Object.freeze({
    kind: SolidKind.Intersect,
    name: `Intersect_${a.name}_${b.name}`,
    left: a,
    right: b,
  });
}
