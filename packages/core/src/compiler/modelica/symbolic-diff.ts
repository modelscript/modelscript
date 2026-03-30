// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic differentiation of Modelica DAE expressions.
 *
 * Given an expression `f(x₁, x₂, ..., t)` and a variable name `xᵢ`,
 * computes ∂f/∂xᵢ as a new `ModelicaExpression` AST node.
 *
 * Supports:
 *   - Constants (literals) → 0
 *   - Variable references → 0 or 1
 *   - Arithmetic operators (+, -, *, /, ^) via standard rules
 *   - Unary negation → -d(operand)/dx
 *   - Standard math functions (sin, cos, tan, exp, log, sqrt, abs) via chain rule
 *   - If-else expressions → conditional derivative
 *
 * Used for:
 *   - Jacobian generation in FMI 2.0 `fmi2GetDirectionalDerivative`
 *   - Sensitivity analysis in the TypeScript simulator
 */

import type { ModelicaExpression } from "./dae.js";
import {
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
} from "./dae.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "./syntax.js";

/**
 * Symbolically differentiate an expression with respect to a variable.
 *
 * @param expr    The expression to differentiate
 * @param varName The variable name to differentiate with respect to
 * @returns       A new expression representing ∂expr/∂varName
 */
export function differentiateExpr(expr: ModelicaExpression, varName: string): ModelicaExpression {
  // ── Literals: d(const)/dx = 0 ──
  if (
    expr instanceof ModelicaRealLiteral ||
    expr instanceof ModelicaIntegerLiteral ||
    expr instanceof ModelicaBooleanLiteral ||
    expr instanceof ModelicaStringLiteral
  ) {
    return ZERO;
  }

  // ── Variable reference: d(x)/dx = 1, d(y)/dx = 0 ──
  if (expr instanceof ModelicaNameExpression) {
    return expr.name === varName ? ONE : ZERO;
  }

  // ── Generic variable/name fallback ──
  if (expr && typeof expr === "object" && "name" in expr) {
    return (expr as { name: string }).name === varName ? ONE : ZERO;
  }

  // ── Unary expression ──
  if (expr instanceof ModelicaUnaryExpression) {
    const dOp = differentiateExpr(expr.operand, varName);
    if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      // d(-f)/dx = -(df/dx)
      if (isZero(dOp)) return ZERO;
      return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, dOp);
    }
    // Logical NOT — not differentiable
    return ZERO;
  }

  // ── Binary expression ──
  if (expr instanceof ModelicaBinaryExpression) {
    return differentiateBinary(expr, varName);
  }

  // ── Function call: chain rule ──
  if (expr instanceof ModelicaFunctionCallExpression) {
    return differentiateFunctionCall(expr, varName);
  }

  // ── If-else expression: differentiate each branch ──
  if (expr instanceof ModelicaIfElseExpression) {
    const dThen = differentiateExpr(expr.thenExpression, varName);
    const dElse = differentiateExpr(expr.elseExpression, varName);
    const dElseIfs = expr.elseIfClauses.map((c) => ({
      condition: c.condition,
      expression: differentiateExpr(c.expression, varName),
    }));
    return new ModelicaIfElseExpression(expr.condition, dThen, dElseIfs, dElse);
  }

  // Unknown expression type — return 0 (conservative)
  return ZERO;
}

// ── Constants ──
const ZERO = new ModelicaRealLiteral(0);
const ONE = new ModelicaRealLiteral(1);
const TWO = new ModelicaRealLiteral(2);
const HALF = new ModelicaRealLiteral(0.5);
const NEG_ONE = new ModelicaRealLiteral(-1);

// ── Helpers ──

/** Check if an expression is the constant zero. */
function isZero(expr: ModelicaExpression): boolean {
  if (expr instanceof ModelicaRealLiteral) return expr.value === 0;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value === 0;
  return false;
}

/** Check if an expression is the constant one. */
function isOne(expr: ModelicaExpression): boolean {
  if (expr instanceof ModelicaRealLiteral) return expr.value === 1;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value === 1;
  return false;
}

