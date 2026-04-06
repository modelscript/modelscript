// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic integration (anti-differentiation) engine.
 *
 * Provides pattern-matching-based symbolic integration, Taylor series
 * expansion, and basic limit evaluation.
 *
 * Operates on the native ModelicaExpression AST and uses the E-Graph
 * engine for simplification of results.
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
import { add, differentiateExpr, div, mul, ONE, pow, simplifyExpr, sub, ZERO } from "../symbolic-diff.js";
import { egraphSimplify } from "./egraph.js";
import { getLiteralValue } from "./expand.js";

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Symbolically integrate an expression with respect to a variable.
 *
 * Returns the anti-derivative (without constant of integration) or null
 * if the integral cannot be computed symbolically.
 *
 * Supported forms:
 *   - Constants: ∫c dx = cx
 *   - Powers: ∫xⁿ dx = xⁿ⁺¹/(n+1)  (n ≠ -1)
 *   - ∫1/x dx = ln|x|
 *   - Trig: sin, cos, tan, sec², csc², etc.
 *   - Exp/log: eˣ, aˣ
 *   - Linearity: ∫(f+g) = ∫f + ∫g, ∫cf = c∫f
 *   - Linear substitution: ∫f(ax+b) = F(ax+b)/a
 */
export function integrateExpr(expr: ModelicaExpression, varName: string): ModelicaExpression | null {
  // ── Constants: ∫c dx = cx ──
  if (expr instanceof ModelicaRealLiteral || expr instanceof ModelicaIntegerLiteral) {
    return mul(expr, varRef(varName));
  }

  if (expr instanceof ModelicaNameExpression) {
    if (expr.name === varName) {
      // ∫x dx = x²/2
      return div(pow(varRef(varName), lit(2)), lit(2));
    }
    // ∫c dx = cx (c is independent of varName)
    return mul(expr, varRef(varName));
  }

  // ── Unary negation: ∫(-f) = -∫f ──
  if (expr instanceof ModelicaUnaryExpression) {
    if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      const inner = integrateExpr(expr.operand, varName);
      if (inner === null) return null;
      return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, inner);
    }
    return null;
  }

  // ── Binary expressions ──
  if (expr instanceof ModelicaBinaryExpression) {
    return integrateBinary(expr, varName);
  }

  // ── Function calls ──
  if (expr instanceof ModelicaFunctionCallExpression) {
    return integrateFunctionCall(expr, varName);
  }

  return null;
}

/**
 * Compute the Taylor series expansion of an expression around a point.
 *
 * @param expr Expression to expand
 * @param varName Variable name
 * @param point The point around which to expand (a numeric value)
 * @param order Number of terms (0 through order-1)
 */
export function taylorSeries(
  expr: ModelicaExpression,
  varName: string,
  point: number,
  order: number,
): ModelicaExpression {
  const x = varRef(varName);
  const a = lit(point);
  let result: ModelicaExpression = ZERO;
  let currentExpr = expr;
  let factorial = 1;

  for (let n = 0; n < order; n++) {
    // Evaluate currentExpr at x = point
    const coeff = evaluateAt(currentExpr, varName, point);
    if (coeff === null) break; // Can't evaluate — stop

    const coeffExpr = lit(coeff / factorial);
    const term = n === 0 ? coeffExpr : mul(coeffExpr, pow(sub(x, a), lit(n)));
    result = add(result, term);

    // Differentiate for next term
    currentExpr = simplifyExpr(differentiateExpr(currentExpr, varName));
    factorial *= n + 1;
  }

  return egraphSimplify(result);
}

/**
 * Evaluate a basic limit of expr as varName → point.
 *
 * Uses direct substitution first; if that yields 0/0, applies
 * L'Hôpital's rule up to a maximum number of iterations.
 */
