// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Polynomial factoring utilities.
 *
 * Operates on the native ModelicaExpression AST. Provides common factor
 * extraction, quadratic factoring, and rational root theorem search.
 */

import { ModelicaBinaryOperator } from "@modelscript/modelica-ast";
import type { ModelicaExpression } from "../dae.js";
import { ModelicaBinaryExpression, ModelicaNameExpression, ModelicaRealLiteral } from "../dae.js";
import { add, mul, sub, ZERO } from "../symbolic-diff.js";
import { egraphSimplify } from "./egraph.js";
import { collectTerms, expandExpr, getLiteralValue } from "./expand.js";

// ─────────────────────────────────────────────────────────────────────
// Common Factor Extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract the greatest common numeric factor from a polynomial's coefficients.
 *
 * Given terms collected by `collectTerms`, finds the GCD of all numeric
 * coefficients and divides them out.
 *
 * @returns { factor, remainder } where expr = factor * remainder
 */
export function factorOutCommon(
  expr: ModelicaExpression,
  varName: string,
): { factor: ModelicaExpression; remainder: ModelicaExpression } | null {
  const terms = collectTerms(expr, varName);
  if (terms.size === 0) return null;

  // Extract numeric values of all coefficients
  const coeffValues: number[] = [];
  for (const coeff of terms.values()) {
    const val = getLiteralValue(coeff);
    if (val === null || val === 0) continue;
    coeffValues.push(Math.abs(val));
  }

  if (coeffValues.length === 0) return null;

  // Compute GCD of all coefficients
  let g = coeffValues[0] ?? 1;
  for (let i = 1; i < coeffValues.length; i++) {
    g = gcd(g, coeffValues[i] ?? 1);
  }

  if (g <= 1) return null;

  const factor = new ModelicaRealLiteral(g);
  // Divide each term's coefficient by g
  const newTerms = new Map<number, ModelicaExpression>();
  for (const [degree, coeff] of terms) {
    const val = getLiteralValue(coeff);
    if (val !== null) {
      newTerms.set(degree, new ModelicaRealLiteral(val / g));
    } else {
      newTerms.set(degree, coeff); // Can't divide non-numeric
    }
  }

  const remainder = termsToExpr(newTerms, varName);
  return { factor, remainder };
}

// ─────────────────────────────────────────────────────────────────────
// Quadratic Factoring
// ─────────────────────────────────────────────────────────────────────

/**
 * Factor a quadratic expression ax² + bx + c into a(x - r₁)(x - r₂)
 * if the roots are rational.
 *
 * @returns The factored expression, or null if roots are irrational/complex.
 */
export function factorQuadratic(expr: ModelicaExpression, varName: string): ModelicaExpression | null {
  const terms = collectTerms(expandExpr(expr), varName);
  const aExpr = terms.get(2);
  const bExpr = terms.get(1);
  const cExpr = terms.get(0);

  const a = aExpr ? getLiteralValue(aExpr) : null;
  const b = bExpr ? getLiteralValue(bExpr) : 0;
  const c = cExpr ? getLiteralValue(cExpr) : 0;

  if (a === null || a === 0) return null;
  if (b === null || c === null) return null;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrtD = Math.sqrt(discriminant);
  if (!Number.isFinite(sqrtD)) return null;

  const r1 = (-b + sqrtD) / (2 * a);
  const r2 = (-b - sqrtD) / (2 * a);

  // Check if roots are "nice" numbers (rational with limited precision)
  if (!isNiceNumber(r1) || !isNiceNumber(r2)) return null;

  const x = new ModelicaNameExpression(varName);
  const factor1 = sub(x, new ModelicaRealLiteral(r1));
  const factor2 = sub(x, new ModelicaRealLiteral(r2));
  const leading = new ModelicaRealLiteral(a);

  return mul(leading, mul(factor1, factor2));
}

// ─────────────────────────────────────────────────────────────────────
// Rational Root Theorem
// ─────────────────────────────────────────────────────────────────────

/**
 * Find rational roots of a polynomial using the rational root theorem.
 *
 * For a polynomial aₙxⁿ + ... + a₁x + a₀ with integer coefficients,
 * all rational roots p/q satisfy: p divides a₀ and q divides aₙ.
 */
export function rationalRoots(expr: ModelicaExpression, varName: string): number[] {
  const terms = collectTerms(expandExpr(expr), varName);
  const degrees = [...terms.keys()].sort((a, b) => b - a);

  if (degrees.length === 0) return [];

  // Extract integer coefficients
  const maxDeg = degrees[0] ?? 0;
  const coeffs: number[] = new Array(maxDeg + 1).fill(0);
  for (const [deg, coeff] of terms) {
    const val = getLiteralValue(coeff);
    if (val === null) return []; // Non-numeric coefficient
    coeffs[deg] = val;
  }

  const an = coeffs[maxDeg] ?? 0;
  const a0 = coeffs[0] ?? 0;

  if (an === 0 || a0 === 0) return []; // Degenerate

  // Get divisors of a0 and an
  const pDivisors = getDivisors(Math.abs(Math.round(a0)));
  const qDivisors = getDivisors(Math.abs(Math.round(an)));

  const roots: number[] = [];
  const tested = new Set<number>();

  for (const p of pDivisors) {
    for (const q of qDivisors) {
      for (const sign of [1, -1]) {
        const candidate = (sign * p) / q;
        const key = Math.round(candidate * 1e10);
        if (tested.has(key)) continue;
        tested.add(key);

        // Evaluate polynomial at candidate
        let value = 0;
        for (let i = 0; i <= maxDeg; i++) {
          value += (coeffs[i] ?? 0) * Math.pow(candidate, i);
        }
        if (Math.abs(value) < 1e-10) {
          roots.push(candidate);
        }
      }
    }
  }

  return roots;
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

/** Greatest common divisor for non-negative numbers. */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 1e-10) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/** Get all positive divisors of a positive integer. */
function getDivisors(n: number): number[] {
  if (n <= 0) return [1];
  n = Math.round(n);
  const divs: number[] = [];
  for (let i = 1; i * i <= n; i++) {
    if (n % i === 0) {
      divs.push(i);
      if (i !== n / i) divs.push(n / i);
    }
  }
  return divs.sort((a, b) => a - b);
}

/** Check if a number is "nice" (low-denominator rational). */
function isNiceNumber(x: number): boolean {
  if (!Number.isFinite(x)) return false;
  // Check if x is an integer or a simple fraction
  for (const denom of [1, 2, 3, 4, 5, 6, 8, 10]) {
    if (Math.abs(x * denom - Math.round(x * denom)) < 1e-10) return true;
  }
  return false;
}

/**
 * Reconstruct an expression from collected terms.
 */
function termsToExpr(terms: Map<number, ModelicaExpression>, varName: string): ModelicaExpression {
  const degrees = [...terms.keys()].sort((a, b) => b - a);
  let result: ModelicaExpression = ZERO;

  for (const deg of degrees) {
    const coeff = terms.get(deg);
    if (!coeff) continue;
    const val = getLiteralValue(coeff);
    if (val !== null && val === 0) continue;

    let term: ModelicaExpression;
    if (deg === 0) {
      term = coeff;
    } else {
      const x = new ModelicaNameExpression(varName) as ModelicaExpression;
      const xPow =
        deg === 1
          ? x
          : new ModelicaBinaryExpression(ModelicaBinaryOperator.EXPONENTIATION, x, new ModelicaRealLiteral(deg));
      term = mul(coeff, xPow);
    }

    result = add(result, term);
  }

  return egraphSimplify(result);
}
