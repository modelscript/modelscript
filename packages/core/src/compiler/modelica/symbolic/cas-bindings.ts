// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica CAS bindings module.
 *
 * Provides a `ModelScript.CAS` package that exposes the CAS engine's
 * capabilities as Modelica-callable functions. These functions operate
 * on ModelicaExpression ASTs at compile-time (during flattening) and
 * can be used in annotations, parameter evaluation, and symbolic
 * transformations.
 *
 * Runtime bindings are registered via `registerCASFunctions()` which
 * hooks into the ExpressionEvaluator's `functionLookup` callback.
 */

import type { ModelicaExpression } from "../dae.js";
import {
  ModelicaExpressionValue,
  ModelicaFunctionCallExpression,
  ModelicaNameExpression,
  ModelicaRealLiteral,
} from "../dae.js";
import { differentiateExpr, simplifyExpr } from "../symbolic-diff.js";
import { egraphSimplify } from "./egraph.js";
import { collectTerms, expandExpr, getLiteralValue, normalizeExpr } from "./expand.js";
import { factorQuadratic, rationalRoots } from "./factor.js";
import { integrateExpr, limit, nthDerivative, taylorSeries } from "./integrate.js";
import { solveForVariable } from "./solve.js";
import { trigExpand, trigSimplify } from "./trigsimp.js";

// ─────────────────────────────────────────────────────────────────────
// Compile-Time CAS Operations
// ─────────────────────────────────────────────────────────────────────

/**
 * Registry of CAS functions that operate on ModelicaExpression ASTs.
 * These are invoked at compile-time during flattening when the
 * function name matches `ModelScript.CAS.*`.
 */
