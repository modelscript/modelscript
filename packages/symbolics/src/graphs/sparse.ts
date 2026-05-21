/* eslint-disable @typescript-eslint/prefer-for-of */
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @deprecated This module delegates to `@modelscript/compiler` for the
 * arena-native implementation. The legacy `computeJacobianSparsity` and
 * `computeHessianSparsity` functions that operated on `ModelicaDAE` are
 * preserved for backward compatibility. New code should use
 * `computeJacobianSparsityArena` and `computeHessianSparsityArena` directly.
 */

// Re-export all arena-native symbols from the compiler
export {
  buildCCS,
  computeHessianSparsityArena,
  computeJacobianSparsityArena,
  generateSparsityArraysC,
  type CCSMatrix,
} from "@modelscript/compiler";

// ── Legacy API (backward compatibility) ──

import { buildCCS, StaticTapeBuilder, type CCSMatrix } from "@modelscript/compiler";
import { ModelicaArrayEquation, type ModelicaDAE, type ModelicaExpression } from "../systems/index.js";

/** Extract derivative name (like der(x)) from expression without depending on external module. */
function extractDer(expr: ModelicaExpression): string | null {
  if (expr && typeof expr === "object" && "functionName" in expr && "args" in expr) {
    const fn = (expr as { functionName: string }).functionName;
    if (
      fn === "der" &&
      Array.isArray((expr as { args: unknown[] }).args) &&
      (expr as { args: unknown[] }).args.length === 1
    ) {
      const a = (expr as { args: unknown[] }).args[0];
      if (a && typeof a === "object" && "name" in a) return (a as { name: string }).name;
    }
  }
  return null;
}

/**
 * @deprecated Use `computeJacobianSparsityArena` from `@modelscript/compiler` instead.
 */
export function computeJacobianSparsity(dae: ModelicaDAE): { ccs: CCSMatrix; states: string[] } {
  const derEqs: { state: string; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.arenaEquations()) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);

    if (eq instanceof ModelicaArrayEquation) {
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? se.expression2 : se.expression1;
      const v = dae.arenaGetVarByName(baseName);
      const dims = v?.arrayDimensions ?? [];
      const size = dims.length > 0 ? dims.reduce((a: number, b: number) => a * b, 1) : 1;
      if (baseName.includes("[") || size === 1) {
        derEqs.push({ state: baseName, rhs });
      } else {
        for (let i = 0; i < size; i++) {
          derEqs.push({ state: `${baseName}[${i + 1}]`, rhs });
        }
      }
      continue;
    }

    if (ld) derEqs.push({ state: ld, rhs: se.expression2 });
    else if (rd) derEqs.push({ state: rd, rhs: se.expression1 });
  }

  const tape = new StaticTapeBuilder();
  const rowsDeps: Set<string>[] = [];
  const indepVars = new Set<string>();

  for (const eq of derEqs) {
    indepVars.add(eq.state);
  }

  for (const eq of derEqs) {
    const outIdx = tape.walk(eq.rhs);
    const deps = tape.getDependencies(outIdx);

    // Keep only dependencies that are in our independent variables list
    const filteredDeps = new Set<string>();
    for (const d of deps) {
      if (indepVars.has(d)) filteredDeps.add(d);
    }

    rowsDeps.push(filteredDeps);
  }

  const states = Array.from(indepVars);
  return {
    ccs: buildCCS(rowsDeps, states),
    states,
  };
}

/**
 * @deprecated Use `computeHessianSparsityArena` from `@modelscript/compiler` instead.
 */