export function limit(expr: ModelicaExpression, varName: string, point: number, maxIterations = 5): number | null {
  // Direct substitution
  const direct = evaluateAt(expr, varName, point);
  if (direct !== null && Number.isFinite(direct)) return direct;

  // Check for 0/0 (L'Hôpital's rule)
  if (expr instanceof ModelicaBinaryExpression && isDiv(expr.operator)) {
    let num = expr.operand1;
    let den = expr.operand2;

    for (let i = 0; i < maxIterations; i++) {
      const numVal = evaluateAt(num, varName, point);
      const denVal = evaluateAt(den, varName, point);

      if (numVal === null || denVal === null) return null;

      if (Math.abs(denVal) > 1e-12) {
        return numVal / denVal;
      }

      if (Math.abs(numVal) > 1e-12) {
        return null; // c/0 → ±∞
      }

      // 0/0 → apply L'Hôpital
      num = simplifyExpr(differentiateExpr(num, varName));
      den = simplifyExpr(differentiateExpr(den, varName));
    }
  }

  return null;
}

/**
 * Compute the nth derivative of an expression.
 */
export function nthDerivative(expr: ModelicaExpression, varName: string, n: number): ModelicaExpression {
  let result = expr;
  for (let i = 0; i < n; i++) {
    result = simplifyExpr(differentiateExpr(result, varName));
  }
  return egraphSimplify(result);
}

// ─────────────────────────────────────────────────────────────────────
// Binary Integration
// ─────────────────────────────────────────────────────────────────────

