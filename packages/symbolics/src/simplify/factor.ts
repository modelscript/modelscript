// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @deprecated This module delegates to `@modelscript/compiler` for the
 * arena-native implementation. Legacy functions operating on ModelicaExpression
 * are preserved for backward compatibility.
 */

// Re-export arena-native symbols
export {
  factorOutCommonArena,
  factorQuadraticArena,
  gcd,
  getDivisors,
  isNiceNumber,
  rationalRootsArena,
} from "@modelscript/compiler";

// ── Legacy API ──

import { add, mul, sub, ZERO } from "../calculus/derivative.js";
import { ModelicaBinaryOperator } from "../modelica-types.js";
import type { ModelicaExpression } from "../systems/index.js";
import { ModelicaBinaryExpression, ModelicaNameExpression, ModelicaRealLiteral } from "../systems/index.js";
import { egraphSimplify } from "./egraph.js";
import { collectTerms, expandExpr, getLiteralValue } from "./expand.js";

/**
 * @deprecated Use `factorOutCommonArena` from `@modelscript/compiler`.
 */
export function factorOutCommon(
  expr: ModelicaExpression,
  varName: string,
): { factor: ModelicaExpression; remainder: ModelicaExpression } | null {
  const terms = collectTerms(expr, varName);
  if (terms.size === 0) return null;

  const coeffValues: number[] = [];
  for (const coeff of terms.values()) {
    const val = getLiteralValue(coeff);
    if (val === null || val === 0) continue;
    coeffValues.push(Math.abs(val));
  }
  if (coeffValues.length === 0) return null;

  let g = coeffValues[0] ?? 1;
  for (let i = 1; i < coeffValues.length; i++) {
    g = numGcd(g, coeffValues[i] ?? 1);
  }
  if (g <= 1) return null;

  const factor = new ModelicaRealLiteral(g);
  const newTerms = new Map<number, ModelicaExpression>();
  for (const [degree, coeff] of terms) {
    const val = getLiteralValue(coeff);
    if (val !== null) {
      newTerms.set(degree, new ModelicaRealLiteral(val / g));
    } else {
      newTerms.set(degree, coeff);
    }
  }

  const remainder = termsToExpr(newTerms, varName);
  return { factor, remainder };
}

/**
 * @deprecated Use `factorQuadraticArena` from `@modelscript/compiler`.
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

  if (!isNice(r1) || !isNice(r2)) return null;

  const x = new ModelicaNameExpression(varName);
  const factor1 = sub(x, new ModelicaRealLiteral(r1));
  const factor2 = sub(x, new ModelicaRealLiteral(r2));
  const leading = new ModelicaRealLiteral(a);
  return mul(leading, mul(factor1, factor2));
}

/**
 * @deprecated Use `rationalRootsArena` from `@modelscript/compiler`.
 */
export function rationalRoots(expr: ModelicaExpression, varName: string): number[] {
  const terms = collectTerms(expandExpr(expr), varName);
  const degrees = [...terms.keys()].sort((a, b) => b - a);
  if (degrees.length === 0) return [];

  const maxDeg = degrees[0] ?? 0;
  const coeffs: number[] = new Array(maxDeg + 1).fill(0);
  for (const [deg, coeff] of terms) {
    const val = getLiteralValue(coeff);
    if (val === null) return [];
    coeffs[deg] = val;
  }

  const an = coeffs[maxDeg] ?? 0;
  const a0 = coeffs[0] ?? 0;
  if (an === 0 || a0 === 0) return [];

  const pDivisors = numGetDivisors(Math.abs(Math.round(a0)));
  const qDivisors = numGetDivisors(Math.abs(Math.round(an)));

  const roots: number[] = [];
  const tested = new Set<number>();

  for (const p of pDivisors) {
    for (const q of qDivisors) {
      for (const sign of [1, -1]) {
        const candidate = (sign * p) / q;
        const key = Math.round(candidate * 1e10);
        if (tested.has(key)) continue;
        tested.add(key);

        let value = 0;
        for (let i = 0; i <= maxDeg; i++) {
          value += (coeffs[i] ?? 0) * Math.pow(candidate, i);
        }
        if (Math.abs(value) < 1e-10) roots.push(candidate);
      }
    }
  }
  return roots;
}

// ── Internal utilities ──

function numGcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 1e-10) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function numGetDivisors(n: number): number[] {
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

function isNice(x: number): boolean {
  if (!Number.isFinite(x)) return false;
  for (const d of [1, 2, 3, 4, 5, 6, 8, 10]) {
    if (Math.abs(x * d - Math.round(x * d)) < 1e-10) return true;
  }
  return false;
}

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
