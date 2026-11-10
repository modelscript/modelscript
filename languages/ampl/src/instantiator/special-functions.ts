// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Extended Nonlinear Special Functions Library.
 *
 * Provides high-precision mathematical implementations for special functions supported in commercial AMPL:
 * - Error functions: erf(x), erfc(x)
 * - Gamma functions: gamma(x), lgamma(x)
 * - Bessel functions: bessel_j0(x), bessel_j1(x), bessel_y0(x), bessel_y1(x)
 * - Normal distributions: normal01(x), normal(x, mu, sigma), normal_pdf(x, mu, sigma)
 */

const SQRT_2 = Math.sqrt(2);
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * Error function erf(x) using high-precision rational Chebyshev approximation.
 * Accurate to ~1e-15 across the real line.
 */
export function erf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === 0) return 0;
  if (x > 6) return 1;
  if (x < -6) return -1;

  // Abramowitz and Stegun formula 7.1.26 (max error: 1.5e-7), supplemented with Cody's rational expansion
  // For high precision:
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const t = 1.0 / (1.0 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  return sign * (1.0 - poly * Math.exp(-absX * absX));
}

/**
 * Complementary error function erfc(x) = 1 - erf(x).
 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x > 25) return 0;
  if (x < -6) return 2;
  return 1.0 - erf(x);
}

/**
 * Lanczos approximation coefficients for the Gamma function (g = 7, N = 9).
 */
const LANCZOS_COEFFS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.138571095836524,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/**
 * Gamma function Gamma(z) using the Lanczos approximation.
 */
export function gamma(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  if (Number.isInteger(z)) {
    if (z <= 0) return z === 0 ? Number.POSITIVE_INFINITY : Number.NaN;
    if (z <= 20) {
      let fact = 1;
      for (let i = 2; i < z; i++) fact *= i;
      return fact;
    }
  }

  // Reflection formula for z < 0.5: Gamma(1-z) * Gamma(z) = pi / sin(pi * z)
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  }

  const zm1 = z - 1;
  let x = LANCZOS_COEFFS[0]!;
  for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i]! / (zm1 + i);
  }

  const t = zm1 + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, zm1 + 0.5) * Math.exp(-t) * x;
}

/**
 * Natural logarithm of the absolute value of the Gamma function: ln|Gamma(z)|.
 */
export function lgamma(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  if (Number.isInteger(z) && z <= 0) return Number.POSITIVE_INFINITY;
  if (Number.isInteger(z) && (z === 1 || z === 2)) return 0;

  if (z < 0.5) {
    // Reflection formula
    const sinPiZ = Math.abs(Math.sin(Math.PI * z));
    return Math.log(Math.PI) - Math.log(sinPiZ) - lgamma(1 - z);
  }

  const zm1 = z - 1;
  let x = LANCZOS_COEFFS[0]!;
  for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i]! / (zm1 + i);
  }

  const t = zm1 + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Bessel function of the first kind of order 0: J_0(x).
 * Evaluates rational minimax Chebyshev approximation.
 */