/** Simplified addition: skip adding zero. */
function add(a: ModelicaExpression, b: ModelicaExpression): ModelicaExpression {
  if (isZero(a)) return b;
  if (isZero(b)) return a;
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, a, b);
}

/** Simplified subtraction: skip subtracting zero. */
function sub(a: ModelicaExpression, b: ModelicaExpression): ModelicaExpression {
  if (isZero(b)) return a;
  if (isZero(a)) return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, b);
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, a, b);
}

/** Simplified multiplication: skip multiplying by 0 or 1. */
function mul(a: ModelicaExpression, b: ModelicaExpression): ModelicaExpression {
  if (isZero(a) || isZero(b)) return ZERO;
  if (isOne(a)) return b;
  if (isOne(b)) return a;
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, a, b);
}

/** Simplified division. */
function div(a: ModelicaExpression, b: ModelicaExpression): ModelicaExpression {
  if (isZero(a)) return ZERO;
  if (isOne(b)) return a;
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, a, b);
}

/** Build a power expression. */
function pow(base: ModelicaExpression, exp: ModelicaExpression): ModelicaExpression {
  if (isZero(exp)) return ONE;
  if (isOne(exp)) return base;
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.EXPONENTIATION, base, exp);
}

/** Build a function call expression. */
function call(name: string, ...args: ModelicaExpression[]): ModelicaFunctionCallExpression {
  return new ModelicaFunctionCallExpression(name, args);
}

// ── Binary differentiation ──

function differentiateBinary(expr: ModelicaBinaryExpression, varName: string): ModelicaExpression {
  const { operand1: u, operand2: v, operator: op } = expr;
  const du = differentiateExpr(u, varName);
  const dv = differentiateExpr(v, varName);

  switch (op) {
    // d(u + v)/dx = du/dx + dv/dx
    case ModelicaBinaryOperator.ADDITION:
    case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
      return add(du, dv);

    // d(u - v)/dx = du/dx - dv/dx
    case ModelicaBinaryOperator.SUBTRACTION:
    case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
      return sub(du, dv);

    // Product rule: d(u * v)/dx = u * dv/dx + du/dx * v
    case ModelicaBinaryOperator.MULTIPLICATION:
    case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
      return add(mul(u, dv), mul(du, v));

    // Quotient rule: d(u / v)/dx = (du/dx * v - u * dv/dx) / v²
    case ModelicaBinaryOperator.DIVISION:
    case ModelicaBinaryOperator.ELEMENTWISE_DIVISION: {
      const num = sub(mul(du, v), mul(u, dv));
      const den = mul(v, v);
      return div(num, den);
    }

    // Power rule: d(u^v)/dx
    // General case: u^v * (v' * ln(u) + v * u'/u)
    // Special case when v is constant: v * u^(v-1) * u'
    case ModelicaBinaryOperator.EXPONENTIATION:
    case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION: {
      if (isZero(dv)) {
        // v is constant: d(u^n)/dx = n * u^(n-1) * du/dx
        const n = v;
        const nMinus1 = sub(n, ONE);
        return mul(mul(n, pow(u, nMinus1)), du);
      }
      if (isZero(du)) {
        // u is constant: d(c^v)/dx = c^v * ln(c) * dv/dx
        return mul(mul(expr, call("log", u)), dv);
      }
      // General case: u^v * (dv * ln(u) + v * du / u)
      return mul(expr, add(mul(dv, call("log", u)), div(mul(v, du), u)));
    }

    // Relational/logical operators — not differentiable, return 0
    default:
      return ZERO;
  }
}

// ── Function call differentiation (chain rule) ──

