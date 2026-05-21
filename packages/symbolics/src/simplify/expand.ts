// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @deprecated This module delegates to `@modelscript/compiler` for the
 * arena-native implementation. Legacy functions operating on ModelicaExpression
 * are preserved for backward compatibility.
 */

// Re-export arena-native symbols
export { arenaTermsToExpr, expandArenaExpr, isArenaLiteral, normalizeArenaExpr } from "@modelscript/compiler";

// ── Legacy API ──

import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "@modelscript/modelica/ast";
import { add, div, isZero, mul, pow, sub, ZERO } from "../calculus/derivative.js";
import type { ModelicaExpression } from "../systems/index.js";
import {
  ModelicaBinaryExpression,
  ModelicaFunctionCallExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaUnaryExpression,
} from "../systems/index.js";
import { egraphSimplify } from "./egraph.js";

/**
 * @deprecated Use `expandArenaExpr` from `@modelscript/compiler`.
 */
export function expandExpr(expr: ModelicaExpression): ModelicaExpression {
  if (expr instanceof ModelicaRealLiteral || expr instanceof ModelicaIntegerLiteral) return expr;
  if (expr instanceof ModelicaNameExpression) return expr;

  if (expr instanceof ModelicaUnaryExpression) {
    const expanded = expandExpr(expr.operand);
    if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS) return distributeNeg(expanded);
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
        if (n !== null && n >= 0 && n <= 10) return expandPower(left, n);
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
 * @deprecated Use `collectArenaTerms` from `@modelscript/compiler`.
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
    const sum = extractSum(e);
    if (sum) {
      collect(sum.a);
      collect(sum.b);
      return;
    }
    const diff = extractDiff(e);
    if (diff) {
      collect(diff.a);
      collect(new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, diff.b));
      return;
    }
    const { degree, coeff } = extractDegreeAndCoeff(e, varName);
    addTerm(degree, coeff);
  }

  collect(expanded);
  return terms;
}

/**
 * @deprecated Use `normalizeArenaExpr` from `@modelscript/compiler`.
 */
export function normalizeExpr(expr: ModelicaExpression): ModelicaExpression {
  return egraphSimplify(expandExpr(expr));
}

export function isLiteral(expr: ModelicaExpression): boolean {
  return expr instanceof ModelicaRealLiteral || expr instanceof ModelicaIntegerLiteral;
}

export function getLiteralValue(expr: ModelicaExpression): number | null {
  if (expr instanceof ModelicaRealLiteral) return expr.value;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value;
  return null;
}

// ── Internal helpers (preserved for collectTerms) ──

function getIntegerValue(expr: ModelicaExpression): number | null {
  if (expr instanceof ModelicaIntegerLiteral) return expr.value;
  if (expr instanceof ModelicaRealLiteral && Number.isInteger(expr.value)) return expr.value;
  return null;
}

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

function extractSum(expr: ModelicaExpression): { a: ModelicaExpression; b: ModelicaExpression } | null {
  if (
    expr instanceof ModelicaBinaryExpression &&
    (expr.operator === ModelicaBinaryOperator.ADDITION || expr.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION)
  ) {
    return { a: expr.operand1, b: expr.operand2 };
  }
  return null;
}

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

function extractDegreeAndCoeff(
  expr: ModelicaExpression,
  varName: string,
): { degree: number; coeff: ModelicaExpression } {
  if (expr instanceof ModelicaNameExpression && expr.name === varName) {
    return { degree: 1, coeff: new ModelicaRealLiteral(1) };
  }
  if (!containsVar(expr, varName)) return { degree: 0, coeff: expr };

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
    if (
      expr.operator === ModelicaBinaryOperator.MULTIPLICATION ||
      expr.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
    ) {
      const lv = containsVar(expr.operand1, varName);
      const rv = containsVar(expr.operand2, varName);
      if (lv && !rv) {
        const inner = extractDegreeAndCoeff(expr.operand1, varName);
        return { degree: inner.degree, coeff: mul(inner.coeff, expr.operand2) };
      }
      if (!lv && rv) {
        const inner = extractDegreeAndCoeff(expr.operand2, varName);
        return { degree: inner.degree, coeff: mul(expr.operand1, inner.coeff) };
      }
      if (lv && rv) {
        const ld = extractDegreeAndCoeff(expr.operand1, varName);
        const rd = extractDegreeAndCoeff(expr.operand2, varName);
        return { degree: ld.degree + rd.degree, coeff: mul(ld.coeff, rd.coeff) };
      }
    }
  }

  if (expr instanceof ModelicaUnaryExpression && expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
    const inner = extractDegreeAndCoeff(expr.operand, varName);
    return { degree: inner.degree, coeff: new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, inner.coeff) };
  }

  return { degree: 0, coeff: expr };
}

function distributeMultiply(left: ModelicaExpression, right: ModelicaExpression): ModelicaExpression {
  const ls = extractSum(left);
  if (ls) return add(distributeMultiply(ls.a, right), distributeMultiply(ls.b, right));
  const rs = extractSum(right);
  if (rs) return add(distributeMultiply(left, rs.a), distributeMultiply(left, rs.b));
  const ld = extractDiff(left);
  if (ld) return sub(distributeMultiply(ld.a, right), distributeMultiply(ld.b, right));
  const rd = extractDiff(right);
  if (rd) return sub(distributeMultiply(left, rd.a), distributeMultiply(left, rd.b));
  return mul(left, right);
}

function expandPower(base: ModelicaExpression, n: number): ModelicaExpression {
  if (n === 0) return new ModelicaRealLiteral(1);
  if (n === 1) return base;
  let result = base;
  for (let i = 1; i < n; i++) result = distributeMultiply(result, base);
  return result;
}

function distributeNeg(expr: ModelicaExpression): ModelicaExpression {
  const s = extractSum(expr);
  if (s) return add(distributeNeg(s.a), distributeNeg(s.b));
  const d = extractDiff(expr);
  if (d) return sub(d.b, d.a);
  if (isZero(expr)) return ZERO;
  return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, expr);
}
