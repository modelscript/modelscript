// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Expression evaluator using a computation tape for reverse-mode AD.
 *
 * Mirrors `DualExpressionEvaluator` but operates on `TapeNode` values
 * within a `Tape`, recording operations for backward-pass gradient computation.
 */

import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "@modelscript/modelica/ast";
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
import { type Tape, type TapeNode } from "./tape.js";

export class ReverseExpressionEvaluator {
  tape: Tape;
  /** Variable environment: name → TapeNode. */
  env: Map<string, TapeNode>;

  constructor(tape: Tape, env?: Map<string, TapeNode>) {
    this.tape = tape;
    this.env = env ?? new Map();
  }

  /** Evaluate a DAE expression, recording operations on the tape. Returns null on failure. */
  evaluate(expression: ModelicaExpression): TapeNode | null {
    if (expression instanceof ModelicaRealLiteral) {
      return this.tape.constant(expression.value);
    }
    if (expression instanceof ModelicaIntegerLiteral) {
      return this.tape.constant(expression.value);
    }
    if (expression instanceof ModelicaBooleanLiteral) {
      return this.tape.constant(expression.value ? 1 : 0);
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
          return this.tape.neg(operand);
        case ModelicaUnaryOperator.UNARY_PLUS:
        case ModelicaUnaryOperator.ELEMENTWISE_UNARY_PLUS:
          return operand;
        case ModelicaUnaryOperator.LOGICAL_NEGATION:
          return this.tape.constant(operand.val === 0 ? 1 : 0);
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
    // If-else: evaluate condition as scalar, derivative follows active branch
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

  private evaluateBinary(expression: ModelicaBinaryExpression): TapeNode | null {
    const left = this.evaluate(expression.operand1);
    const right = this.evaluate(expression.operand2);

    // Shortcut: 0 * anything = 0
    if (
      (expression.operator === ModelicaBinaryOperator.MULTIPLICATION ||
        expression.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION) &&
      ((left !== null && left.val === 0) || (right !== null && right.val === 0))
    ) {
      return this.tape.constant(0);
    }

    if (left === null || right === null) return null;

    switch (expression.operator) {
      case ModelicaBinaryOperator.ADDITION:
      case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
        return this.tape.add(left, right);
      case ModelicaBinaryOperator.SUBTRACTION:
      case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
        return this.tape.sub(left, right);
      case ModelicaBinaryOperator.MULTIPLICATION:
      case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
        return this.tape.mul(left, right);
      case ModelicaBinaryOperator.DIVISION:
      case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
        return right.val !== 0 ? this.tape.div(left, right) : null;
      case ModelicaBinaryOperator.EXPONENTIATION:
      case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
        return this.tape.pow(left, right);
      // Comparisons → constants (derivative 0)
      case ModelicaBinaryOperator.LESS_THAN:
        return this.tape.constant(left.val < right.val ? 1 : 0);
      case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
        return this.tape.constant(left.val <= right.val ? 1 : 0);
      case ModelicaBinaryOperator.GREATER_THAN:
        return this.tape.constant(left.val > right.val ? 1 : 0);
      case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
        return this.tape.constant(left.val >= right.val ? 1 : 0);
      case ModelicaBinaryOperator.EQUALITY:
        return this.tape.constant(left.val === right.val ? 1 : 0);
      case ModelicaBinaryOperator.INEQUALITY:
        return this.tape.constant(left.val !== right.val ? 1 : 0);
      case ModelicaBinaryOperator.LOGICAL_AND:
        return this.tape.constant(left.val !== 0 && right.val !== 0 ? 1 : 0);
      case ModelicaBinaryOperator.LOGICAL_OR:
        return this.tape.constant(left.val !== 0 || right.val !== 0 ? 1 : 0);
      default:
        return null;
    }
  }

  private evaluateFunctionCall(expr: ModelicaFunctionCallExpression): TapeNode | null {
    const name = expr.functionName;
    const args = expr.args;
    const arg0 = args[0] as ModelicaExpression | undefined;
    const arg1 = args[1] as ModelicaExpression | undefined;

    // Event operators
    switch (name) {
      case "pre": {
        if (!arg0) return null;
        const varName = this.extractVarName(arg0);
        if (varName) {
          const val = this.env.get(varName);
          if (val) return this.tape.constant(val.val); // Strip tracking for pre()
        }
        return this.evaluate(arg0);
      }
      case "edge":
      case "change":
      case "sample":
      case "initial":
      case "terminal":
        return this.tape.constant(0);
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
          return this.tape.sin(a);
        case "cos":
          return this.tape.cos(a);
        case "tan":
          return this.tape.tan(a);
        case "asin":
          return this.tape.asin(a);
        case "acos":
          return this.tape.acos(a);
        case "atan":
          return this.tape.atan(a);
        case "sinh":
          return this.tape.sinh(a);
        case "cosh":
          return this.tape.cosh(a);
        case "tanh":
          return this.tape.tanh(a);
        case "exp":
          return this.tape.exp(a);
        case "log":
          return a.val > 0 ? this.tape.log(a) : null;
        case "log10":
          return a.val > 0 ? this.tape.log10(a) : null;
        case "sqrt":
          return a.val >= 0 ? this.tape.sqrt(a) : null;
        case "abs":
          return this.tape.abs(a);
        case "sign":
          return this.tape.sign(a);
        case "ceil":
          return this.tape.ceil(a);
        case "floor":
          return this.tape.floor(a);
        case "integer":
          return this.tape.floor(a);
        case "der":
          return this.env.get(`der(${this.extractVarName(arg0) ?? ""})`) ?? this.tape.constant(0);
      }
    }

    // Math functions (two arguments)
    if (args.length === 2 && arg0 && arg1) {
      const a = this.evaluate(arg0);
      const b = this.evaluate(arg1);
      if (a === null || b === null) return null;
      switch (name) {
        case "atan2":
          return this.tape.atan2(a, b);
        case "max":
          return this.tape.max(a, b);
        case "min":
          return this.tape.min(a, b);
        case "mod":
          return b.val !== 0 ? this.tape.mod(a, b) : null;
        case "rem":
          return b.val !== 0 ? this.tape.rem(a, b) : null;
        case "div":
          return b.val !== 0 ? this.tape.trunc(a, b) : null;
      }
    }

    // homotopy(actual, simplified) — just use actual
    if (name === "homotopy" && arg0) {
      return this.evaluate(arg0);
    }

    return null;
  }

  private extractVarName(expr: ModelicaExpression): string | null {
    if (expr instanceof ModelicaVariable) return expr.name;
    if (expr instanceof ModelicaNameExpression) return expr.name;
    return null;
  }
}
