// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-native constant folding — operates directly on ArenaDAEBuilder
 * without materializing any legacy ModelicaExpression objects.
 *
 * Replaces the legacy `ModelicaFlattener.foldDAEConstants()` for the
 * arena pipeline. Iteratively folds constant and parameter binding
 * expressions until a fixed point is reached.
 */

import type { ArenaValue } from "./arena-eval.js";
import { evaluateArenaExpression } from "./arena-eval.js";
import { ArenaDAEBuilder, EqKind, ExprKind, Variability } from "./dae-arena.js";
import type { QueryDB, SymbolId } from "./runtime.js";

/**
 * Fold constant and parameter expressions in the arena to literal values
 * where possible. This is done iteratively until no more simplifications
 * can be made (fixed-point iteration).
 *
 * @param arena The ArenaDAEBuilder to fold constants in (mutated in place).
 * @param db Optional Salsa QueryDB.
 * @param scopeId Optional SymbolId of the class scope.
 * @param maxIterations Maximum number of passes (default: 100).
 * @returns The number of iterations performed.
 */
export function foldArenaConstants(
  arena: ArenaDAEBuilder,
  db?: QueryDB,
  scopeId?: SymbolId,
  maxIterations = 100,
): number {
  // Build a name→varIdx map for O(1) lookups
  const nameToIdx = new Map<string, number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      nameToIdx.set(arena.getVarName(i), i);
    }
  }

  // Build parameter map for evaluateArenaExpression
  const paramMap = new Map<string, number>();

  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Update parameter map from current variable values
    paramMap.clear();
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v === Variability.Constant || v === Variability.Parameter) {
        const name = arena.getVarName(i);
        const startVal = arena.getVarStartValue(i);
        // Use binding expression value if available, otherwise startVal
        const exprId = arena.getVarExpression(i);
        if (typeof exprId === "number" && exprId >= 0) {
          const evaluated = evaluateArenaExpression(arena, exprId, paramMap, db, scopeId);
          if (evaluated !== null) {
            let foldedValue: ArenaValue | null = evaluated;
            const match = name.match(/\[([\d,]+)\]$/);
            if (match) {
              const indices = match[1].split(",").map(Number);
              let current = foldedValue;
              for (const idx of indices) {
                if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                  current = current[idx - 1] as ArenaValue;
                } else {
                  foldedValue = null;
                  break;
                }
              }
              if (foldedValue !== null) {
                foldedValue = current;
              }
            }
            if (foldedValue !== null && (typeof foldedValue === "number" || typeof foldedValue === "boolean")) {
              paramMap.set(name, typeof foldedValue === "boolean" ? (foldedValue ? 1.0 : 0.0) : foldedValue);
              continue;
            }
          }
        }
        paramMap.set(name, startVal);
      }
    }

    // Phase 1: Fold variable binding expressions
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v !== Variability.Constant && v !== Variability.Parameter) continue;

      const exprId = arena.getVarExpression(i);
      if (typeof exprId !== "number" || exprId < 0) continue;

      // Try to evaluate the binding expression
      const result = evaluateArenaExpression(arena, exprId, paramMap, db, scopeId);
      if (result !== null) {
        const name = arena.getVarName(i);
        let foldedValue: ArenaValue | null = result;
        const match = name.match(/\[([\d,]+)\]$/);
        if (match) {
          const indices = match[1].split(",").map(Number);
          let current = foldedValue;
          for (const idx of indices) {
            if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
              current = current[idx - 1] as ArenaValue;
            } else {
              foldedValue = null;
              break;
            }
          }
          if (foldedValue !== null) {
            foldedValue = current;
          }
        }

        if (foldedValue !== null) {
          let numValue: number | null = null;
          if (typeof foldedValue === "number") {
            numValue = foldedValue;
          } else if (typeof foldedValue === "boolean") {
            numValue = foldedValue ? 1.0 : 0.0;
          }

          if (numValue !== null) {
            const currentStart = arena.getVarStartValue(i);
            if (currentStart !== numValue) {
              arena.setVarStartValue(i, numValue);
              changed = true;
            }
          }
        }
      }
    }

    // Phase 2: Fold equation expressions (substitute known constants)
    for (let i = 0; i < arena.eqCount; i++) {
      const kind = arena.getEqKind(i);
      if (kind !== EqKind.Simple && kind !== EqKind.InitialSimple) continue;

      const lhs = arena.getEqLhs(i);
      const rhs = arena.getEqRhs(i);

      // If one side is a constant variable name and the other evaluates to a number,
      // update the variable's start value
      if (lhs >= 0 && arena.getExprKind(lhs) === ExprKind.Name) {
        const nameId = arena.getExprData1(lhs);
        const name = arena.interner.resolve(nameId);
        if (name) {
          const varIdx = nameToIdx.get(name);
          if (varIdx !== undefined) {
            const vv = arena.getVarVariability(varIdx);
            if (vv === Variability.Constant || vv === Variability.Parameter) {
              const rhsVal = evaluateArenaExpression(arena, rhs, paramMap, db, scopeId);
              if (rhsVal !== null) {
                let foldedValue: ArenaValue | null = rhsVal;
                const match = name.match(/\[([\d,]+)\]$/);
                if (match) {
                  const indices = match[1].split(",").map(Number);
                  let current = foldedValue;
                  for (const idx of indices) {
                    if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                      current = current[idx - 1] as ArenaValue;
                    } else {
                      foldedValue = null;
                      break;
                    }
                  }
                  if (foldedValue !== null) {
                    foldedValue = current;
                  }
                }

                let numValue: number | null = null;
                if (typeof foldedValue === "number") {
                  numValue = foldedValue;
                } else if (typeof foldedValue === "boolean") {
                  numValue = foldedValue ? 1.0 : 0.0;
                }

                if (numValue !== null) {
                  const current = arena.getVarStartValue(varIdx);
                  if (current !== numValue) {
                    arena.setVarStartValue(varIdx, numValue);
                    changed = true;
                  }
                }
              }
            }
          } else if (arena.hasArrayElements(name)) {
            const rhsVal = evaluateArenaExpression(arena, rhs, paramMap, db, scopeId);
            if (rhsVal !== null && Array.isArray(rhsVal)) {
              const elementIndices = arena.getArrayElementIndices(name);
              for (const elemIdx of elementIndices) {
                const vv = arena.getVarVariability(elemIdx);
                if (vv === Variability.Constant || vv === Variability.Parameter) {
                  const elemName = arena.getVarName(elemIdx);
                  const match = elemName.match(/\[([\d,]+)\]$/);
                  if (match) {
                    const indices = match[1].split(",").map(Number);
                    let current: ArenaValue = rhsVal;
                    let valid = true;
                    for (const idx of indices) {
                      if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                        current = current[idx - 1];
                      } else {
                        valid = false;
                        break;
                      }
                    }
                    if (valid) {
                      let numValue: number | null = null;
                      if (typeof current === "number") {
                        numValue = current;
                      } else if (typeof current === "boolean") {
                        numValue = current ? 1.0 : 0.0;
                      }
                      if (numValue !== null) {
                        const currentStart = arena.getVarStartValue(elemIdx);
                        if (currentStart !== numValue) {
                          arena.setVarStartValue(elemIdx, numValue);
                          changed = true;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Phase 3: Substitute constant Name references in expressions with literals.
    // Walk all expressions and replace ExprKind.Name that refer to constant
    // variables with their resolved literal values.
    for (let e = 0; e < arena.exprCount; e++) {
      if (arena.getExprKind(e) !== ExprKind.Name) continue;
      const nameId = arena.getExprData1(e);
      const name = arena.interner.resolve(nameId);
      if (!name) continue;
      const varIdx = nameToIdx.get(name);
      if (varIdx === undefined) continue;
      const vv = arena.getVarVariability(varIdx);
      if (vv !== Variability.Constant) continue;
      // Evaluate the constant to a literal value
      const val = paramMap.get(name) ?? arena.getVarStartValue(varIdx);
      if (val !== undefined && typeof val === "number") {
        // Rewrite this expression slot in-place to a RealLiteral
        arena.setExprKind(e, ExprKind.RealLiteral);
        arena.setExprRealValue(e, val);
        changed = true;
      }
    }
  }

  return iterations;
}
