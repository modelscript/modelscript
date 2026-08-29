// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-native polynomial factoring utilities.
 *
 * Provides common factor extraction, quadratic factoring, and rational
 * root theorem search. All operations work on ArenaDAEBuilder expression
 * IDs (numbers).
 */

import type { ArenaDAEBuilder } from "../../dae-arena.js";
import { collectArenaTerms, getArenaLiteralValue } from "../algebra/solve.js";
import { mul, sub } from "../calculus/derivative.js";
import { arenaTermsToExpr, expandArenaExpr } from "./expand.js";

// ─────────────────────────────────────────────────────────────────────
// Common Factor Extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract the greatest common numeric factor from a polynomial's coefficients.
 *
 * Given an expression polynomial in `varName`, finds the GCD of all numeric
 * coefficients and divides them out.
 *
 * @returns { factor, remainder } expression IDs where expr ≈ factor * remainder,
 *          or null if no common factor > 1 exists.
 */
export function factorOutCommonArena(
  arena: ArenaDAEBuilder,
  exprId: number,
  varName: string,
): { factor: number; remainder: number } | null {
  const terms = collectArenaTerms(arena, exprId, varName);
  if (terms.size === 0) return null;

  // Extract numeric values of all coefficients
  const coeffValues: number[] = [];
  for (const coeff of terms.values()) {
    const val = getArenaLiteralValue(arena, coeff);
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

  const factor = arena.addRealLiteral(g);

  // Divide each term's coefficient by g
  const newTerms = new Map<number, number>();
  for (const [degree, coeff] of terms) {
    const val = getArenaLiteralValue(arena, coeff);
    if (val !== null) {
      newTerms.set(degree, arena.addRealLiteral(val / g));
    } else {
      newTerms.set(degree, coeff); // Can't divide non-numeric
    }
  }

  const remainder = arenaTermsToExpr(arena, newTerms, varName);
  return { factor, remainder };
}

// ─────────────────────────────────────────────────────────────────────
// Quadratic Factoring
// ─────────────────────────────────────────────────────────────────────

/**
 * Factor a quadratic expression ax² + bx + c into a(x - r₁)(x - r₂)
 * if the roots are rational (nice numbers).
 *
 * @returns The factored expression ID, or null if roots are irrational/complex.
 */
export function factorQuadraticArena(arena: ArenaDAEBuilder, exprId: number, varName: string): number | null {
  const expanded = expandArenaExpr(arena, exprId);
  const terms = collectArenaTerms(arena, expanded, varName);

  const aExpr = terms.get(2);
  const bExpr = terms.get(1);
  const cExpr = terms.get(0);

  const a = aExpr !== undefined ? getArenaLiteralValue(arena, aExpr) : null;
  const b = bExpr !== undefined ? getArenaLiteralValue(arena, bExpr) : 0;
  const c = cExpr !== undefined ? getArenaLiteralValue(arena, cExpr) : 0;

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

  const x = arena.addNameExpr(varName);
  const factor1 = sub(arena, x, arena.addRealLiteral(r1));
  const factor2 = sub(arena, x, arena.addRealLiteral(r2));
  const leading = arena.addRealLiteral(a);

  return mul(arena, leading, mul(arena, factor1, factor2));
}

// ─────────────────────────────────────────────────────────────────────
// Rational Root Theorem
// ─────────────────────────────────────────────────────────────────────

/**
 * Find rational roots of a polynomial using the rational root theorem.
 *
 * For a polynomial aₙxⁿ + ... + a₁x + a₀ with integer coefficients,
 * all rational roots p/q satisfy: p divides a₀ and q divides aₙ.
 *
 * @returns Array of numeric root values.
 */
export function rationalRootsArena(arena: ArenaDAEBuilder, exprId: number, varName: string): number[] {
  const expanded = expandArenaExpr(arena, exprId);
  const terms = collectArenaTerms(arena, expanded, varName);
  const degrees = [...terms.keys()].sort((a, b) => b - a);

  if (degrees.length === 0) return [];

  // Extract numeric coefficients
  const maxDeg = degrees[0] ?? 0;
  const coeffs: number[] = new Array(maxDeg + 1).fill(0);
  for (const [deg, coeff] of terms) {
    const val = getArenaLiteralValue(arena, coeff);
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
// Utilities (exported for testing / reuse)
// ─────────────────────────────────────────────────────────────────────

/** Greatest common divisor for non-negative numbers. */
export function gcd(a: number, b: number): number {
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
export function getDivisors(n: number): number[] {
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
export function isNiceNumber(x: number): boolean {
  if (!Number.isFinite(x)) return false;
  for (const denom of [1, 2, 3, 4, 5, 6, 8, 10]) {
    if (Math.abs(x * denom - Math.round(x * denom)) < 1e-10) return true;
  }
  return false;
}
