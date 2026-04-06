// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic equation isolation engine.
 *
 * Given an equation `lhs = rhs` and a target variable `v`,
 * attempts to analytically rewrite it as `v = f(...)`.
 *
 * Strategies (in priority order):
 *   1. Linear isolation: decompose into A·v + B = 0, yield v = −B/A
 *   2. Single-occurrence inversion: if v appears exactly once, recursively
 *      invert the expression tree (unwrap +, −, ×, ÷, known functions)
 *   3. Fallback: return null (equation stays implicit)
 *
 * Used by the BLT module to resolve algebraic loops that the naive
 * structural check (`isExplicitlySolvableFor`) cannot handle.
 */

import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "@modelscript/modelica-ast";
import type { ModelicaExpression } from "./dae.js";
import {
  ModelicaBinaryExpression,
  ModelicaDAE,
  ModelicaFunctionCallExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaRealVariable,
  ModelicaSimpleEquation,
  ModelicaUnaryExpression,
} from "./dae.js";
import { add, differentiateExpr, div, isOne, isZero, mul, ONE, simplifyExpr, sub, ZERO } from "./symbolic-diff.js";

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Check whether an expression tree references a given variable name.
 */
export function containsVariable(expr: ModelicaExpression, varName: string): boolean {
  if (expr instanceof ModelicaNameExpression) {
    return expr.name === varName;
  }
  // Variable nodes also have a .name
  if (expr && typeof expr === "object" && "name" in expr) {
    if ((expr as { name: string }).name === varName) return true;
  }

  if (expr instanceof ModelicaUnaryExpression) {
    return containsVariable(expr.operand, varName);
  }
  if (expr instanceof ModelicaBinaryExpression) {
    return containsVariable(expr.operand1, varName) || containsVariable(expr.operand2, varName);
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    return (expr.args as ModelicaExpression[]).some((a) => containsVariable(a, varName));
  }
  return false;
}

/**
 * Count the number of occurrences of a variable in an expression tree.
 */
function countOccurrences(expr: ModelicaExpression, varName: string): number {
  if (expr instanceof ModelicaNameExpression) {
    return expr.name === varName ? 1 : 0;
  }
  if (expr && typeof expr === "object" && "name" in expr) {
    if ((expr as { name: string }).name === varName) return 1;
  }
  if (expr instanceof ModelicaUnaryExpression) {
    return countOccurrences(expr.operand, varName);
  }
  if (expr instanceof ModelicaBinaryExpression) {
    return countOccurrences(expr.operand1, varName) + countOccurrences(expr.operand2, varName);
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    return (expr.args as ModelicaExpression[]).reduce((sum, a) => sum + countOccurrences(a, varName), 0);
  }
  return 0;
}

/**
 * Substitute all occurrences of `varName` with `replacement` in an expression.
 */
export function substituteVariable(
  expr: ModelicaExpression,
  varName: string,
  replacement: ModelicaExpression,
): ModelicaExpression {
  if (expr instanceof ModelicaNameExpression && expr.name === varName) {
    return replacement;
  }
  if (expr && typeof expr === "object" && "name" in expr) {
    if ((expr as { name: string }).name === varName) return replacement;
  }

  if (expr instanceof ModelicaUnaryExpression) {
    const op = substituteVariable(expr.operand, varName, replacement);
    if (op === expr.operand) return expr;
    return new ModelicaUnaryExpression(expr.operator, op);
  }
  if (expr instanceof ModelicaBinaryExpression) {
    const l = substituteVariable(expr.operand1, varName, replacement);
    const r = substituteVariable(expr.operand2, varName, replacement);
    if (l === expr.operand1 && r === expr.operand2) return expr;
    return new ModelicaBinaryExpression(expr.operator, l, r);
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    const args = (expr.args as ModelicaExpression[]).map((a) => substituteVariable(a, varName, replacement));
    return new ModelicaFunctionCallExpression(expr.functionName, args);
  }
  return expr;
}

/**
 * Extract linear coefficients A and B such that `expr = A·v + B`
 * where A and B are independent of v.
 *
 * Uses symbolic differentiation: A = ∂expr/∂v, B = expr|_{v=0}.
 * Verifies that A does not depend on v (true linearity check).
 *
 * @returns {A, B} if expr is linear in v, or null otherwise.
 */
