// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Polynomial expansion, term collection, and expression normalization.
 *
 * Operates on the native ModelicaExpression AST. Uses the E-Graph engine
 * for canonical form computation when normalization is requested.
 */

import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "@modelscript/modelica-ast";
import type { ModelicaExpression } from "../dae.js";
import {
  ModelicaBinaryExpression,
  ModelicaFunctionCallExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaUnaryExpression,
} from "../dae.js";
import { add, div, isOne, isZero, mul, pow, sub, ZERO } from "../symbolic-diff.js";
import { egraphSimplify } from "./egraph.js";

// ─────────────────────────────────────────────────────────────────────
// Polynomial Expansion
// ─────────────────────────────────────────────────────────────────────

/**
 * Recursively expand an expression by distributing multiplication over
 * addition and applying binomial expansion for integer powers.
 *
 * Examples:
 *   (a + b) * c  →  a*c + b*c
 *   (a + b)^2    →  a^2 + 2*a*b + b^2
 */
export function expandExpr(expr: ModelicaExpression): ModelicaExpression {
  if (expr instanceof ModelicaRealLiteral || expr instanceof ModelicaIntegerLiteral) {
    return expr;
  }
  if (expr instanceof ModelicaNameExpression) {
    return expr;
  }

  if (expr instanceof ModelicaUnaryExpression) {
    const expanded = expandExpr(expr.operand);
    if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      return distributeNeg(expanded);
    }
    return new ModelicaUnaryExpression(expr.operator, expanded);
  }

  if (expr instanceof ModelicaBinaryExpression) {
    const left = expandExpr(expr.operand1);
    const right = expandExpr(expr.operand2);

    switch (expr.operator) {
      case ModelicaBinaryOperator.ADDITION:
      case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
        return add(left, right);

      case ModelicaBinaryOperator.SUBTRACTION:
      case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
        return sub(left, right);

      case ModelicaBinaryOperator.MULTIPLICATION:
      case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
        return distributeMultiply(left, right);

      case ModelicaBinaryOperator.DIVISION:
      case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
        return div(left, right);

      case ModelicaBinaryOperator.EXPONENTIATION:
      case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION: {
        const n = getIntegerValue(right);
        if (n !== null && n >= 0 && n <= 10) {
          return expandPower(left, n);
        }
        return pow(left, right);
      }

      default:
        return new ModelicaBinaryExpression(expr.operator, left, right);
    }
  }

  if (expr instanceof ModelicaFunctionCallExpression) {
    const args = (expr.args as ModelicaExpression[]).map(expandExpr);
    return new ModelicaFunctionCallExpression(expr.functionName, args);
  }

  return expr;
}

/**
 * Distribute multiplication: (a+b)*c → a*c + b*c, a*(b+c) → a*b + a*c
 */
function distributeMultiply(left: ModelicaExpression, right: ModelicaExpression): ModelicaExpression {
  // (a + b) * right → a*right + b*right
  const leftSum = extractSum(left);
  if (leftSum) {
    return add(distributeMultiply(leftSum.a, right), distributeMultiply(leftSum.b, right));
  }

  // left * (a + b) → left*a + left*b
  const rightSum = extractSum(right);
  if (rightSum) {
    return add(distributeMultiply(left, rightSum.a), distributeMultiply(left, rightSum.b));
  }

  // (a - b) * right → a*right - b*right
  const leftDiff = extractDiff(left);
  if (leftDiff) {
    return sub(distributeMultiply(leftDiff.a, right), distributeMultiply(leftDiff.b, right));
  }

  // left * (a - b) → left*a - left*b
  const rightDiff = extractDiff(right);
  if (rightDiff) {
    return sub(distributeMultiply(left, rightDiff.a), distributeMultiply(left, rightDiff.b));
  }

  return mul(left, right);
}

/**
 * Expand integer power by repeated multiplication.
 * x^0 → 1, x^1 → x, x^n → x * x^(n-1) (expanded)
 */
function expandPower(base: ModelicaExpression, n: number): ModelicaExpression {
  if (n === 0) return new ModelicaRealLiteral(1);
  if (n === 1) return base;
  // Binary exponentiation with expansion
  let result = base;
  for (let i = 1; i < n; i++) {
    result = distributeMultiply(result, base);
  }
  return result;
}

/** Distribute negation into sums. */
function distributeNeg(expr: ModelicaExpression): ModelicaExpression {
  const sum = extractSum(expr);
  if (sum) {
    return add(distributeNeg(sum.a), distributeNeg(sum.b));
  }
  const diff = extractDiff(expr);
  if (diff) {
    return sub(diff.b, diff.a);
  }
  if (isZero(expr)) return ZERO;
  return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, expr);
}

// ─────────────────────────────────────────────────────────────────────
// Term Collection
// ─────────────────────────────────────────────────────────────────────

/**
 * Collect terms by powers of a variable.
 *
 * Given an expression that is polynomial in `varName`, returns a map
 * from degree → coefficient expression (independent of varName).
 *
 * Example: 3*x^2 + 2*x + 1 → Map { 2 → 3, 1 → 2, 0 → 1 }
 */