function differentiateFunctionCall(expr: ModelicaFunctionCallExpression, varName: string): ModelicaExpression {
  const fname = expr.functionName;
  const args = expr.args as ModelicaExpression[];

  // Most math functions are f(g(x)), so d/dx = f'(g(x)) * g'(x)
  if (args.length === 1) {
    const u = args[0];
    if (!u) return ZERO;
    const du = differentiateExpr(u, varName);

    if (isZero(du)) return ZERO;

    let outerDerivative: ModelicaExpression;

    switch (fname) {
      // d(sin(u))/dx = cos(u) * du/dx
      case "sin":
      case "Modelica.Math.sin":
        outerDerivative = call("cos", u);
        break;

      // d(cos(u))/dx = -sin(u) * du/dx
      case "cos":
      case "Modelica.Math.cos":
        outerDerivative = new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, call("sin", u));
        break;

      // d(tan(u))/dx = (1 / cos²(u)) * du/dx
      case "tan":
      case "Modelica.Math.tan": {
        const cosU = call("cos", u);
        outerDerivative = div(ONE, mul(cosU, cosU));
        break;
      }

      // d(asin(u))/dx = 1/√(1-u²) * du/dx
      case "asin":
      case "Modelica.Math.asin":
        outerDerivative = div(ONE, call("sqrt", sub(ONE, mul(u, u))));
        break;

      // d(acos(u))/dx = -1/√(1-u²) * du/dx
      case "acos":
      case "Modelica.Math.acos":
        outerDerivative = new ModelicaUnaryExpression(
          ModelicaUnaryOperator.UNARY_MINUS,
          div(ONE, call("sqrt", sub(ONE, mul(u, u)))),
        );
        break;

      // d(atan(u))/dx = 1/(1+u²) * du/dx
      case "atan":
      case "Modelica.Math.atan":
        outerDerivative = div(ONE, add(ONE, mul(u, u)));
        break;

      // d(exp(u))/dx = exp(u) * du/dx
      case "exp":
      case "Modelica.Math.exp":
        outerDerivative = call("exp", u);
        break;

      // d(log(u))/dx = (1/u) * du/dx
      case "log":
      case "Modelica.Math.log":
        outerDerivative = div(ONE, u);
        break;

      // d(log10(u))/dx = 1/(u * ln(10)) * du/dx
      case "log10":
      case "Modelica.Math.log10":
        outerDerivative = div(ONE, mul(u, new ModelicaRealLiteral(Math.LN10)));
        break;

      // d(sqrt(u))/dx = 1/(2*sqrt(u)) * du/dx
      case "sqrt":
        outerDerivative = div(HALF, call("sqrt", u));
        break;

      // d(abs(u))/dx = sign(u) * du/dx  (not differentiable at 0, but useful approximation)
      case "abs":
        outerDerivative = call("sign", u);
        break;

      // d(sinh(u))/dx = cosh(u) * du/dx
      case "sinh":
      case "Modelica.Math.sinh":
        outerDerivative = call("cosh", u);
        break;

      // d(cosh(u))/dx = sinh(u) * du/dx
      case "cosh":
      case "Modelica.Math.cosh":
        outerDerivative = call("sinh", u);
        break;

      // d(tanh(u))/dx = (1 - tanh²(u)) * du/dx
      case "tanh":
      case "Modelica.Math.tanh": {
        const tanhU = call("tanh", u);
        outerDerivative = sub(ONE, mul(tanhU, tanhU));
        break;
      }

      // d(sign(u))/dx = 0 (piecewise constant)
      case "sign":
        return ZERO;

      // d(floor(u))/dx = 0 (piecewise constant)
      case "floor":
      case "ceil":
      case "integer":
        return ZERO;

      default:
        // Unknown function — return 0 (conservative)
        return ZERO;
    }

    return mul(outerDerivative, du);
  }

  // Two-argument functions
  if (args.length === 2) {
    const u = args[0];
    const v = args[1];
    if (!u || !v) return ZERO;
    const du = differentiateExpr(u, varName);
    const dv = differentiateExpr(v, varName);

    switch (fname) {
      // d(atan2(u, v))/dx = (v*du - u*dv) / (u² + v²)
      case "atan2":
      case "Modelica.Math.atan2":
        return div(sub(mul(v, du), mul(u, dv)), add(mul(u, u), mul(v, v)));

      // d(max(u, v))/dx ≈ if u > v then du else dv
      case "max":
        return new ModelicaIfElseExpression(
          new ModelicaBinaryExpression(ModelicaBinaryOperator.GREATER_THAN, u, v),
          du,
          [],
          dv,
        );

      // d(min(u, v))/dx ≈ if u < v then du else dv
      case "min":
        return new ModelicaIfElseExpression(
          new ModelicaBinaryExpression(ModelicaBinaryOperator.LESS_THAN, u, v),
          du,
          [],
          dv,
        );

      default:
        return ZERO;
    }
  }

  return ZERO;
}