export function extractLinearCoefficients(
  expr: ModelicaExpression,
  varName: string,
): { A: ModelicaExpression; B: ModelicaExpression } | null {
  if (!containsVariable(expr, varName)) {
    // expr is entirely independent of v — it's "linear" with A=0
    return null; // Not useful for isolation (A=0 means v doesn't appear)
  }

  // A = ∂expr/∂v (simplified)
  const A = simplifyExpr(differentiateExpr(expr, varName));

  // If A still contains v, the expression is non-linear in v
  if (containsVariable(A, varName)) {
    return null;
  }

  // B = expr|_{v=0}
  const B = simplifyExpr(substituteVariable(expr, varName, ZERO));

  return { A, B };
}

/**
 * Extract quadratic coefficients A, B, C such that `expr = A v^2 + B v + C`
 * where A, B, C are independent of v.
 *
 * @returns {A, B, C} if expr is exactly quadratic in v, or null otherwise.
 */
export function extractQuadraticCoefficients(
  expr: ModelicaExpression,
  varName: string,
): { A: ModelicaExpression; B: ModelicaExpression; C: ModelicaExpression } | null {
  if (!containsVariable(expr, varName)) return null;

  // C = expr|_{v=0}
  const C = simplifyExpr(substituteVariable(expr, varName, ZERO));

  // D1 = ∂expr/∂v = 2Av + B
  const D1 = simplifyExpr(differentiateExpr(expr, varName));

  // B = D1|_{v=0}
  const B = simplifyExpr(substituteVariable(D1, varName, ZERO));

  // D2 = ∂²expr/∂v² = 2A
  const D2 = simplifyExpr(differentiateExpr(D1, varName));

  // If second derivative still depends on v, it is higher-order or transcendental
  if (containsVariable(D2, varName)) {
    return null;
  }

  const TWO = new ModelicaRealLiteral(2.0);
  const A = simplifyExpr(div(D2, TWO));

  // If A=0, it is actually linear, not quadratic.
  if (isZero(A)) {
    return null;
  }

  // D3 = ∂³expr/∂v³ must be completely zero. If it was transcendental
  // but D2 somehow didn't contain v, check D3 just in case, though mathematically
  // if D2 is a constant w.r.t v, D3 is 0.
  const D3 = simplifyExpr(differentiateExpr(D2, varName));
  if (!isZero(D3)) return null;

  return { A, B, C };
}

/**
 * Extract trigonometric coefficients A, B, C such that `expr = A sin(v) + B cos(v) + C`
 * where A, B, C are independent of v.
 *
 * Uses a structural recursive walk to decompose the expression, guaranteeing robustness
 * without relying on a full algebraic simplification engine.
 */