export function collectTerms(expr: ModelicaExpression, varName: string): Map<number, ModelicaExpression> {
  const expanded = expandExpr(expr);
  const terms = new Map<number, ModelicaExpression>();

  function addTerm(degree: number, coeff: ModelicaExpression): void {
    const existing = terms.get(degree);
    if (existing) {
      terms.set(degree, add(existing, coeff));
    } else {
      terms.set(degree, coeff);
    }
  }

  function collect(e: ModelicaExpression): void {
    // Sum: collect each side
    const sum = extractSum(e);
    if (sum) {
      collect(sum.a);
      collect(sum.b);
      return;
    }

    // Difference: collect left, negate right
    const diff = extractDiff(e);
    if (diff) {
      collect(diff.a);
      collect(new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, diff.b));
      return;
    }

    // Determine degree and coefficient
    const { degree, coeff } = extractDegreeAndCoeff(e, varName);
    addTerm(degree, coeff);
  }

  collect(expanded);
  return terms;
}

/**
 * Extract the degree and coefficient of a single term with respect to varName.
 */
function extractDegreeAndCoeff(
  expr: ModelicaExpression,
  varName: string,
): { degree: number; coeff: ModelicaExpression } {
  // Variable itself: degree 1, coefficient 1
  if (expr instanceof ModelicaNameExpression && expr.name === varName) {
    return { degree: 1, coeff: new ModelicaRealLiteral(1) };
  }

  // Doesn't contain the variable: degree 0
  if (!containsVar(expr, varName)) {
    return { degree: 0, coeff: expr };
  }

  // x^n
  if (expr instanceof ModelicaBinaryExpression) {
    if (
      expr.operator === ModelicaBinaryOperator.EXPONENTIATION ||
      expr.operator === ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION
    ) {
      if (expr.operand1 instanceof ModelicaNameExpression && expr.operand1.name === varName) {
        const n = getIntegerValue(expr.operand2);
        if (n !== null) return { degree: n, coeff: new ModelicaRealLiteral(1) };
      }
    }

    // a * b: split based on which side contains the variable
    if (
      expr.operator === ModelicaBinaryOperator.MULTIPLICATION ||
      expr.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
    ) {
      const leftHasVar = containsVar(expr.operand1, varName);
      const rightHasVar = containsVar(expr.operand2, varName);

      if (leftHasVar && !rightHasVar) {
        const inner = extractDegreeAndCoeff(expr.operand1, varName);
        return { degree: inner.degree, coeff: mul(inner.coeff, expr.operand2) };
      }
      if (!leftHasVar && rightHasVar) {
        const inner = extractDegreeAndCoeff(expr.operand2, varName);
        return { degree: inner.degree, coeff: mul(expr.operand1, inner.coeff) };
      }
      // Both sides contain the variable — multiply degrees
      if (leftHasVar && rightHasVar) {
        const leftDC = extractDegreeAndCoeff(expr.operand1, varName);
        const rightDC = extractDegreeAndCoeff(expr.operand2, varName);
        return {
          degree: leftDC.degree + rightDC.degree,
          coeff: mul(leftDC.coeff, rightDC.coeff),
        };
      }
    }
  }

  // Negation
  if (expr instanceof ModelicaUnaryExpression && expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
    const inner = extractDegreeAndCoeff(expr.operand, varName);
    return {
      degree: inner.degree,
      coeff: new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, inner.coeff),
    };
  }

  // Default fallback: treat as opaque (degree 0 is wrong, but safe)
  return { degree: 0, coeff: expr };
}

// ─────────────────────────────────────────────────────────────────────
// Normalization (via E-Graph)
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalize an expression to a canonical form using the E-Graph engine.
 * This first expands, then runs equality saturation to find the simplest form.
 */
export function normalizeExpr(expr: ModelicaExpression): ModelicaExpression {
  const expanded = expandExpr(expr);
  return egraphSimplify(expanded);
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

/** Extract integer value from a literal expression. */
function getIntegerValue(expr: ModelicaExpression): number | null {
  if (expr instanceof ModelicaIntegerLiteral) return expr.value;
  if (expr instanceof ModelicaRealLiteral && Number.isInteger(expr.value)) return expr.value;
  return null;
}

/** Check if expression contains a variable by name. */
function containsVar(expr: ModelicaExpression, varName: string): boolean {
  if (expr instanceof ModelicaNameExpression) return expr.name === varName;
  if (expr instanceof ModelicaUnaryExpression) return containsVar(expr.operand, varName);
  if (expr instanceof ModelicaBinaryExpression) {
    return containsVar(expr.operand1, varName) || containsVar(expr.operand2, varName);
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    return (expr.args as ModelicaExpression[]).some((a) => containsVar(a, varName));
  }
  return false;
}

/** Extract addition operands: a + b. */
function extractSum(expr: ModelicaExpression): { a: ModelicaExpression; b: ModelicaExpression } | null {
  if (
    expr instanceof ModelicaBinaryExpression &&
    (expr.operator === ModelicaBinaryOperator.ADDITION || expr.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION)
  ) {
    return { a: expr.operand1, b: expr.operand2 };
  }
  return null;
}

/** Extract subtraction operands: a - b. */
function extractDiff(expr: ModelicaExpression): { a: ModelicaExpression; b: ModelicaExpression } | null {
  if (
    expr instanceof ModelicaBinaryExpression &&
    (expr.operator === ModelicaBinaryOperator.SUBTRACTION ||
      expr.operator === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION)
  ) {
    return { a: expr.operand1, b: expr.operand2 };
  }
  return null;
}

/** Check if expression is a literal constant. */
export function isLiteral(expr: ModelicaExpression): boolean {
  return expr instanceof ModelicaRealLiteral || expr instanceof ModelicaIntegerLiteral;
}

/** Get numeric value of a literal. */
export function getLiteralValue(expr: ModelicaExpression): number | null {
  if (expr instanceof ModelicaRealLiteral) return expr.value;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value;
  return null;
}

/** Check if expression represents constant one. */
export { isOne, isZero };
