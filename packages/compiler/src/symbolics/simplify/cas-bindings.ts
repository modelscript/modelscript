// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica CAS bindings module for the Arena DAE representation.
 *
 * Provides a `ModelScript.CAS` package that exposes the CAS engine's
 * capabilities as Modelica-callable functions operating directly on
 * ArenaDAEBuilder expression IDs (numbers).
 */

import { ArenaDAEBuilder, ExprKind } from "../../dae-arena.js";
import { collectArenaTerms, getArenaLiteralValue, solveForVariableArena } from "../algebra/solve.js";
import { differentiateArenaExpr, simplifyArenaExpr } from "../calculus/derivative.js";
import { integrateArenaExpr, limitArena, nthDerivativeArena, taylorSeriesArena } from "../calculus/integrate.js";
import { egraphSimplify, trigExpand, trigSimplify } from "./egraph.js";
import { expandArenaExpr, normalizeArenaExpr } from "./expand.js";
import { factorQuadraticArena, rationalRootsArena } from "./factor.js";

// ─────────────────────────────────────────────────────────────────────
// Compile-Time CAS Operations
// ─────────────────────────────────────────────────────────────────────

/**
 * Registry of CAS functions that operate on Arena expression IDs.
 */
export const CAS_FUNCTIONS_ARENA = new Map<string, (arena: ArenaDAEBuilder, args: number[]) => number | null>([
  // ── Simplification ──
  [
    "ModelScript.CAS.simplify",
    (arena, args) => {
      const exprId = args[0];
      if (exprId === undefined || exprId < 0) return null;
      return egraphSimplify(arena, exprId);
    },
  ],

  [
    "ModelScript.CAS.expand",
    (arena, args) => {
      const exprId = args[0];
      if (exprId === undefined || exprId < 0) return null;
      return expandArenaExpr(arena, exprId);
    },
  ],

  [
    "ModelScript.CAS.normalize",
    (arena, args) => {
      const exprId = args[0];
      if (exprId === undefined || exprId < 0) return null;
      return normalizeArenaExpr(arena, exprId);
    },
  ],

  [
    "ModelScript.CAS.trigSimplify",
    (arena, args) => {
      const exprId = args[0];
      if (exprId === undefined || exprId < 0) return null;
      return trigSimplify(arena, exprId);
    },
  ],

  [
    "ModelScript.CAS.trigExpand",
    (arena, args) => {
      const exprId = args[0];
      if (exprId === undefined || exprId < 0) return null;
      return trigExpand(arena, exprId);
    },
  ],

  // ── Differentiation ──
  [
    "ModelScript.CAS.diff",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      if (exprId === undefined || exprId < 0 || !varName) return null;
      if (args.length >= 3 && args[2] !== undefined && args[2] >= 0) {
        const n = getArenaLiteralValue(arena, args[2]);
        if (n !== null && n > 0) return nthDerivativeArena(arena, exprId, varName, n);
      }
      return simplifyArenaExpr(arena, differentiateArenaExpr(arena, exprId, varName));
    },
  ],

  // ── Integration ──
  [
    "ModelScript.CAS.integrate",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      if (exprId === undefined || exprId < 0 || !varName) return null;
      return integrateArenaExpr(arena, exprId, varName);
    },
  ],

  // ── Solving ──
  [
    "ModelScript.CAS.solve",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      if (exprId === undefined || exprId < 0 || !varName) return null;
      const solutions = solveForVariableArena(arena, exprId, varName).map((s) => simplifyArenaExpr(arena, s));
      return solutions.length > 0 && solutions[0] !== undefined ? solutions[0] : null;
    },
  ],

  [
    "ModelScript.CAS.solveAll",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      if (exprId === undefined || exprId < 0 || !varName) return null;
      const solutions = solveForVariableArena(arena, exprId, varName).map((s) => simplifyArenaExpr(arena, s));
      if (solutions.length === 0) return null;
      return buildArrayArena(arena, solutions);
    },
  ],

  // ── Factoring ──
  [
    "ModelScript.CAS.factor",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      if (exprId === undefined || exprId < 0 || !varName) return null;
      return factorQuadraticArena(arena, exprId, varName);
    },
  ],

  // ── Taylor Series ──
  [
    "ModelScript.CAS.taylor",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      const pointExprId = args[2];
      const orderExprId = args[3];
      if (
        exprId === undefined ||
        exprId < 0 ||
        !varName ||
        pointExprId === undefined ||
        pointExprId < 0 ||
        orderExprId === undefined ||
        orderExprId < 0
      ) {
        return null;
      }
      const point = getArenaLiteralValue(arena, pointExprId);
      const order = getArenaLiteralValue(arena, orderExprId);
      if (point === null || order === null) return null;
      return taylorSeriesArena(arena, exprId, varName, point, Math.round(order));
    },
  ],

  // ── Limit ──
  [
    "ModelScript.CAS.limit",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      const pointExprId = args[2];
      if (exprId === undefined || exprId < 0 || !varName || pointExprId === undefined || pointExprId < 0) {
        return null;
      }
      const point = getArenaLiteralValue(arena, pointExprId);
      if (point === null) return null;
      const result = limitArena(arena, exprId, varName, point);
      return result !== null ? arena.addRealLiteral(result) : null;
    },
  ],

  // ── Degree ──
  [
    "ModelScript.CAS.degree",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      if (exprId === undefined || exprId < 0 || !varName) return null;
      const terms = collectArenaTerms(arena, exprId, varName);
      const maxDeg = Math.max(0, ...terms.keys());
      return arena.addRealLiteral(maxDeg);
    },
  ],

  // ── Rational Roots ──
  [
    "ModelScript.CAS.roots",
    (arena, args) => {
      const exprId = args[0];
      const varName = extractVarNameArena(arena, args[1]);
      if (exprId === undefined || exprId < 0 || !varName) return null;
      const roots = rationalRootsArena(arena, exprId, varName);
      if (roots.length === 0) return null;
      return buildArrayArena(
        arena,
        roots.map((r) => arena.addRealLiteral(r)),
      );
    },
  ],
]);