export function extractTrigonometricCoefficients(
  expr: ModelicaExpression,
  varName: string,
): { A: ModelicaExpression; B: ModelicaExpression; C: ModelicaExpression } | null {
  if (!containsVariable(expr, varName)) return null;

  function decompose(
    node: ModelicaExpression,
  ): { A: ModelicaExpression; B: ModelicaExpression; C: ModelicaExpression } | null {
    if (!containsVariable(node, varName)) {
      return { A: ZERO, B: ZERO, C: node };
    }

    if (node instanceof ModelicaFunctionCallExpression) {
      let fnName = "";
      if (typeof node.functionName === "string") {
        fnName = node.functionName;
      } else if (
        node.functionName &&
        typeof node.functionName === "object" &&
        "name" in node.functionName &&
        typeof (node.functionName as Record<string, unknown>).name === "string"
      ) {
        fnName = (node.functionName as Record<string, unknown>).name as string;
      }

      if (fnName === "sin") {
        const arg = node.args[0];
        if (arg && arg instanceof ModelicaNameExpression && arg.name === varName) {
          return { A: ONE, B: ZERO, C: ZERO };
        }
      }
      if (fnName === "cos") {
        const arg = node.args[0];
        if (arg && arg instanceof ModelicaNameExpression && arg.name === varName) {
          return { A: ZERO, B: ONE, C: ZERO };
        }
      }
      return null;
    }

    if (node instanceof ModelicaUnaryExpression) {
      if (node.operator === ModelicaUnaryOperator.UNARY_MINUS) {
        const inner = decompose(node.operand);
        if (!inner) return null;
        return {
          A: simplifyExpr(negate(inner.A)),
          B: simplifyExpr(negate(inner.B)),
          C: simplifyExpr(negate(inner.C)),
        };
      }
      return null;
    }

    if (node instanceof ModelicaBinaryExpression) {
      const leftHasV = containsVariable(node.operand1, varName);
      const rightHasV = containsVariable(node.operand2, varName);

      if (
        node.operator === ModelicaBinaryOperator.ADDITION ||
        node.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION
      ) {
        const l = decompose(node.operand1);
        const r = decompose(node.operand2);
        if (!l || !r) return null;
        return {
          A: simplifyExpr(add(l.A, r.A)),
          B: simplifyExpr(add(l.B, r.B)),
          C: simplifyExpr(add(l.C, r.C)),
        };
      }

      if (
        node.operator === ModelicaBinaryOperator.SUBTRACTION ||
        node.operator === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION
      ) {
        const l = decompose(node.operand1);
        const r = decompose(node.operand2);
        if (!l || !r) return null;
        return {
          A: simplifyExpr(sub(l.A, r.A)),
          B: simplifyExpr(sub(l.B, r.B)),
          C: simplifyExpr(sub(l.C, r.C)),
        };
      }

      if (
        node.operator === ModelicaBinaryOperator.MULTIPLICATION ||
        node.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
      ) {
        if (!leftHasV) {
          const r = decompose(node.operand2);
          if (!r) return null;
          return {
            A: simplifyExpr(mul(node.operand1, r.A)),
            B: simplifyExpr(mul(node.operand1, r.B)),
            C: simplifyExpr(mul(node.operand1, r.C)),
          };
        }
        if (!rightHasV) {
          const l = decompose(node.operand1);
          if (!l) return null;
          return {
            A: simplifyExpr(mul(node.operand2, l.A)),
            B: simplifyExpr(mul(node.operand2, l.B)),
            C: simplifyExpr(mul(node.operand2, l.C)),
          };
        }
        return null;
      }

      if (
        node.operator === ModelicaBinaryOperator.DIVISION ||
        node.operator === ModelicaBinaryOperator.ELEMENTWISE_DIVISION
      ) {
        if (!rightHasV) {
          const l = decompose(node.operand1);
          if (!l) return null;
          return {
            A: simplifyExpr(div(l.A, node.operand2)),
            B: simplifyExpr(div(l.B, node.operand2)),
            C: simplifyExpr(div(l.C, node.operand2)),
          };
        }
        return null;
      }
    }

    return null;
  }

  const result = decompose(expr);
  if (!result) return null;

  if (isZero(result.A) && isZero(result.B)) {
    return null;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// AST Decomposition Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Flattens an expression tree of additions and subtractions into a list of additive terms.
 * e.g. `A + B - C` -> `[A, B, -C]`
 */
function getAddends(expr: ModelicaExpression): ModelicaExpression[] {
  if (expr instanceof ModelicaBinaryExpression) {
    if (
      expr.operator === ModelicaBinaryOperator.ADDITION ||
      expr.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION
    ) {
      return [...getAddends(expr.operand1), ...getAddends(expr.operand2)];
    }
    if (
      expr.operator === ModelicaBinaryOperator.SUBTRACTION ||
      expr.operator === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION
    ) {
      const rightAddends = getAddends(expr.operand2).map((a) => simplifyExpr(negate(a)));
      return [...getAddends(expr.operand1), ...rightAddends];
    }
  }
  return [expr];
}

/**
 * Flattens an expression tree of multiplications and division into a list of multiplicative factors.
 * Divisions are currently kept intact or turned into `1/X`.
 * e.g. `A * B` -> `[A, B]`
 */
function getFactors(expr: ModelicaExpression): ModelicaExpression[] {
  if (expr instanceof ModelicaBinaryExpression) {
    if (
      expr.operator === ModelicaBinaryOperator.MULTIPLICATION ||
      expr.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
    ) {
      return [...getFactors(expr.operand1), ...getFactors(expr.operand2)];
    }
    if (
      expr.operator === ModelicaBinaryOperator.DIVISION ||
      expr.operator === ModelicaBinaryOperator.ELEMENTWISE_DIVISION
    ) {
      // 1/X is not flattened into factors deeply yet to avoid losing the division semantic
      return [
        ...getFactors(expr.operand1),
        new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, ONE, expr.operand2),
      ];
    }
  }
  return [expr];
}

/**
 * Extract Lambert W coefficients A, B, C such that `expr = A * v * exp(B * v) + C`
 * where A, B, C are independent of v.
 */
export function extractLambertWCoefficients(
  expr: ModelicaExpression,
  varName: string,
): { A: ModelicaExpression; B: ModelicaExpression; C: ModelicaExpression } | null {
  if (!containsVariable(expr, varName)) return null;

  const terms = getAddends(expr);
  const vTerms = terms.filter((t) => containsVariable(t, varName));
  if (vTerms.length !== 1) return null; // We only support a single additive term containing v

  const lambertTerm = vTerms[0];
  if (!lambertTerm) return null;
  const cTerms = terms.filter((t) => !containsVariable(t, varName));
  const C = simplifyExpr(cTerms.length > 0 ? cTerms.reduce((a, b) => add(a, b)) : ZERO);

  const factors = getFactors(lambertTerm);
  const vFactors = factors.filter((f) => containsVariable(f, varName));

  if (vFactors.length !== 2) return null; // We need exactly `v` and `exp(B * v)`

  let linearFactor: ModelicaExpression | null = null;
  let expFactor: ModelicaExpression | null = null;

  for (const f of vFactors) {
    if (f instanceof ModelicaFunctionCallExpression) {
      let fnName = "";
      if (typeof f.functionName === "string") {
        fnName = f.functionName;
      } else if (
        f.functionName &&
        typeof f.functionName === "object" &&
        "name" in f.functionName &&
        typeof (f.functionName as Record<string, unknown>).name === "string"
      ) {
        fnName = (f.functionName as Record<string, unknown>).name as string;
      }
      if (fnName === "exp") {
        expFactor = f;
        continue;
      }
    }
    linearFactor = f;
  }

  if (!linearFactor || !expFactor) return null;

  if (!(linearFactor instanceof ModelicaNameExpression && linearFactor.name === varName)) {
    return null; // For now, only exact `v`, not `P*v+R`
  }

  const expArgs = (expFactor as ModelicaFunctionCallExpression).args;
  const expArg = expArgs[0];
  if (!expArg) return null;
  const B_coeffs = extractLinearCoefficients(expArg, varName);
  if (!B_coeffs || !isZero(B_coeffs.B)) return null;

  const B = B_coeffs.A;

  const aFactors = factors.filter((f) => !containsVariable(f, varName));
  const A = simplifyExpr(aFactors.length > 0 ? aFactors.reduce((a, b) => mul(a, b)) : ONE);

  return { A, B, C };
}

/**
 * Heuristically extract a single linear additive term of `v` from an expression
 * to form a contractive fixed-point mapping `v = g(v)`.
 *
 * E.g., for `v + exp(v) - 5 = 0`, it isolates the `v` term:
 * `v = 5 - exp(v)`.
 */
export function extractLinearOccurrence(
  expr: ModelicaExpression,
  varName: string,
): { A: ModelicaExpression; rest: ModelicaExpression } | null {
  if (!containsVariable(expr, varName)) return null;

  const addends = getAddends(expr);
  let linearTermIndex = -1;
  let linearCoeff: ModelicaExpression | null = null;

  for (let i = 0; i < addends.length; i++) {
    const term = addends[i];
    if (term && containsVariable(term, varName)) {
      const D = simplifyExpr(differentiateExpr(term, varName));
      if (!containsVariable(D, varName) && !isZero(D)) {
        linearTermIndex = i;
        linearCoeff = D;
        break; // found the first linear occurrence
      }
    }
  }

  if (linearTermIndex === -1 || !linearCoeff) return null;

  // sum all other addends
  const otherAddends = addends.filter((_, idx) => idx !== linearTermIndex);
  if (otherAddends.length === 0) return null; // shouldn't happen if equation is non-linear

  const rest = simplifyExpr(otherAddends.reduce((a, b) => add(a, b)));

  return { A: linearCoeff, rest };
}

/**
 * Attempt to symbolically isolate a variable from an equation `lhs = rhs`.
 *
 * @returns An expression for `v = f(...)`, or null if isolation fails.
 */
export function isolateSymbolically(
  lhs: ModelicaExpression,
  rhs: ModelicaExpression,
  varName: string,
): ModelicaExpression | null {
  // Form the residual: lhs - rhs = 0
  const residual = simplifyExpr(sub(lhs, rhs));

  // Strategy 1: Linear isolation
  // If residual = A·v + B = 0, then v = -B/A
  const linear = extractLinearCoefficients(residual, varName);
  if (linear) {
    const { A, B } = linear;
    if (isZero(A)) return null; // degenerate

    // v = -B / A
    // Simplify: if A = 1, result is just -B; if A = -1, result is B
    if (isOne(A)) {
      return simplifyExpr(negate(B));
    }
    if (isNegOne(A)) {
      return simplifyExpr(B);
    }
    return simplifyExpr(div(negate(B), A));
  }

  // Strategy 1.5: Quadratic isolation
  const quadratic = extractQuadraticCoefficients(residual, varName);
  if (quadratic) {
    const { A, B, C } = quadratic;
    // We want to solve A v^2 + B v + C = 0
    // v = (-B + sqrt(B^2 - 4AC)) / 2A
    const FOUR = new ModelicaRealLiteral(4.0);
    const TWO = new ModelicaRealLiteral(2.0);

    const fourAC = mul(FOUR, mul(A, C));
    const bSquared = mul(B, B);
    const discriminant = simplifyExpr(sub(bSquared, fourAC));

    const sqrtCall = new ModelicaFunctionCallExpression("sqrt", [discriminant]);

    const negB_plus_sqrt = simplifyExpr(add(negate(B), sqrtCall));
    const twoA = simplifyExpr(mul(TWO, A));

    return simplifyExpr(div(negB_plus_sqrt, twoA));
  }

  // Strategy 1.6: Trigonometric isolation
  // A*sin(v) + B*cos(v) + C = 0
  // v = asin(-C / sqrt(A^2 + B^2)) - atan2(B, A)
  const harmonic = extractTrigonometricCoefficients(residual, varName);
  if (harmonic) {
    const { A, B, C } = harmonic;

    // R = sqrt(A^2 + B^2)
    const aSq = mul(A, A);
    const bSq = mul(B, B);
    const R_sq = simplifyExpr(add(aSq, bSq));
    const R = new ModelicaFunctionCallExpression("sqrt", [R_sq]);

    // alpha = atan2(B, A)
    const alpha = new ModelicaFunctionCallExpression("atan2", [B, A]);

    // asin(-C / R)
    const minusC_over_R = simplifyExpr(div(negate(C), R));
    const asinTerm = new ModelicaFunctionCallExpression("asin", [minusC_over_R]);

    // v = asin(-C / R) - atan2(B, A)
    return simplifyExpr(sub(asinTerm, alpha));
  }

  // Strategy 1.7: Lambert W isolation
  // A * v * exp(B * v) + C = 0
  // v = W(-C * B / A) / B
  // Note: Lambert W is standard in ModelScript under Math.lambertW0.
  // We'll emit `Modelica.Math.lambertW0(-C * B / A) / B`
  const lambert = extractLambertWCoefficients(residual, varName);
  if (lambert) {
    const { A, B, C } = lambert;

    // -C * B / A
    const argW = simplifyExpr(div(mul(negate(C), B), A));

    // W(arg)
    const wCall = new ModelicaFunctionCallExpression("Modelica.Math.lambertW0", [argW]);

    // v = W(arg) / B
    return simplifyExpr(div(wCall, B));
  }

  // Strategy 2: Single-occurrence inversion
  // If v appears exactly once in `lhs - rhs`, we can recursively
  // invert the expression tree to isolate v.
  const residualForInversion = simplifyExpr(sub(lhs, rhs));
  if (countOccurrences(residualForInversion, varName) === 1) {
    const result = invertSingleOccurrence(residualForInversion, varName, ZERO);
    if (result) return simplifyExpr(result);
  }

  // Also try with the original equation form (lhs = rhs)
  // where v might appear only on one side
  const lhsCount = countOccurrences(lhs, varName);
  const rhsCount = countOccurrences(rhs, varName);

  if (lhsCount === 1 && rhsCount === 0) {
    const result = invertSingleOccurrence(lhs, varName, rhs);
    if (result) return simplifyExpr(result);
  }
  if (rhsCount === 1 && lhsCount === 0) {
    const result = invertSingleOccurrence(rhs, varName, lhs);
    if (result) return simplifyExpr(result);
  }

  // Strategy 3: Fixed-Point Heuristic Rearrangement
  // Isolate a linear addend from a non-linear composite expression.
  // i.e., A*v + rest(v) = 0  =>  v = -rest(v) / A
  const linearOccurrence = extractLinearOccurrence(residual, varName);
  if (linearOccurrence) {
    const { A, rest } = linearOccurrence;
    // v = -rest / A
    if (isOne(A)) {
      return simplifyExpr(negate(rest));
    }
    if (isNegOne(A)) {
      return simplifyExpr(rest);
    }
    return simplifyExpr(div(negate(rest), A));
  }

  // Fallback: cannot isolate
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Single-occurrence inversion
// ─────────────────────────────────────────────────────────────────────

/**
 * Given `expr` which contains `varName` exactly once, and a known value
 * such that `expr = value`, recursively peel off operations to yield
 * `varName = f(value)`.
 *
 * For example: expr = 3*v + 5, value = 0
 *  → 3*v = 0 - 5 → v = (0-5)/3 → v = -5/3
 */
function invertSingleOccurrence(
  expr: ModelicaExpression,
  varName: string,
  value: ModelicaExpression,
): ModelicaExpression | null {
  // Base case: expr IS the variable
  if (expr instanceof ModelicaNameExpression && expr.name === varName) {
    return value;
  }
  if (expr && typeof expr === "object" && "name" in expr && (expr as { name: string }).name === varName) {
    return value;
  }

  // Unary: -f(v) = value  →  f(v) = -value
  if (expr instanceof ModelicaUnaryExpression) {
    if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      return invertSingleOccurrence(expr.operand, varName, negate(value));
    }
    return null;
  }

  // Binary operations
  if (expr instanceof ModelicaBinaryExpression) {
    const lContains = containsVariable(expr.operand1, varName);
    const rContains = containsVariable(expr.operand2, varName);

    // Exactly one side should contain v (single occurrence invariant)
    if (lContains && rContains) return null;
    if (!lContains && !rContains) return null;

    const varSide = lContains ? expr.operand1 : expr.operand2;
    const otherSide = lContains ? expr.operand2 : expr.operand1;
    const varOnLeft = lContains;

    switch (expr.operator) {
      // v + b = value  →  v = value - b
      // a + v = value  →  v = value - a
      case ModelicaBinaryOperator.ADDITION:
      case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
        return invertSingleOccurrence(varSide, varName, sub(value, otherSide));

      // v - b = value  →  v = value + b
      // a - v = value  →  v = a - value
      case ModelicaBinaryOperator.SUBTRACTION:
      case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
        if (varOnLeft) {
          return invertSingleOccurrence(varSide, varName, add(value, otherSide));
        } else {
          return invertSingleOccurrence(varSide, varName, sub(otherSide, value));
        }

      // v * b = value  →  v = value / b
      // a * v = value  →  v = value / a
      case ModelicaBinaryOperator.MULTIPLICATION:
      case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
        return invertSingleOccurrence(varSide, varName, div(value, otherSide));

      // v / b = value  →  v = value * b
      // a / v = value  →  v = a / value
      case ModelicaBinaryOperator.DIVISION:
      case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
        if (varOnLeft) {
          return invertSingleOccurrence(varSide, varName, mul(value, otherSide));
        } else {
          return invertSingleOccurrence(varSide, varName, div(otherSide, value));
        }

      // v ^ n = value  →  v = value ^ (1/n)  (only for constant integer/real exponents)
      // b ^ v = value  →  v = log(value) / log(b)
      case ModelicaBinaryOperator.EXPONENTIATION:
      case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
        if (varOnLeft) {
          // v^n = value → v = value^(1/n)
          if (otherSide instanceof ModelicaRealLiteral || otherSide instanceof ModelicaIntegerLiteral) {
            const n = otherSide instanceof ModelicaRealLiteral ? otherSide.value : otherSide.value;
            if (n !== 0) {
              const invExp = new ModelicaRealLiteral(1.0 / n);
              return invertSingleOccurrence(
                varSide,
                varName,
                new ModelicaBinaryExpression(ModelicaBinaryOperator.EXPONENTIATION, value, invExp),
              );
            }
          }
        } else {
          // b^v = value → v = log(value) / log(b)
          return invertSingleOccurrence(
            varSide,
            varName,
            div(
              new ModelicaFunctionCallExpression("log", [value]),
              new ModelicaFunctionCallExpression("log", [otherSide]),
            ),
          );
        }
        return null;

      default:
        return null;
    }
  }

  // Function calls: f(v) = value → v = f⁻¹(value)
  if (expr instanceof ModelicaFunctionCallExpression) {
    const args = expr.args as ModelicaExpression[];
    if (args.length === 1) {
      const arg = args[0];
      if (!arg || !containsVariable(arg, varName)) return null;

      const inverse = getInverseFunction(expr.functionName, value);
      if (inverse) {
        return invertSingleOccurrence(arg, varName, inverse);
      }
    }
    return null;
  }

  return null;
}

/**
 * Get the inverse of a known math function.
 * sin(u) = v → u = asin(v), etc.
 */
function getInverseFunction(funcName: string, value: ModelicaExpression): ModelicaExpression | null {
  switch (funcName) {
    case "sin":
    case "Modelica.Math.sin":
      return new ModelicaFunctionCallExpression("asin", [value]);
    case "cos":
    case "Modelica.Math.cos":
      return new ModelicaFunctionCallExpression("acos", [value]);
    case "tan":
    case "Modelica.Math.tan":
      return new ModelicaFunctionCallExpression("atan", [value]);
    case "asin":
    case "Modelica.Math.asin":
      return new ModelicaFunctionCallExpression("sin", [value]);
    case "acos":
    case "Modelica.Math.acos":
      return new ModelicaFunctionCallExpression("cos", [value]);
    case "atan":
    case "Modelica.Math.atan":
      return new ModelicaFunctionCallExpression("tan", [value]);
    case "exp":
    case "Modelica.Math.exp":
      return new ModelicaFunctionCallExpression("log", [value]);
    case "log":
    case "Modelica.Math.log":
      return new ModelicaFunctionCallExpression("exp", [value]);
    case "sqrt":
      // sqrt(u) = v → u = v^2
      return mul(value, value);
    case "sinh":
    case "Modelica.Math.sinh":
      // sinh(u) = v → u = log(v + sqrt(v²+1))
      return new ModelicaFunctionCallExpression("log", [
        add(value, new ModelicaFunctionCallExpression("sqrt", [add(mul(value, value), new ModelicaRealLiteral(1))])),
      ]);
    case "cosh":
    case "Modelica.Math.cosh":
      // cosh(u) = v → u = log(v + sqrt(v²-1))
      return new ModelicaFunctionCallExpression("log", [
        add(value, new ModelicaFunctionCallExpression("sqrt", [sub(mul(value, value), new ModelicaRealLiteral(1))])),
      ]);
    case "tanh":
    case "Modelica.Math.tanh":
      // tanh(u) = v → u = 0.5 * log((1+v)/(1-v))
      return mul(
        new ModelicaRealLiteral(0.5),
        new ModelicaFunctionCallExpression("log", [
          div(add(new ModelicaRealLiteral(1), value), sub(new ModelicaRealLiteral(1), value)),
        ]),
      );
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function negate(expr: ModelicaExpression): ModelicaExpression {
  if (isZero(expr)) return ZERO;
  if (expr instanceof ModelicaRealLiteral) return new ModelicaRealLiteral(-expr.value);
  if (expr instanceof ModelicaIntegerLiteral) return new ModelicaIntegerLiteral(-expr.value);
  if (expr instanceof ModelicaUnaryExpression && expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
    return expr.operand; // --x → x
  }
  return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, expr);
}

function isNegOne(expr: ModelicaExpression): boolean {
  if (expr instanceof ModelicaRealLiteral) return expr.value === -1;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value === -1;
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Alias Elimination
// ─────────────────────────────────────────────────────────────────────

/**
 * Substitute all occurrences of `varName` in all expressions of an equation.
 */
function substituteInEquation(
  eq: ModelicaSimpleEquation,
  varName: string,
  replacement: ModelicaExpression,
): ModelicaSimpleEquation {
  const e1 = substituteVariable(eq.expression1, varName, replacement);
  const e2 = substituteVariable(eq.expression2, varName, replacement);
  if (e1 === eq.expression1 && e2 === eq.expression2) return eq;
  return new ModelicaSimpleEquation(e1, e2, eq.description);
}

/**
 * Detect if a `ModelicaSimpleEquation` is a trivial alias: `a = b`
 * where both sides are bare variable references (ModelicaNameExpression).
 *
 * @returns The pair [aliasVar, targetVar], or null.
 */
function detectTrivialAlias(
  eq: ModelicaSimpleEquation,
  unknowns: Set<string>,
): { aliasVar: string; targetExpr: ModelicaExpression } | null {
  const lhs = eq.expression1;
  const rhs = eq.expression2;

  // Pattern: name = expr  where name is an unknown
  if (lhs instanceof ModelicaNameExpression && unknowns.has(lhs.name)) {
    // a = b (trivial) or a = expr where expr doesn't contain a
    if (!containsVariable(rhs, lhs.name)) {
      return { aliasVar: lhs.name, targetExpr: rhs };
    }
  }
  // Pattern: expr = name  where name is an unknown
  if (rhs instanceof ModelicaNameExpression && unknowns.has(rhs.name)) {
    if (!containsVariable(lhs, rhs.name)) {
      return { aliasVar: rhs.name, targetExpr: lhs };
    }
  }

  return null;
}

/**
 * Perform alias elimination on a DAE.
 *
 * Scans equations for trivial aliases (`a = b` or `a = expr`) where `a` is
 * a continuous unknown and `expr` does not reference `a`. Replaces all
 * occurrences of the alias variable with its target expression in all other
 * equations, then removes the alias equation and variable.
 *
 * This reduces the system size and eliminates redundant unknowns before
 * BLT analysis.
 */
export function eliminateAliases(dae: ModelicaDAE): void {
  // Build the set of continuous unknowns (same logic as BLT)
  const unknowns = new Set<string>();
  for (const v of dae.variables) {
    if (v instanceof ModelicaRealVariable && v.variability === null) {
      unknowns.add(v.name);
    }
  }

  // Iterate until no more aliases are found (substitution may reveal new aliases)
  let changed = true;
  while (changed) {
    changed = false;

    for (let i = 0; i < dae.equations.length; i++) {
      const eq = dae.equations[i];
      if (!(eq instanceof ModelicaSimpleEquation)) continue;

      const alias = detectTrivialAlias(eq, unknowns);
      if (!alias) continue;

      const { aliasVar, targetExpr } = alias;

      // Don't eliminate parameters, constants, or derivatives
      const varDef = dae.variables.get(aliasVar);
      if (!varDef) continue;
      if (varDef.variability === ModelicaVariability.PARAMETER || varDef.variability === ModelicaVariability.CONSTANT) {
        continue;
      }
      if (aliasVar.startsWith("der(")) continue;

      // Don't eliminate variables that appear in the target expression
      // (would create cycles)
      if (containsVariable(targetExpr, aliasVar)) continue;

      // Substitute aliasVar → targetExpr in all OTHER equations
      for (let j = 0; j < dae.equations.length; j++) {
        if (j === i) continue;
        const otherEq = dae.equations[j];
        if (!(otherEq instanceof ModelicaSimpleEquation)) continue;
        dae.equations[j] = substituteInEquation(otherEq, aliasVar, targetExpr);
      }

      // Remove the alias equation
      dae.equations.splice(i, 1);

      // Remove the alias variable
      const aliasVarDef = dae.variables.get(aliasVar);
      if (aliasVarDef) dae.variables.remove(aliasVarDef);

      // Remove from unknowns set
      unknowns.delete(aliasVar);

      changed = true;
      break; // restart scan from the beginning
    }
  }
}
