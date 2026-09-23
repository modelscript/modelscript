// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Polynomial Abstraction with Certified Interval Remainder.
 *
 * Converts transcendental / non-polynomial functions (sin, cos, exp) into polynomial
 * approximations with guaranteed interval remainder bounds:
 *   f(x) = P_d(x) + [e_lo, e_hi]
 *
 * Used to relax arbitrary non-linear dynamics into Sum-of-Squares (SOS) barrier certificates.
 */

import { Interval } from "./wasm_interval.js";

export interface PolynomialAbstractionResult {
  /** Polynomial coefficients [c0, c1, c2, ..., cd] */
  coefficients: number[];
  /** Degree of the polynomial approximation */
  degree: number;
  /** Domain interval [lo, hi] over which the abstraction is guaranteed */
  domain: Interval;
  /** Certified remainder error interval [\epsilon_{lo}, \epsilon_{hi}] */
  remainder: Interval;
}

export class PolynomialAbstraction {
  /**
   * Approximates sin(x) on domain interval [lo, hi] with Taylor polynomial + remainder.
   * sin(x) = x - x^3 / 6 + x^5 / 120 + ...
   */
  public static abstractSin(domain: Interval, degree: 3 | 5 = 3): PolynomialAbstractionResult {
    // 3rd degree: P(x) = x - x^3 / 6
    // Remainder R_3(x) = sin^{(4)}(xi) * x^4 / 24 = sin(xi) * x^4 / 24, xi in domain
    const maxAbsX = Math.max(Math.abs(domain.lo), Math.abs(domain.hi));

    if (degree === 3) {
      const coeffs = [0, 1.0, 0, -1.0 / 6.0];
      const maxRem = Math.pow(maxAbsX, 4) / 24.0;
      return {
        coefficients: coeffs,
        degree: 3,
        domain: new Interval(domain.lo, domain.hi),
        remainder: new Interval(-maxRem, maxRem),
      };
    } else {
      // 5th degree: P(x) = x - x^3/6 + x^5/120
      const coeffs = [0, 1.0, 0, -1.0 / 6.0, 0, 1.0 / 120.0];
      const maxRem = Math.pow(maxAbsX, 6) / 720.0;
      return {
        coefficients: coeffs,
        degree: 5,
        domain: new Interval(domain.lo, domain.hi),
        remainder: new Interval(-maxRem, maxRem),
      };
    }
  }

  /**
   * Approximates cos(x) on domain interval [lo, hi].
   * cos(x) = 1 - x^2 / 2 + x^4 / 24 + ...
   */
  public static abstractCos(domain: Interval, degree: 2 | 4 = 2): PolynomialAbstractionResult {
    const maxAbsX = Math.max(Math.abs(domain.lo), Math.abs(domain.hi));

    if (degree === 2) {
      const coeffs = [1.0, 0, -0.5];
      const maxRem = Math.pow(maxAbsX, 3) / 6.0;
      return {
        coefficients: coeffs,
        degree: 2,
        domain: new Interval(domain.lo, domain.hi),
        remainder: new Interval(-maxRem, maxRem),
      };
    } else {
      const coeffs = [1.0, 0, -0.5, 0, 1.0 / 24.0];
      const maxRem = Math.pow(maxAbsX, 5) / 120.0;
      return {
        coefficients: coeffs,
        degree: 4,
        domain: new Interval(domain.lo, domain.hi),
        remainder: new Interval(-maxRem, maxRem),
      };
    }
  }

  /**
   * Approximates exp(x) on domain interval [lo, hi].
   * exp(x) = 1 + x + x^2 / 2 + ...
   */
  public static abstractExp(domain: Interval, degree: 2 | 3 = 2): PolynomialAbstractionResult {
    const maxVal = Math.exp(domain.hi);
    const maxAbsX = Math.max(Math.abs(domain.lo), Math.abs(domain.hi));

    if (degree === 2) {
      const coeffs = [1.0, 1.0, 0.5];
      const maxRem = (maxVal * Math.pow(maxAbsX, 3)) / 6.0;
      return {
        coefficients: coeffs,
        degree: 2,
        domain: new Interval(domain.lo, domain.hi),
        remainder: new Interval(-maxRem, maxRem),
      };
    } else {
      const coeffs = [1.0, 1.0, 0.5, 1.0 / 6.0];
      const maxRem = (maxVal * Math.pow(maxAbsX, 4)) / 24.0;
      return {
        coefficients: coeffs,
        degree: 3,
        domain: new Interval(domain.lo, domain.hi),
        remainder: new Interval(-maxRem, maxRem),
      };
    }
  }
}