export const CAS_FUNCTIONS = new Map<string, (args: ModelicaExpression[]) => ModelicaExpression | null>([
  // ── Simplification ──
  [
    "ModelScript.CAS.simplify",
    (args) => {
      const expr = unwrapExpr(args[0]);
      if (!expr) return null;
      return new ModelicaExpressionValue(egraphSimplify(expr));
    },
  ],

  [
    "ModelScript.CAS.expand",
    (args) => {
      const expr = unwrapExpr(args[0]);
      if (!expr) return null;
      return new ModelicaExpressionValue(expandExpr(expr));
    },
  ],

  [
    "ModelScript.CAS.normalize",
    (args) => {
      const expr = unwrapExpr(args[0]);
      if (!expr) return null;
      return new ModelicaExpressionValue(normalizeExpr(expr));
    },
  ],

  [
    "ModelScript.CAS.trigSimplify",
    (args) => {
      const expr = unwrapExpr(args[0]);
      if (!expr) return null;
      return new ModelicaExpressionValue(trigSimplify(expr));
    },
  ],

  [
    "ModelScript.CAS.trigExpand",
    (args) => {
      const expr = unwrapExpr(args[0]);
      if (!expr) return null;
      return new ModelicaExpressionValue(trigExpand(expr));
    },
  ],

  // ── Differentiation ──
  [
    "ModelScript.CAS.diff",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      if (!expr || !varName) return null;
      if (args.length >= 3 && args[2]) {
        const n = getLiteralValue(args[2]);
        if (n !== null && n > 0) return new ModelicaExpressionValue(nthDerivative(expr, varName, n));
      }
      return new ModelicaExpressionValue(simplifyExpr(differentiateExpr(expr, varName)));
    },
  ],

  // ── Integration ──
  [
    "ModelScript.CAS.integrate",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      if (!expr || !varName) return null;
      const res = integrateExpr(expr, varName);
      return res ? new ModelicaExpressionValue(res) : null;
    },
  ],

  // ── Solving ──
  [
    "ModelScript.CAS.solve",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      if (!expr || !varName) return null;
      const solutions = solveForVariable(expr, varName);
      // Return first solution (most useful for single-variable equations)
      return solutions.length > 0 && solutions[0] ? new ModelicaExpressionValue(solutions[0]) : null;
    },
  ],

  [
    "ModelScript.CAS.solveAll",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      if (!expr || !varName) return null;
      const solutions = solveForVariable(expr, varName);
      if (solutions.length === 0) return null;
      // Return as an array of expressions
      return buildArray(solutions.map((s) => new ModelicaExpressionValue(s)));
    },
  ],

  // ── Factoring ──
  [
    "ModelScript.CAS.factor",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      if (!expr || !varName) return null;
      const res = factorQuadratic(expr, varName);
      return res ? new ModelicaExpressionValue(res) : null;
    },
  ],

  // ── Taylor Series ──
  [
    "ModelScript.CAS.taylor",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      const pointExpr = unwrapExpr(args[2]);
      const orderExpr = unwrapExpr(args[3]);
      if (!expr || !varName || !pointExpr || !orderExpr) return null;
      const point = getLiteralValue(pointExpr);
      const order = getLiteralValue(orderExpr);
      if (point === null || order === null) return null;
      return new ModelicaExpressionValue(taylorSeries(expr, varName, point, Math.round(order)));
    },
  ],

  // ── Limit ──
  [
    "ModelScript.CAS.limit",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      const pointExpr = unwrapExpr(args[2]);
      if (!expr || !varName || !pointExpr) return null;
      const point = getLiteralValue(pointExpr);
      if (point === null) return null;
      const result = limit(expr, varName, point);
      return result !== null ? new ModelicaExpressionValue(new ModelicaRealLiteral(result)) : null;
    },
  ],

  // ── Degree ──
  [
    "ModelScript.CAS.degree",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      if (!expr || !varName) return null;
      const terms = collectTerms(expr, varName);
      const maxDeg = Math.max(0, ...terms.keys());
      return new ModelicaRealLiteral(maxDeg); // Integers are fine to return as literals
    },
  ],

  // ── Rational Roots ──
  [
    "ModelScript.CAS.roots",
    (args) => {
      const expr = unwrapExpr(args[0]);
      const varName = extractVarName(unwrapExpr(args[1]));
      if (!expr || !varName) return null;
      const roots = rationalRoots(expr, varName);
      if (roots.length === 0) return null;
      return buildArray(roots.map((r) => new ModelicaRealLiteral(r))); // Return numeric roots as array
    },
  ],
]);

// ─────────────────────────────────────────────────────────────────────
// Compile-Time Dispatch
// ─────────────────────────────────────────────────────────────────────

/**
 * Attempt to evaluate a CAS function call at compile-time.
 * Returns the result expression, or null if the function is not a CAS function.
 */
export function evaluateCASFunction(functionName: string, args: ModelicaExpression[]): ModelicaExpression | null {
  const fn = CAS_FUNCTIONS.get(functionName);
  if (!fn) return null;
  try {
    return fn(args);
  } catch {
    return null; // CAS operation failed gracefully
  }
}

/**
 * Check if a function name is a CAS function.
 */
export function isCASFunction(name: string): boolean {
  return CAS_FUNCTIONS.has(name);
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

function extractVarName(expr: ModelicaExpression | null | undefined): string | null {
  if (!expr) return null;
  if (expr instanceof ModelicaNameExpression) return expr.name;
  if (typeof expr === "object" && "name" in expr) {
    return (expr as { name: string }).name;
  }
  return null;
}

function unwrapExpr(expr: ModelicaExpression | null | undefined): ModelicaExpression | null {
  if (!expr) return null;
  if (expr instanceof ModelicaExpressionValue) return expr.value;
  return expr;
}

function buildArray(exprs: ModelicaExpression[]): ModelicaExpression {
  // For simplicity, return first element if only one, or construct
  // a function call to "array" with all elements
  if (exprs.length === 1) return exprs[0] ?? new ModelicaRealLiteral(0);
  return new ModelicaFunctionCallExpression("array", exprs);
}
