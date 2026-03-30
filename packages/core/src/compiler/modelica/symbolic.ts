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
import { add, differentiateExpr, div, isOne, isZero, mul, simplifyExpr, sub, ZERO } from "./symbolic-diff.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "./syntax.js";

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
      const varDef = dae.variables.find((v) => v.name === aliasVar);
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
      const varIdx = dae.variables.findIndex((v) => v.name === aliasVar);
      if (varIdx >= 0) dae.variables.splice(varIdx, 1);

      // Remove from unknowns set
      unknowns.delete(aliasVar);

      changed = true;
      break; // restart scan from the beginning
    }
  }
}
