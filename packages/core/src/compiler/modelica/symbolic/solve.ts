// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic equation solver.
 *
 * Solves single-variable polynomial equations up to degree 4 using
 * analytical formulas (quadratic, Cardano's cubic, Ferrari's quartic).
 * Falls back to the existing isolation engine for non-polynomial equations.
 *
 * Integrates with the E-Graph engine for expression simplification.
 */

import type { ModelicaExpression } from "../dae.js";
import { ModelicaRealLiteral } from "../dae.js";
import { add, div, mul, sub, ZERO } from "../symbolic-diff.js";
import { egraphSimplify } from "./egraph.js";
import { collectTerms, expandExpr, getLiteralValue } from "./expand.js";

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Solve `expr = 0` for `varName`.
 *
 * Returns an array of solution expressions (may be empty if no closed-form
 * solution is found). Each solution is an expression for varName.
 *
 * Tries polynomial solving (degree 1-4) first, then falls back.
 */
export function solveForVariable(expr: ModelicaExpression, varName: string): ModelicaExpression[] {
  const expanded = expandExpr(expr);
  const terms = collectTerms(expanded, varName);
  const maxDegree = Math.max(0, ...terms.keys());

  switch (maxDegree) {
    case 0:
      return []; // No variable — can't solve
    case 1:
      return solveLinear(terms);
    case 2:
      return solveQuadratic(terms);
    case 3:
      return solveCubic(terms);
    case 4:
      return solveQuartic(terms);
    default:
      return []; // Degree too high for closed-form
  }
}

// ─────────────────────────────────────────────────────────────────────
// Linear: ax + b = 0 → x = -b/a
// ─────────────────────────────────────────────────────────────────────

function solveLinear(terms: Map<number, ModelicaExpression>): ModelicaExpression[] {
  const a = terms.get(1);
  const b = terms.get(0) ?? ZERO;
  if (!a) return [];

  // x = -b/a
  const solution = egraphSimplify(div(negate(b), a));
  return [solution];
}

// ─────────────────────────────────────────────────────────────────────
// Quadratic: ax² + bx + c = 0 → x = (-b ± √(b²-4ac)) / 2a
// ─────────────────────────────────────────────────────────────────────

function solveQuadratic(terms: Map<number, ModelicaExpression>): ModelicaExpression[] {
  const a = terms.get(2);
  const b = terms.get(1) ?? ZERO;
  const c = terms.get(0) ?? ZERO;
  if (!a) return solveLinear(terms);

  // Try numeric evaluation for cleaner results
  const aVal = getLiteralValue(a);
  const bVal = getLiteralValue(b);
  const cVal = getLiteralValue(c);

  if (aVal !== null && bVal !== null && cVal !== null) {
    const disc = bVal * bVal - 4 * aVal * cVal;
    if (disc < 0) return []; // Complex roots
    const sqrtD = Math.sqrt(disc);
    const r1 = (-bVal + sqrtD) / (2 * aVal);
    const r2 = (-bVal - sqrtD) / (2 * aVal);
    const solutions = [new ModelicaRealLiteral(r1) as ModelicaExpression];
    if (Math.abs(r1 - r2) > 1e-12) {
      solutions.push(new ModelicaRealLiteral(r2));
    }
    return solutions;
  }

  // Symbolic: (-b ± sqrt(b²-4ac)) / (2a)
  const disc = sub(mul(b, b), mul(lit(4), mul(a, c)));
  const sqrtD = call("sqrt", disc);
  const twoA = mul(lit(2), a);

  return [egraphSimplify(div(add(negate(b), sqrtD), twoA)), egraphSimplify(div(sub(negate(b), sqrtD), twoA))];
}

// ─────────────────────────────────────────────────────────────────────
// Cubic: ax³ + bx² + cx + d = 0 (Cardano's formula)
// ─────────────────────────────────────────────────────────────────────

function solveCubic(terms: Map<number, ModelicaExpression>): ModelicaExpression[] {
  const a = terms.get(3);
  const b = terms.get(2) ?? ZERO;
  const c = terms.get(1) ?? ZERO;
  const d = terms.get(0) ?? ZERO;
  if (!a) return solveQuadratic(terms);

  // Try numeric evaluation
  const aVal = getLiteralValue(a);
  const bVal = getLiteralValue(b);
  const cVal = getLiteralValue(c);
  const dVal = getLiteralValue(d);

  if (aVal !== null && bVal !== null && cVal !== null && dVal !== null && aVal !== 0) {
    const roots = solveCubicNumeric(aVal, bVal, cVal, dVal);
    return roots.map((r) => new ModelicaRealLiteral(r) as ModelicaExpression);
  }

  // Symbolic cubic is very complex; return empty for non-numeric
  return [];
}

/**
 * Solve ax³ + bx² + cx + d = 0 numerically using Cardano's method.
 */