function integrateBinary(expr: ModelicaBinaryExpression, varName: string): ModelicaExpression | null {
  const { operand1: left, operand2: right, operator: op } = expr;

  // ── Sum/Difference rule: ∫(f ± g) = ∫f ± ∫g ──
  if (isAdd(op)) {
    const fInt = integrateExpr(left, varName);
    const gInt = integrateExpr(right, varName);
    if (fInt !== null && gInt !== null) {
      return egraphSimplify(add(fInt, gInt));
    }
    return null;
  }

  if (isSub(op)) {
    const fInt = integrateExpr(left, varName);
    const gInt = integrateExpr(right, varName);
    if (fInt !== null && gInt !== null) {
      return egraphSimplify(sub(fInt, gInt));
    }
    return null;
  }

  // ── Constant multiple: ∫(c·f) = c·∫f ──
  if (isMul(op)) {
    if (!containsVar(left, varName)) {
      const fInt = integrateExpr(right, varName);
      if (fInt !== null) return egraphSimplify(mul(left, fInt));
    }
    if (!containsVar(right, varName)) {
      const fInt = integrateExpr(left, varName);
      if (fInt !== null) return egraphSimplify(mul(right, fInt));
    }
    return null;
  }

  // ── Division by constant: ∫(f/c) = (1/c)·∫f ──
  if (isDiv(op)) {
    if (!containsVar(right, varName)) {
      const fInt = integrateExpr(left, varName);
      if (fInt !== null) return egraphSimplify(div(fInt, right));
    }
    // ∫(1/x) = ln|x|
    if (isOne(left) && right instanceof ModelicaNameExpression && right.name === varName) {
      return call("log", call("abs", varRef(varName)));
    }
    return null;
  }

  // ── Power rule: ∫xⁿ dx = xⁿ⁺¹/(n+1), n ≠ -1 ──
  if (isPow(op)) {
    if (left instanceof ModelicaNameExpression && left.name === varName && !containsVar(right, varName)) {
      const n = getLiteralValue(right);
      if (n !== null && n !== -1) {
        return egraphSimplify(div(pow(varRef(varName), lit(n + 1)), lit(n + 1)));
      }
      if (n === -1) {
        // ∫x⁻¹ = ln|x|
        return call("log", call("abs", varRef(varName)));
      }
      // Symbolic exponent: ∫x^a = x^(a+1)/(a+1)
      const np1 = add(right, ONE);
      return egraphSimplify(div(pow(varRef(varName), np1), np1));
    }
    // ∫e^x = e^x, ∫a^x = a^x/ln(a) — handled for constant base
    if (!containsVar(left, varName) && right instanceof ModelicaNameExpression && right.name === varName) {
      // ∫a^x dx = a^x / ln(a)
      return egraphSimplify(div(expr, call("log", left)));
    }
    return null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Function Call Integration
// ─────────────────────────────────────────────────────────────────────

function integrateFunctionCall(expr: ModelicaFunctionCallExpression, varName: string): ModelicaExpression | null {
  const fname = expr.functionName;
  const args = expr.args as ModelicaExpression[];
  if (args.length !== 1) return null;
  const arg = args[0];
  if (!arg) return null;

  // Check for linear substitution: f(ax+b) where a,b are constants
  const linCoeffs = extractLinearArg(arg, varName);
  if (!linCoeffs) return null;
  const { a: aCoeff, isSimple } = linCoeffs;

  // Only handle simple variable case or linear argument
  const x = varRef(varName);
  let antiderivative: ModelicaExpression | null = null;

  switch (fname) {
    case "sin":
    case "Modelica.Math.sin":
      // ∫sin(u) = -cos(u)
      antiderivative = negate(call("cos", arg));
      break;

    case "cos":
    case "Modelica.Math.cos":
      // ∫cos(u) = sin(u)
      antiderivative = call("sin", arg);
      break;

    case "exp":
    case "Modelica.Math.exp":
      // ∫exp(u) = exp(u)
      antiderivative = call("exp", arg);
      break;

    case "tan":
    case "Modelica.Math.tan":
      // ∫tan(u) = -ln|cos(u)|
      antiderivative = negate(call("log", call("abs", call("cos", arg))));
      break;

    case "sinh":
    case "Modelica.Math.sinh":
      // ∫sinh(u) = cosh(u)
      antiderivative = call("cosh", arg);
      break;

    case "cosh":
    case "Modelica.Math.cosh":
      // ∫cosh(u) = sinh(u)
      antiderivative = call("sinh", arg);
      break;

    case "sqrt":
      // ∫√x dx = (2/3)x^(3/2)
      if (isSimple) {
        antiderivative = mul(div(lit(2), lit(3)), pow(x, lit(1.5)));
      }
      break;

    default:
      return null;
  }

  if (antiderivative === null) return null;

  // Apply linear substitution correction: divide by 'a'
  if (!isSimple) {
    antiderivative = div(antiderivative, aCoeff);
  }

  return egraphSimplify(antiderivative);
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

function varRef(name: string): ModelicaExpression {
  return new ModelicaNameExpression(name);
}

function lit(n: number): ModelicaExpression {
  return new ModelicaRealLiteral(n);
}

function call(name: string, ...args: ModelicaExpression[]): ModelicaExpression {
  return new ModelicaFunctionCallExpression(name, args);
}

function negate(expr: ModelicaExpression): ModelicaExpression {
  return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, expr);
}

function isOne(expr: ModelicaExpression): boolean {
  if (expr instanceof ModelicaRealLiteral) return expr.value === 1;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value === 1;
  return false;
}

function isAdd(op: ModelicaBinaryOperator): boolean {
  return op === ModelicaBinaryOperator.ADDITION || op === ModelicaBinaryOperator.ELEMENTWISE_ADDITION;
}
function isSub(op: ModelicaBinaryOperator): boolean {
  return op === ModelicaBinaryOperator.SUBTRACTION || op === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION;
}
function isMul(op: ModelicaBinaryOperator): boolean {
  return op === ModelicaBinaryOperator.MULTIPLICATION || op === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION;
}
function isDiv(op: ModelicaBinaryOperator): boolean {
  return op === ModelicaBinaryOperator.DIVISION || op === ModelicaBinaryOperator.ELEMENTWISE_DIVISION;
}
function isPow(op: ModelicaBinaryOperator): boolean {
  return op === ModelicaBinaryOperator.EXPONENTIATION || op === ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION;
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

/**
 * Evaluate an expression at varName = value by substitution.
 * Returns null if the expression can't be fully evaluated to a number.
 */
function evaluateAt(expr: ModelicaExpression, varName: string, value: number): number | null {
  if (expr instanceof ModelicaRealLiteral) return expr.value;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value;
  if (expr instanceof ModelicaNameExpression) {
    return expr.name === varName ? value : null;
  }
  if (expr instanceof ModelicaUnaryExpression) {
    if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      const v = evaluateAt(expr.operand, varName, value);
      return v !== null ? -v : null;
    }
    return null;
  }
  if (expr instanceof ModelicaBinaryExpression) {
    const l = evaluateAt(expr.operand1, varName, value);
    const r = evaluateAt(expr.operand2, varName, value);
    if (l === null || r === null) return null;
    switch (expr.operator) {
      case ModelicaBinaryOperator.ADDITION:
        return l + r;
      case ModelicaBinaryOperator.SUBTRACTION:
        return l - r;
      case ModelicaBinaryOperator.MULTIPLICATION:
        return l * r;
      case ModelicaBinaryOperator.DIVISION:
        return r !== 0 ? l / r : null;
      case ModelicaBinaryOperator.EXPONENTIATION:
        return Math.pow(l, r);
      default:
        return null;
    }
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    const args = (expr.args as ModelicaExpression[]).map((a) => evaluateAt(a, varName, value));
    if (args.some((a) => a === null)) return null;
    const vals = args as number[];
    switch (expr.functionName) {
      case "sin":
        return Math.sin(vals[0] ?? 0);
      case "cos":
        return Math.cos(vals[0] ?? 0);
      case "tan":
        return Math.tan(vals[0] ?? 0);
      case "exp":
        return Math.exp(vals[0] ?? 0);
      case "log":
        return Math.log(vals[0] ?? 0);
      case "sqrt":
        return Math.sqrt(vals[0] ?? 0);
      case "abs":
        return Math.abs(vals[0] ?? 0);
      default:
        return null;
    }
  }
  return null;
}

/**
 * Check if arg = a*varName + b (linear in varName).
 * Returns { a, b, isSimple } where isSimple means arg is just varName (a=1, b=0).
 */
function extractLinearArg(
  arg: ModelicaExpression,
  varName: string,
): { a: ModelicaExpression; b: ModelicaExpression; isSimple: boolean } | null {
  // arg is just x
  if (arg instanceof ModelicaNameExpression && arg.name === varName) {
    return { a: ONE, b: ZERO, isSimple: true };
  }

  // Not containing the variable — not a valid integrand in terms of varName
  if (!containsVar(arg, varName)) return null;

  // a*x: check for multiplication
  if (arg instanceof ModelicaBinaryExpression && isMul(arg.operator)) {
    if (
      arg.operand1 instanceof ModelicaNameExpression &&
      arg.operand1.name === varName &&
      !containsVar(arg.operand2, varName)
    ) {
      return { a: arg.operand2, b: ZERO, isSimple: false };
    }
    if (
      arg.operand2 instanceof ModelicaNameExpression &&
      arg.operand2.name === varName &&
      !containsVar(arg.operand1, varName)
    ) {
      return { a: arg.operand1, b: ZERO, isSimple: false };
    }
  }

  // a*x + b: check for addition
  if (arg instanceof ModelicaBinaryExpression && isAdd(arg.operator)) {
    const leftLin = extractLinearArg(arg.operand1, varName);
    if (leftLin && !containsVar(arg.operand2, varName)) {
      return { a: leftLin.a, b: add(leftLin.b, arg.operand2), isSimple: false };
    }
    const rightLin = extractLinearArg(arg.operand2, varName);
    if (rightLin && !containsVar(arg.operand1, varName)) {
      return { a: rightLin.a, b: add(arg.operand1, rightLin.b), isSimple: false };
    }
  }

  return null;
}