export function computeHessianSparsity(dae: ModelicaDAE): { ccs: CCSMatrix; states: string[] } {
  const derEqs: { state: string; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.arenaEquations()) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);

    if (eq instanceof ModelicaArrayEquation) {
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? se.expression2 : se.expression1;
      const v = dae.arenaGetVarByName(baseName);
      const dims = v?.arrayDimensions ?? [];
      const size = dims.length > 0 ? dims.reduce((a: number, b: number) => a * b, 1) : 1;
      if (baseName.includes("[") || size === 1) {
        derEqs.push({ state: baseName, rhs });
      } else {
        for (let i = 0; i < size; i++) {
          derEqs.push({ state: `${baseName}[${i + 1}]`, rhs });
        }
      }
      continue;
    }

    if (ld) derEqs.push({ state: ld, rhs: se.expression2 });
    else if (rd) derEqs.push({ state: rd, rhs: se.expression1 });
  }

  const tape = new StaticTapeBuilder();
  const indepVars = new Set<string>();
  for (const eq of derEqs) indepVars.add(eq.state);
  const states = Array.from(indepVars);

  const eqIndices: number[] = [];
  for (const eq of derEqs) {
    eqIndices.push(tape.walk(eq.rhs));
  }

  let lagrangianNode = tape.pushOp({ type: "const", val: 0.0 });
  for (let i = 0; i < eqIndices.length; i++) {
    const lamVar = tape.pushOp({ type: "var", name: `LAMBDA_${i}` });
    const term = tape.pushOp({ type: "mul", a: lamVar, b: eqIndices[i]! }); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    lagrangianNode = tape.pushOp({ type: "add", a: lagrangianNode, b: term });
  }

  // Per-op dependency tracking via the DOD tape layout
  const TAPE_STRIDE = 4;
  const TAPE_OP_KIND = 0;
  const TAPE_DATA1 = 1;
  const TAPE_DATA2 = 2;

  const depsForOp = new Map<number, Set<string>>();
  for (let i = 0; i < tape.length; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = tape.opData[offset + TAPE_OP_KIND]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const a = tape.opData[offset + TAPE_DATA1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const b = tape.opData[offset + TAPE_DATA2]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const d = new Set<string>();
    // TapeOpKind.Var = 1
    if (kind === 1 && indepVars.has(tape.interner.resolve(a) ?? "")) {
      d.add(tape.interner.resolve(a) ?? "");
    } else {
      if (kind >= 2 && kind <= 6) {
        // Binary: Add, Sub, Mul, Div, Pow
        const ad = depsForOp.get(a);
        if (ad) for (const v of ad) d.add(v);
        const bd = depsForOp.get(b);
        if (bd) for (const v of bd) d.add(v);
      } else if (kind >= 7 && kind <= 13) {
        // Unary: Neg, Sin, Cos, Tan, Exp, Log, Sqrt
        const ad = depsForOp.get(a);
        if (ad) for (const v of ad) d.add(v);
      }
    }
    depsForOp.set(i, d);
  }

  // Suppress unused variable warning
  void lagrangianNode;

  const interactions = new Map<string, Set<string>>();
  for (const s of states) interactions.set(s, new Set([s]));

  for (let i = 0; i < tape.length; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = tape.opData[offset + TAPE_OP_KIND]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const a = tape.opData[offset + TAPE_DATA1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const b = tape.opData[offset + TAPE_DATA2]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

    // Binary nonlinear (Mul=4, Div=5, Pow=6)
    if (kind === 4 || kind === 5 || kind === 6) {
      const ad = depsForOp.get(a);
      const bd = depsForOp.get(b);
      if (ad && bd) {
        for (const v1 of ad) {
          for (const v2 of bd) {
            interactions.get(v1)?.add(v2);
            interactions.get(v2)?.add(v1);
          }
        }
      }
    }

    // Nonlinear operators (Sin=8..Sqrt=13, Mul=4, Div=5, Pow=6)
    if ((kind >= 4 && kind <= 6) || (kind >= 8 && kind <= 13)) {
      const ad = depsForOp.get(a);
      if (ad) {
        for (const v1 of ad) {
          for (const v2 of ad) {
            interactions.get(v1)?.add(v2);
          }
        }
      }
    }
  }

  const rowsDeps: Set<string>[] = [];
  for (let r = 0; r < states.length; r++) {
    const rowId = states[r]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const d = new Set<string>();
    for (let c = 0; c <= r; c++) {
      const colId = states[c]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (interactions.get(rowId)?.has(colId)) {
        d.add(colId);
      }
    }
    rowsDeps.push(d);
  }

  return {
    ccs: buildCCS(rowsDeps, states),
    states,
  };
}