/**
 * Simplify an expression by applying constant folding and algebraic identities.
 * Applied after differentiation to reduce expression complexity.
 */
export function simplifyExpr(expr: ModelicaExpression): ModelicaExpression {
  if (expr instanceof ModelicaUnaryExpression) {
    const op = simplifyExpr(expr.operand);
    if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      // --x → x
      if (op instanceof ModelicaUnaryExpression && op.operator === ModelicaUnaryOperator.UNARY_MINUS) {
        return op.operand;
      }
      // -0 → 0
      if (isZero(op)) return ZERO;
      // -literal → literal
      if (op instanceof ModelicaRealLiteral) return new ModelicaRealLiteral(-op.value);
      if (op instanceof ModelicaIntegerLiteral) return new ModelicaIntegerLiteral(-op.value);
    }
    if (op === expr.operand) return expr;
    return new ModelicaUnaryExpression(expr.operator, op);
  }

  if (expr instanceof ModelicaBinaryExpression) {
    const l = simplifyExpr(expr.operand1);
    const r = simplifyExpr(expr.operand2);

    // Constant folding
    if (l instanceof ModelicaRealLiteral && r instanceof ModelicaRealLiteral) {
      switch (expr.operator) {
        case ModelicaBinaryOperator.ADDITION:
          return new ModelicaRealLiteral(l.value + r.value);
        case ModelicaBinaryOperator.SUBTRACTION:
          return new ModelicaRealLiteral(l.value - r.value);
        case ModelicaBinaryOperator.MULTIPLICATION:
          return new ModelicaRealLiteral(l.value * r.value);
        case ModelicaBinaryOperator.DIVISION:
          if (r.value !== 0) return new ModelicaRealLiteral(l.value / r.value);
          break;
        case ModelicaBinaryOperator.EXPONENTIATION:
          return new ModelicaRealLiteral(Math.pow(l.value, r.value));
      }
    }

    // Algebraic identities
    switch (expr.operator) {
      case ModelicaBinaryOperator.ADDITION:
      case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
        if (isZero(l)) return r;
        if (isZero(r)) return l;
        break;
      case ModelicaBinaryOperator.SUBTRACTION:
      case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
        if (isZero(r)) return l;
        if (isZero(l)) return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, r);
        break;
      case ModelicaBinaryOperator.MULTIPLICATION:
      case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
        if (isZero(l) || isZero(r)) return ZERO;
        if (isOne(l)) return r;
        if (isOne(r)) return l;
        break;
      case ModelicaBinaryOperator.DIVISION:
      case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
        if (isZero(l)) return ZERO;
        if (isOne(r)) return l;
        break;
      case ModelicaBinaryOperator.EXPONENTIATION:
      case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
        if (isZero(r)) return ONE;
        if (isOne(r)) return l;
        break;
    }

    if (l === expr.operand1 && r === expr.operand2) return expr;
    return new ModelicaBinaryExpression(expr.operator, l, r);
  }

  if (expr instanceof ModelicaFunctionCallExpression) {
    const args = (expr.args as ModelicaExpression[]).map(simplifyExpr);
    return new ModelicaFunctionCallExpression(expr.functionName, args);
  }

  if (expr instanceof ModelicaIfElseExpression) {
    return new ModelicaIfElseExpression(
      expr.condition,
      simplifyExpr(expr.thenExpression),
      expr.elseIfClauses.map((c) => ({ condition: c.condition, expression: simplifyExpr(c.expression) })),
      simplifyExpr(expr.elseExpression),
    );
  }

  return expr;
}

// Re-export for convenience
export { HALF as DIFF_HALF, NEG_ONE as DIFF_NEG_ONE, ONE as DIFF_ONE, TWO as DIFF_TWO, ZERO as DIFF_ZERO };