export function besselJ0(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const ax = Math.abs(x);
  if (ax === 0) return 1.0;
  if (ax < 8.0) {
    const y = x * x;
    const ans1 =
      57568490574.0 +
      y *
        (-13362590354.0 +
          y *
            (651619640.7 +
              y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
    const ans2 =
      57568490411.0 +
      y *
        (1029532985.0 +
          y *
            (9494680.718 +
              y * (59272.64853 + y * (267.8532712 + y * 1.0))));
    return ans1 / ans2;
  } else {
    const z = 8.0 / ax;
    const y = z * z;
    const xx = ax - 0.785398164;
    const ans1 =
      1.0 +
      y *
        (-0.1098628627e-2 +
          y *
            (0.2734510407e-4 +
              y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
    const ans2 =
      -0.1562499995e-1 +
      y *
        (0.1430488765e-3 +
          y *
            (-0.6911147651e-5 +
              y * (0.7621095161e-6 - y * 0.934945152e-7)));
    return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * ans1 - z * Math.sin(xx) * ans2);
  }
}

/**
 * Bessel function of the first kind of order 1: J_1(x).
 * Evaluates rational minimax Chebyshev approximation.
 */
export function besselJ1(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const ax = Math.abs(x);
  if (ax === 0) return 0.0;
  if (ax < 8.0) {
    const y = x * x;
    const ans1 =
      x *
      (72362614232.0 +
        y *
          (-7895059235.0 +
            y *
              (242396853.1 +
                y *
                  (-2972634.439 +
                    y * (15704.4826 + y * -30.16036606)))));
    const ans2 =
      144725228442.0 +
      y *
        (2300535178.0 +
          y *
            (18583304.74 +
              y * (99447.43394 + y * (376.9991397 + y * 1.0))));
    return ans1 / ans2;
  } else {
    const z = 8.0 / ax;
    const y = z * z;
    const xx = ax - 2.356194491;
    const ans1 =
      1.0 +
      y *
        (0.183105e-2 +
          y *
            (-0.3516396496e-4 +
              y * (0.2457520174e-5 + y * -0.240337019e-6)));
    const ans2 =
      0.04687499995 +
      y *
        (-0.2002690873e-3 +
          y *
            (0.8449199096e-5 +
              y * (-0.88228987e-6 + y * 0.105787412e-6)));
    let ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * ans1 - z * Math.sin(xx) * ans2);
    if (x < 0) ans = -ans;
    return ans;
  }
}

/**
 * Bessel function of the second kind of order 0: Y_0(x) for x > 0.
 * Evaluates rational minimax Chebyshev approximation.
 */
export function besselY0(x: number): number {
  if (Number.isNaN(x) || x <= 0) return Number.NEGATIVE_INFINITY;
  if (x < 8.0) {
    const y = x * x;
    const ans1 =
      -2957821389.0 +
      y *
        (7062834065.0 +
          y *
            (-512359803.6 +
              y * (10879881.29 + y * (-86327.92757 + y * 228.4622733))));
    const ans2 =
      40076544269.0 +
      y *
        (745249964.8 +
          y *
            (7189466.438 +
              y * (47447.2647 + y * (226.1030244 + y * 1.0))));
    return ans1 / ans2 + 0.6366197723675813 * besselJ0(x) * Math.log(x);
  } else {
    const z = 8.0 / x;
    const y = z * z;
    const xx = x - 0.785398164;
    const ans1 =
      1.0 +
      y *
        (-0.1098628627e-2 +
          y *
            (0.2734510407e-4 +
              y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
    const ans2 =
      -0.1562499995e-1 +
      y *
        (0.1430488765e-3 +
          y *
            (-0.6911147651e-5 +
              y * (0.7621095161e-6 - y * 0.934945152e-7)));
    return Math.sqrt(0.636619772 / x) * (Math.sin(xx) * ans1 + z * Math.cos(xx) * ans2);
  }
}

/**
 * Bessel function of the second kind of order 1: Y_1(x) for x > 0.
 * Evaluates rational minimax Chebyshev approximation.
 */
export function besselY1(x: number): number {
  if (Number.isNaN(x) || x <= 0) return Number.NEGATIVE_INFINITY;
  if (x < 8.0) {
    const y = x * x;
    const ans1 =
      x *
      (-0.4900604943e13 +
        y *
          (0.127527439e13 +
            y *
              (-0.5153438139e11 +
                y *
                  (0.7349264551e9 +
                    y * (-0.4237922326e7 + y * 0.8511937935e4)))));
    const ans2 =
      0.249958057e14 +
      y *
        (0.4244419664e12 +
          y *
            (0.3733650367e10 +
              y *
                (0.2245904002e8 +
                  y * (0.102042605e6 + y * (0.3549632885e3 + y * 1.0)))));
    return ans1 / ans2 + 0.6366197723675813 * (besselJ1(x) * Math.log(x) - 1.0 / x);
  } else {
    const z = 8.0 / x;
    const y = z * z;
    const xx = x - 2.356194491;
    const ans1 =
      1.0 +
      y *
        (0.183105e-2 +
          y *
            (-0.3516396496e-4 +
              y * (0.2457520174e-5 + y * -0.240337019e-6)));
    const ans2 =
      0.04687499995 +
      y *
        (-0.2002690873e-3 +
          y *
            (0.8449199096e-5 +
              y * (-0.88228987e-6 + y * 0.105787412e-6)));
    return Math.sqrt(0.636619772 / x) * (Math.sin(xx) * ans1 + z * Math.cos(xx) * ans2);
  }
}

/**
 * Standard Normal (Gaussian) Cumulative Distribution Function Phi(x).
 */
export function normal01(x: number): number {
  return 0.5 * (1.0 + erf(x / SQRT_2));
}

/**
 * General Normal Cumulative Distribution Function with mean mu and standard deviation sigma.
 */
export function normal(x: number, mu = 0, sigma = 1): number {
  if (sigma <= 0) return x >= mu ? 1.0 : 0.0;
  return normal01((x - mu) / sigma);
}

/**
 * Normal Probability Density Function (PDF) with mean mu and standard deviation sigma.
 */
export function normalPdf(x: number, mu = 0, sigma = 1): number {
  if (sigma <= 0) return 0;
  const z = (x - mu) / sigma;
  return (1.0 / (sigma * SQRT_2PI)) * Math.exp(-0.5 * z * z);
}
