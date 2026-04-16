// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Expression evaluator using dual numbers for forward-mode automatic differentiation.
 *
 * Mirrors `ExpressionEvaluator` in dae.ts but operates on `Dual` values,
 * propagating derivatives through the computation graph via the chain rule.
 */

import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "@modelscript/modelica-polyglot/ast";
import {
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaBooleanVariable,
  type ModelicaExpression,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIntegerLiteral,
  ModelicaIntegerVariable,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaRealVariable,
  ModelicaUnaryExpression,
  ModelicaVariable,
} from "@modelscript/symbolics";
import { Dual } from "./dual.js";

export class DualExpressionEvaluator {
  /** Variable environment: name → Dual value. */
  env: Map<string, Dual>;

  constructor(env?: Map<string, Dual>) {
    this.env = env ?? new Map();
  }

  /** Evaluate a DAE expression to a Dual. Returns `null` on failure. */
  evaluate(expression: ModelicaExpression): Dual | null {
    if (expression instanceof ModelicaRealLiteral) {
      return Dual.constant(expression.value);
    }
    if (expression instanceof ModelicaIntegerLiteral) {
      return Dual.constant(expression.value);
    }
    if (expression instanceof ModelicaBooleanLiteral) {
      return Dual.constant(expression.value ? 1 : 0);
    }
    // Variable lookups
    if (expression instanceof ModelicaRealVariable || expression instanceof ModelicaIntegerVariable) {
      return this.env.get(expression.name) ?? null;
    }
    if (expression instanceof ModelicaBooleanVariable) {
      return this.env.get(expression.name) ?? null;
    }
    if (expression instanceof ModelicaNameExpression) {
      return this.env.get(expression.name) ?? null;
    }
    // Unary expressions
    if (expression instanceof ModelicaUnaryExpression) {
      const operand = this.evaluate(expression.operand);
      if (operand === null) return null;
      switch (expression.operator) {
        case ModelicaUnaryOperator.UNARY_MINUS:
        case ModelicaUnaryOperator.ELEMENTWISE_UNARY_MINUS:
          return operand.neg();
        case ModelicaUnaryOperator.UNARY_PLUS:
        case ModelicaUnaryOperator.ELEMENTWISE_UNARY_PLUS:
          return operand;
        case ModelicaUnaryOperator.LOGICAL_NEGATION:
          // Boolean: derivative 0
          return Dual.constant(operand.val === 0 ? 1 : 0);
        default:
          return null;
      }
    }
    // Binary expressions
    if (expression instanceof ModelicaBinaryExpression) {
      return this.evaluateBinary(expression);
    }
    // Function calls
    if (expression instanceof ModelicaFunctionCallExpression) {
      return this.evaluateFunctionCall(expression);
    }
    // If-else expressions: evaluate condition as scalar, derivative follows active branch
    if (expression instanceof ModelicaIfElseExpression) {
      const cond = this.evaluate(expression.condition);
      if (cond === null) return null;
      if (cond.val !== 0) return this.evaluate(expression.thenExpression);
      for (const clause of expression.elseIfClauses) {
        const c = this.evaluate(clause.condition);
        if (c === null) return null;
        if (c.val !== 0) return this.evaluate(clause.expression);
      }
      return this.evaluate(expression.elseExpression);
    }
    return null;
  }

  private evaluateBinary(expression: ModelicaBinaryExpression): Dual | null {
    const left = this.evaluate(expression.operand1);
    const right = this.evaluate(expression.operand2);

    // Shortcut: 0 * anything = 0
    if (
      (expression.operator === ModelicaBinaryOperator.MULTIPLICATION ||
        expression.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION) &&
      ((left !== null && left.val === 0 && left.dot === 0) || (right !== null && right.val === 0 && right.dot === 0))
    ) {
      return Dual.constant(0);
    }

    if (left === null || right === null) return null;

    switch (expression.operator) {
      // Arithmetic — use Dual methods for automatic derivative propagation
      case ModelicaBinaryOperator.ADDITION:
      case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
        return left.add(right);
      case ModelicaBinaryOperator.SUBTRACTION:
      case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
        return left.sub(right);
      case ModelicaBinaryOperator.MULTIPLICATION:
      case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
        return left.mul(right);
      case ModelicaBinaryOperator.DIVISION:
      case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
        return right.val !== 0 ? left.div(right) : null;
      case ModelicaBinaryOperator.EXPONENTIATION:
      case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
        return left.pow(right);
      // Comparisons → constant duals (derivative 0)
      case ModelicaBinaryOperator.LESS_THAN:
        return Dual.constant(left.val < right.val ? 1 : 0);
      case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
        return Dual.constant(left.val <= right.val ? 1 : 0);
      case ModelicaBinaryOperator.GREATER_THAN:
        return Dual.constant(left.val > right.val ? 1 : 0);
      case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
        return Dual.constant(left.val >= right.val ? 1 : 0);
      case ModelicaBinaryOperator.EQUALITY:
        return Dual.constant(left.val === right.val ? 1 : 0);
      case ModelicaBinaryOperator.INEQUALITY:
        return Dual.constant(left.val !== right.val ? 1 : 0);
      // Logical → constant duals
      case ModelicaBinaryOperator.LOGICAL_AND:
        return Dual.constant(left.val !== 0 && right.val !== 0 ? 1 : 0);
      case ModelicaBinaryOperator.LOGICAL_OR:
        return Dual.constant(left.val !== 0 || right.val !== 0 ? 1 : 0);
      default:
        return null;
    }
  }

