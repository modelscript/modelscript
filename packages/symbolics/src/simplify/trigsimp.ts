// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Trigonometric simplification via E-Graph rewrite rules.
 *
 * Extends the default E-Graph rule set with additional trig identities
 * and provides a high-level `trigSimplify` function.
 */

import type { ModelicaExpression } from "../systems/index.js";
import { BackoffScheduler, DEFAULT_RULES, EGraph, rewrite, runEqualitySaturation, type RewriteRule } from "./egraph.js";

// ─────────────────────────────────────────────────────────────────────
// Extended Trig Rewrite Rules
// ─────────────────────────────────────────────────────────────────────

/** Half-angle formulas */
const halfAngleRules: RewriteRule[] = [
  // sin²(x) = (1 - cos(2x))/2
  rewrite("sin2-half", "(pow (fn:sin ?x) 2)", "(div (sub 1 (fn:cos (mul 2 ?x))) 2)"),
  // cos²(x) = (1 + cos(2x))/2
  rewrite("cos2-half", "(pow (fn:cos ?x) 2)", "(div (add 1 (fn:cos (mul 2 ?x))) 2)"),
];

/** Sum-to-product formulas */
const sumToProductRules: RewriteRule[] = [
  // sin(a) + sin(b) = 2 sin((a+b)/2) cos((a-b)/2)
  rewrite(
    "sin-sum-to-prod",
    "(add (fn:sin ?a) (fn:sin ?b))",
    "(mul 2 (mul (fn:sin (div (add ?a ?b) 2)) (fn:cos (div (sub ?a ?b) 2))))",
  ),
  // cos(a) + cos(b) = 2 cos((a+b)/2) cos((a-b)/2)
  rewrite(
    "cos-sum-to-prod",
    "(add (fn:cos ?a) (fn:cos ?b))",
    "(mul 2 (mul (fn:cos (div (add ?a ?b) 2)) (fn:cos (div (sub ?a ?b) 2))))",
  ),
];

/** Product-to-sum formulas */
const productToSumRules: RewriteRule[] = [
  // sin(a)*cos(b) = (sin(a+b) + sin(a-b))/2
  rewrite(
    "sin-cos-prod-to-sum",
    "(mul (fn:sin ?a) (fn:cos ?b))",
    "(div (add (fn:sin (add ?a ?b)) (fn:sin (sub ?a ?b))) 2)",
  ),
  // cos(a)*cos(b) = (cos(a-b) + cos(a+b))/2
  rewrite(
    "cos-cos-prod-to-sum",
    "(mul (fn:cos ?a) (fn:cos ?b))",
    "(div (add (fn:cos (sub ?a ?b)) (fn:cos (add ?a ?b))) 2)",
  ),
  // sin(a)*sin(b) = (cos(a-b) - cos(a+b))/2
  rewrite(
    "sin-sin-prod-to-sum",
    "(mul (fn:sin ?a) (fn:sin ?b))",
    "(div (sub (fn:cos (sub ?a ?b)) (fn:cos (add ?a ?b))) 2)",
  ),
];

/** Inverse trig identities */
const inverseTrigRules: RewriteRule[] = [
  rewrite("sin-asin", "(fn:sin (fn:asin ?x))", "?x"),
  rewrite("cos-acos", "(fn:cos (fn:acos ?x))", "?x"),
  rewrite("tan-atan", "(fn:tan (fn:atan ?x))", "?x"),
];

/** Addition formulas for trig expansion */
const trigAdditionRules: RewriteRule[] = [
  // sin(a+b) = sin(a)cos(b) + cos(a)sin(b)
  rewrite("sin-add", "(fn:sin (add ?a ?b))", "(add (mul (fn:sin ?a) (fn:cos ?b)) (mul (fn:cos ?a) (fn:sin ?b)))"),
  // cos(a+b) = cos(a)cos(b) - sin(a)sin(b)
  rewrite("cos-add", "(fn:cos (add ?a ?b))", "(sub (mul (fn:cos ?a) (fn:cos ?b)) (mul (fn:sin ?a) (fn:sin ?b)))"),
  // tan(a+b) can be derived but is complex, omitted for now
];

/** Hyperbolic identities */
const hyperbolicRules: RewriteRule[] = [
  rewrite("sinh-neg", "(fn:sinh (neg ?x))", "(neg (fn:sinh ?x))"),
  rewrite("cosh-neg", "(fn:cosh (neg ?x))", "(fn:cosh ?x)"),
  rewrite("tanh-neg", "(fn:tanh (neg ?x))", "(neg (fn:tanh ?x))"),
  rewrite("sinh-zero", "(fn:sinh 0)", "0"),
  rewrite("cosh-zero", "(fn:cosh 0)", "1"),
  rewrite("tanh-zero", "(fn:tanh 0)", "0"),
];

/**
 * All trigonometric simplification rules (extends defaults).
 */
export const TRIG_RULES: RewriteRule[] = [
  ...DEFAULT_RULES,
  ...halfAngleRules,
  ...sumToProductRules,
  ...productToSumRules,
  ...inverseTrigRules,
  ...hyperbolicRules,
];

/**
 * Full trig expansion rules (addition formulas).
 */
export const TRIG_EXPAND_RULES: RewriteRule[] = [...DEFAULT_RULES, ...trigAdditionRules];

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Simplify an expression using extended trigonometric identities.
 * Uses the E-Graph equality saturation engine with trig-specific rules.
 */
export function trigSimplify(expr: ModelicaExpression, maxIterations = 30): ModelicaExpression {
  const egraph = new EGraph();
  const rootId = egraph.add(expr);
  runEqualitySaturation(egraph, TRIG_RULES, {
    maxIterations,
    scheduler: new BackoffScheduler(),
  });
  return egraph.extract(rootId);
}

/**
 * Expand trigonometric expressions using addition formulas.
 * sin(a+b) → sin(a)cos(b) + cos(a)sin(b), etc.
 */
export function trigExpand(expr: ModelicaExpression, maxIterations = 20): ModelicaExpression {
  const egraph = new EGraph();
  const rootId = egraph.add(expr);
  runEqualitySaturation(egraph, TRIG_EXPAND_RULES, {
    maxIterations,
    scheduler: new BackoffScheduler(),
  });
  return egraph.extract(rootId);
}
