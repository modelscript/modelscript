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
import { ModelicaFunctionCallExpression, ModelicaNameExpression, ModelicaRealLiteral } from "../dae.js";
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
      if (args.length < 1 || !args[0]) return null;
      return egraphSimplify(args[0]);
    },
  ],

  [
    "ModelScript.CAS.expand",
    (args) => {
      if (args.length < 1 || !args[0]) return null;
      return expandExpr(args[0]);
    },
  ],

  [
    "ModelScript.CAS.normalize",
    (args) => {
      if (args.length < 1 || !args[0]) return null;
      return normalizeExpr(args[0]);
    },
  ],

  [
    "ModelScript.CAS.trigSimplify",
    (args) => {
      if (args.length < 1 || !args[0]) return null;
      return trigSimplify(args[0]);
    },
  ],

  [
    "ModelScript.CAS.trigExpand",
    (args) => {
      if (args.length < 1 || !args[0]) return null;
      return trigExpand(args[0]);
    },
  ],

  // ── Differentiation ──
  [
    "ModelScript.CAS.diff",
    (args) => {
      if (args.length < 2 || !args[0] || !args[1]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      if (args.length >= 3 && args[2]) {
        const n = getLiteralValue(args[2]);
        if (n !== null && n > 0) return nthDerivative(args[0], varName, n);
      }
      return simplifyExpr(differentiateExpr(args[0], varName));
    },
  ],

  // ── Integration ──
  [
    "ModelScript.CAS.integrate",
    (args) => {
      if (args.length < 2 || !args[0] || !args[1]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      return integrateExpr(args[0], varName);
    },
  ],

  // ── Solving ──
  [
    "ModelScript.CAS.solve",
    (args) => {
      if (args.length < 2 || !args[0] || !args[1]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      const solutions = solveForVariable(args[0], varName);
      // Return first solution (most useful for single-variable equations)
      return solutions.length > 0 ? (solutions[0] ?? null) : null;
    },
  ],

  [
    "ModelScript.CAS.solveAll",
    (args) => {
      if (args.length < 2 || !args[0] || !args[1]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      const solutions = solveForVariable(args[0], varName);
      if (solutions.length === 0) return null;
      // Return as an array-like nested expression
      return solutions.length === 1 ? (solutions[0] ?? null) : buildArray(solutions);
    },
  ],

  // ── Factoring ──
  [
    "ModelScript.CAS.factor",
    (args) => {
      if (args.length < 2 || !args[0] || !args[1]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      return factorQuadratic(args[0], varName);
    },
  ],

  // ── Taylor Series ──
  [
    "ModelScript.CAS.taylor",
    (args) => {
      if (args.length < 4 || !args[0] || !args[1] || !args[2] || !args[3]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      const point = getLiteralValue(args[2]);
      const order = getLiteralValue(args[3]);
      if (point === null || order === null) return null;
      return taylorSeries(args[0], varName, point, Math.round(order));
    },
  ],

  // ── Limit ──
  [
    "ModelScript.CAS.limit",
    (args) => {
      if (args.length < 3 || !args[0] || !args[1] || !args[2]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      const point = getLiteralValue(args[2]);
      if (point === null) return null;
      const result = limit(args[0], varName, point);
      return result !== null ? new ModelicaRealLiteral(result) : null;
    },
  ],

  // ── Degree ──
  [
    "ModelScript.CAS.degree",
    (args) => {
      if (args.length < 2 || !args[0] || !args[1]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      const terms = collectTerms(args[0], varName);
      const maxDeg = Math.max(0, ...terms.keys());
      return new ModelicaRealLiteral(maxDeg);
    },
  ],

  // ── Rational Roots ──
  [
    "ModelScript.CAS.roots",
    (args) => {
      if (args.length < 2 || !args[0] || !args[1]) return null;
      const varName = extractVarName(args[1]);
      if (!varName) return null;
      const roots = rationalRoots(args[0], varName);
      if (roots.length === 0) return null;
      return buildArray(roots.map((r) => new ModelicaRealLiteral(r)));
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
      input Real expr;
      output Real result;
      external "builtin";
    end simplify;

    function expand "Expand polynomial expressions (distribute multiplication)"
      input Real expr;
      output Real result;
      external "builtin";
    end expand;

    function normalize "Normalize to canonical form via E-Graph"
      input Real expr;
      output Real result;
      external "builtin";
    end normalize;

    function trigSimplify "Simplify using trigonometric identities"
      input Real expr;
      output Real result;
      external "builtin";
    end trigSimplify;

    function trigExpand "Expand trig expressions using addition formulas"
      input Real expr;
      output Real result;
      external "builtin";
    end trigExpand;

    function diff "Symbolic differentiation"
      input Real expr;
      input Real var "Variable to differentiate with respect to";
      input Integer n = 1 "Order of derivative";
      output Real result;
      external "builtin";
    end diff;

    function integrate "Symbolic anti-differentiation"
      input Real expr;
      input Real var "Variable to integrate with respect to";
      output Real result;
      external "builtin";
    end integrate;

    function solve "Solve expr = 0 for var (returns first solution)"
      input Real expr;
      input Real var "Variable to solve for";
      output Real result;
      external "builtin";
    end solve;

    function solveAll "Solve expr = 0 for var (returns all solutions)"
      input Real expr;
      input Real var "Variable to solve for";
      output Real[:] result;
      external "builtin";
    end solveAll;

    function factor "Factor a quadratic polynomial"
      input Real expr;
      input Real var;
      output Real result;
      external "builtin";
    end factor;

    function taylor "Taylor series expansion"
      input Real expr;
      input Real var;
      input Real point;
      input Integer order;
      output Real result;
      external "builtin";
    end taylor;

    function limit "Evaluate limit of expr as var -> point"
      input Real expr;
      input Real var;
      input Real point;
      output Real result;
      external "builtin";
    end limit;

    function degree "Get polynomial degree of expr in var"
      input Real expr;
      input Real var;
      output Integer result;
      external "builtin";
    end degree;

    function roots "Find rational roots of polynomial expr in var"
      input Real expr;
      input Real var;
      output Real[:] result;
      external "builtin";
    end roots;

  end CAS;
end ModelScript;
`;

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

function extractVarName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaNameExpression) return expr.name;
  if (expr && typeof expr === "object" && "name" in expr) {
    return (expr as { name: string }).name;
  }
  return null;
}

function buildArray(exprs: ModelicaExpression[]): ModelicaExpression {
  // For simplicity, return first element if only one, or construct
  // a function call to "array" with all elements
  if (exprs.length === 1) return exprs[0] ?? new ModelicaRealLiteral(0);
  return new ModelicaFunctionCallExpression("array", exprs);
}