  private evaluateFunctionCall(expr: ModelicaFunctionCallExpression): Dual | null {
    const name = expr.functionName;
    const args = expr.args;
    const arg0 = args[0] as ModelicaExpression | undefined;
    const arg1 = args[1] as ModelicaExpression | undefined;

    // Event operators — treat as value-only (derivative 0 or pass-through)
    switch (name) {
      case "pre": {
        // pre() returns the previous-step value — no derivative w.r.t. current seed
        if (!arg0) return null;
        const varName = this.extractVarName(arg0);
        if (varName) {
          const val = this.env.get(varName);
          if (val) return Dual.constant(val.val); // Strip derivative for pre()
        }
        return this.evaluate(arg0);
      }
      case "edge":
      case "change":
      case "sample":
      case "initial":
      case "terminal":
        // Boolean event functions — constant w.r.t. continuous variables
        return Dual.constant(0);
      case "noEvent":
        if (arg0) return this.evaluate(arg0);
        return null;
      case "smooth":
        if (arg1) return this.evaluate(arg1);
        if (arg0) return this.evaluate(arg0);
        return null;
      case "/*Real*/":
      case "/*Integer*/":
      case "/*Boolean*/":
        if (arg0) return this.evaluate(arg0);
        return null;
    }

    // Math functions (single argument)
    if (args.length === 1 && arg0) {
      const a = this.evaluate(arg0);
      if (a === null) return null;
      switch (name) {
        case "sin":
          return Dual.sin(a);
        case "cos":
          return Dual.cos(a);
        case "tan":
          return Dual.tan(a);
        case "asin":
          return Dual.asin(a);
        case "acos":
          return Dual.acos(a);
        case "atan":
          return Dual.atan(a);
        case "sinh":
          return Dual.sinh(a);
        case "cosh":
          return Dual.cosh(a);
        case "tanh":
          return Dual.tanh(a);
        case "exp":
          return Dual.exp(a);
        case "log":
          return a.val > 0 ? Dual.log(a) : null;
        case "log10":
          return a.val > 0 ? Dual.log10(a) : null;
        case "sqrt":
          return a.val >= 0 ? Dual.sqrt(a) : null;
        case "abs":
          return Dual.abs(a);
        case "sign":
          return Dual.sign(a);
        case "ceil":
          return Dual.ceil(a);
        case "floor":
          return Dual.floor(a);
        case "integer":
          return Dual.floor(a);
        case "der":
          return this.env.get(`der(${this.extractVarName(arg0) ?? ""})`) ?? Dual.constant(0);
      }
    }

    // Math functions (two arguments)
    if (args.length === 2 && arg0 && arg1) {
      const a = this.evaluate(arg0);
      const b = this.evaluate(arg1);
      if (a === null || b === null) return null;
      switch (name) {
        case "atan2":
          return Dual.atan2(a, b);
        case "max":
          return Dual.max(a, b);
        case "min":
          return Dual.min(a, b);
        case "mod":
          return b.val !== 0 ? Dual.mod(a, b) : null;
        case "rem":
          return b.val !== 0 ? Dual.rem(a, b) : null;
        case "div":
          return b.val !== 0 ? Dual.trunc(a, b) : null;
      }
    }

    // homotopy(actual, simplified) — just use actual
    if (name === "homotopy" && arg0) {
      return this.evaluate(arg0);
    }

    return null;
  }

  /** Extract a variable name from a DAE expression. */
  private extractVarName(expr: ModelicaExpression): string | null {
    if (expr instanceof ModelicaVariable) return expr.name;
    if (expr instanceof ModelicaNameExpression) return expr.name;
    return null;
  }
}