// ─────────────────────────────────────────────────────────────────────
// Compile-Time Dispatch
// ─────────────────────────────────────────────────────────────────────

/**
 * Attempt to evaluate a CAS function call at compile-time.
 * Returns the result expression ID, or null if it cannot be evaluated.
 */
export function evaluateCASFunctionArena(arena: ArenaDAEBuilder, functionName: string, args: number[]): number | null {
  const fn = CAS_FUNCTIONS_ARENA.get(functionName);
  if (!fn) return null;
  try {
    return fn(arena, args);
  } catch {
    return null;
  }
}

/**
 * Check if a function name is a CAS function.
 */
export function isCASFunctionArena(name: string): boolean {
  return CAS_FUNCTIONS_ARENA.has(name);
}

// ─────────────────────────────────────────────────────────────────────
// Modelica Package Declaration
// ─────────────────────────────────────────────────────────────────────

/**
 * The Modelica source for the ModelScript.CAS package.
 * This declares all CAS functions with their signatures for use
 * in Modelica models.
 */
export const MODELSCRIPT_CAS_PACKAGE = `
package ModelScript
  package CAS "Computer Algebra System"

    function simplify "Simplify an expression using E-Graph equality saturation"
      input Expression expr;
      output Expression result;
      external "builtin";
    end simplify;

    function expand "Expand polynomial expressions (distribute multiplication)"
      input Expression expr;
      output Expression result;
      external "builtin";
    end expand;

    function normalize "Normalize to canonical form via E-Graph"
      input Expression expr;
      output Expression result;
      external "builtin";
    end normalize;

    function trigSimplify "Simplify using trigonometric identities"
      input Expression expr;
      output Expression result;
      external "builtin";
    end trigSimplify;

    function trigExpand "Expand trig expressions using addition formulas"
      input Expression expr;
      output Expression result;
      external "builtin";
    end trigExpand;

    function diff "Symbolic differentiation"
      input Expression expr;
      input Expression var "Variable to differentiate with respect to (as an expression node)";
      input Integer n = 1 "Order of derivative";
      output Expression result;
      external "builtin";
    end diff;

    function integrate "Symbolic anti-differentiation"
      input Expression expr;
      input Expression var "Variable to integrate with respect to";
      output Expression result;
      external "builtin";
    end integrate;

    function solve "Solve expr = 0 for var (returns first solution)"
      input Expression expr;
      input Expression var "Variable to solve for";
      output Expression result;
      external "builtin";
    end solve;

    function solveAll "Solve expr = 0 for var (returns all solutions)"
      input Expression expr;
      input Expression var "Variable to solve for";
      output Expression[:] result;
      external "builtin";
    end solveAll;

    function factor "Factor a quadratic polynomial"
      input Expression expr;
      input Expression var;
      output Expression result;
      external "builtin";
    end factor;

    function taylor "Taylor series expansion"
      input Expression expr;
      input Expression var;
      input Real point;
      input Integer order;
      output Expression result;
      external "builtin";
    end taylor;

    function limit "Evaluate limit of expr as var -> point"
      input Expression expr;
      input Expression var;
      input Real point;
      output Expression result;
      external "builtin";
    end limit;

    function degree "Get polynomial degree of expr in var"
      input Expression expr;
      input Expression var;
      output Integer result;
      external "builtin";
    end degree;

    function roots "Find rational roots of polynomial expr in var (returns numeric roots)"
      input Expression expr;
      input Expression var;
      output Real[:] result;
      external "builtin";
    end roots;

  end CAS;
end ModelScript;
`;

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

function extractVarNameArena(arena: ArenaDAEBuilder, exprId: number | undefined): string | null {
  if (exprId === undefined || exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    return arena.interner.resolve(arena.getExprData1(exprId)) ?? null;
  }
  return null;
}

function buildArrayArena(arena: ArenaDAEBuilder, exprs: number[]): number {
  if (exprs.length === 1) return exprs[0] ?? arena.addRealLiteral(0);
  return arena.addCallExpr("array", exprs);
}