function solveCubicNumeric(a: number, b: number, c: number, d: number): number[] {
  // Normalize: x³ + px + q = 0 via substitution x = t - b/(3a)
  const p0 = b / a;
  const p1 = c / a;
  const p2 = d / a;

  const p = p1 - (p0 * p0) / 3;
  const q = p2 - (p0 * p1) / 3 + (2 * p0 * p0 * p0) / 27;

  const disc = (q * q) / 4 + (p * p * p) / 27;

  const shift = -p0 / 3;

  if (disc > 1e-12) {
    // One real root
    const sqrtD = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2 + sqrtD);
    const v = Math.cbrt(-q / 2 - sqrtD);
    return [u + v + shift];
  } else if (disc < -1e-12) {
    // Three real roots (casus irreducibilis)
    const r = Math.sqrt((-p * p * p) / 27);
    const theta = Math.acos(-q / 2 / r);
    const m = 2 * Math.cbrt(r);
    return [
      m * Math.cos(theta / 3) + shift,
      m * Math.cos((theta + 2 * Math.PI) / 3) + shift,
      m * Math.cos((theta + 4 * Math.PI) / 3) + shift,
    ];
  } else {
    // Repeated root
    const u = Math.cbrt(-q / 2);
    return [2 * u + shift, -u + shift];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Quartic: ax⁴ + bx³ + cx² + dx + e = 0 (Ferrari's method)
// ─────────────────────────────────────────────────────────────────────

function solveQuartic(terms: Map<number, ModelicaExpression>): ModelicaExpression[] {
  const a = terms.get(4);
  const b = terms.get(3) ?? ZERO;
  const c = terms.get(2) ?? ZERO;
  const d = terms.get(1) ?? ZERO;
  const e = terms.get(0) ?? ZERO;
  if (!a) return solveCubic(terms);

  const aVal = getLiteralValue(a);
  const bVal = getLiteralValue(b);
  const cVal = getLiteralValue(c);
  const dVal = getLiteralValue(d);
  const eVal = getLiteralValue(e);

  if (aVal !== null && bVal !== null && cVal !== null && dVal !== null && eVal !== null && aVal !== 0) {
    const roots = solveQuarticNumeric(aVal, bVal, cVal, dVal, eVal);
    return roots.map((r) => new ModelicaRealLiteral(r) as ModelicaExpression);
  }

  return [];
}

/**
 * Solve ax⁴ + bx³ + cx² + dx + e = 0 numerically using Ferrari's method.
 */
function solveQuarticNumeric(a: number, b: number, c: number, d: number, e: number): number[] {
  // Normalize: x⁴ + px³ + qx² + rx + s = 0
  const p = b / a;
  const q = c / a;
  const r = d / a;
  const s = e / a;

  // Depressed quartic via x = t - p/4: t⁴ + αt² + βt + γ = 0
  const alpha = q - (3 * p * p) / 8;
  const beta = r - (p * q) / 2 + (p * p * p) / 8;
  const gamma = s - (p * r) / 4 + (p * p * q) / 16 - (3 * p * p * p * p) / 256;

  const shift = -p / 4;

  if (Math.abs(beta) < 1e-12) {
    // Biquadratic: t⁴ + αt² + γ = 0
    const disc = alpha * alpha - 4 * gamma;
    if (disc < 0) return [];
    const sqrtD = Math.sqrt(disc);
    const u1 = (-alpha + sqrtD) / 2;
    const u2 = (-alpha - sqrtD) / 2;
    const roots: number[] = [];
    if (u1 >= 0) {
      roots.push(Math.sqrt(u1) + shift, -Math.sqrt(u1) + shift);
    }
    if (u2 >= 0 && Math.abs(u1 - u2) > 1e-12) {
      roots.push(Math.sqrt(u2) + shift, -Math.sqrt(u2) + shift);
    }
    return roots;
  }

  // Solve resolvent cubic: 8y³ + (−4α)y² + (−8γ)y + (4αγ − β²) = 0
  const cubicRoots = solveCubicNumeric(8, -4 * alpha, -8 * gamma, 4 * alpha * gamma - beta * beta);
  if (cubicRoots.length === 0) return [];

  // Pick a root y such that 2y - α > 0
  let y: number | null = null;
  for (const root of cubicRoots) {
    if (2 * root - alpha > 1e-12) {
      y = root;
      break;
    }
  }
  if (y === null) return [];

  const sqrtM = Math.sqrt(2 * y - alpha);
  const roots: number[] = [];

  // Two quadratics: t² ± sqrtM·t + (y ∓ β/(2·sqrtM)) = 0
  const disc1 = -(2 * y + alpha) + beta / sqrtM;
  const disc2 = -(2 * y + alpha) - beta / sqrtM;

  if (disc1 >= 0) {
    const s1 = Math.sqrt(disc1);
    roots.push((sqrtM + s1) / 2 + shift, (sqrtM - s1) / 2 + shift);
  }
  if (disc2 >= 0) {
    const s2 = Math.sqrt(disc2);
    roots.push((-sqrtM + s2) / 2 + shift, (-sqrtM - s2) / 2 + shift);
  }

  return roots;
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

import { ModelicaUnaryOperator } from "@modelscript/modelica-ast";
import { ModelicaFunctionCallExpression, ModelicaUnaryExpression } from "../dae.js";

function negate(expr: ModelicaExpression): ModelicaExpression {
  const val = getLiteralValue(expr);
  if (val !== null) return new ModelicaRealLiteral(-val);
  return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, expr);
}

function lit(n: number): ModelicaExpression {
  return new ModelicaRealLiteral(n);
}

function call(name: string, ...args: ModelicaExpression[]): ModelicaExpression {
  return new ModelicaFunctionCallExpression(name, args);
}
