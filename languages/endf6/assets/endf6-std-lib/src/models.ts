// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript ENDF-6 cross-section interpolation & nuclear data runtime
 * for `@modelscript/endf6-std-lib`.
 */

const ENDF_K0: f64 = 2.196771e-3;
const E_THERMAL: f64 = 0.0253;

/**
 * Evaluates ENDF-6 interpolation law `INT` (`1..5`) between `(x1, y1)` and `(x2, y2)` at `x`.
 */
export function endf6Interp(x: f64, x1: f64, y1: f64, x2: f64, y2: f64, interp: i32): f64 {
  if (x <= x1 || x2 == x1) return y1;
  if (x >= x2) return y2;
  if (interp == 1) return y1;
  if (interp == 2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  if (interp == 3) {
    if (x1 <= 0.0 || x2 <= 0.0 || x <= 0.0) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    return y1 + ((y2 - y1) * Math.log(x / x1)) / Math.log(x2 / x1);
  }
  if (interp == 4) {
    if (y1 <= 0.0 || y2 <= 0.0) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    return y1 * Math.pow(y2 / y1, (x - x1) / (x2 - x1));
  }
  if (interp == 5) {
    if (x1 <= 0.0 || x2 <= 0.0 || x <= 0.0 || y1 <= 0.0 || y2 <= 0.0) {
      return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    }
    return y1 * Math.pow(x / x1, Math.log(y2 / y1) / Math.log(x2 / x1));
  }
  return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
}

/**
 * Returns the thermal (0.0253 eV) radiative capture cross-section (barns) for reference ZA nuclides.
 */
export function endf6ThermalSigmaCapture(za: i32): f64 {
  if (za == 1001) return 0.3326;
  if (za == 5010) return 3837.0;
  if (za == 92235) return 98.7;
  if (za == 92238) return 2.683;
  if (za == 94239) return 270.3;
  return 0.0;
}

/**
 * Evaluates 1/v thermal capture scaling: `sigma(E) = sigma_0 * sqrt(0.0253 / E)`.
 */
export function endf6OneOverVCapture(sigmaThermal: f64, energyEv: f64): f64 {
  if (energyEv <= 0.0) return 0.0;
  return sigmaThermal * Math.sqrt(E_THERMAL / energyEv);
}

/**
 * Evaluates the s-wave Single-Level Breit-Wigner capture cross-section (barns) at energy `energyEv`.
 */
export function endf6SlbwCapture(
  energyEv: f64,
  er: f64,
  awr: f64,
  gJ: f64,
  gn: f64,
  gg: f64,
  gf: f64,
): f64 {
  if (energyEv <= 0.0 || awr <= 0.0) return 0.0;
  const k = ENDF_K0 * (awr / (awr + 1.0)) * Math.sqrt(energyEv);
  const piOverK2 = Math.PI / (k * k);
  const erRef = Math.abs(er) > 1e-12 ? Math.abs(er) : 1.0;
  const gnE = gn * Math.sqrt(energyEv / erRef);
  const gamma = gnE + gg + gf;
  const dE = energyEv - er;
  return piOverK2 * gJ * ((gnE * gg) / (dE * dE + 0.25 * gamma * gamma));
}
