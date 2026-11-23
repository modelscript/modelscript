// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript IC layout parasitic & DRC runtime for `@modelscript/gdsii-std-lib`.
 */

/**
 * Computes interconnect sheet resistance R = Rs * (L / W) in Ohms.
 */
export function gdsiiSheetResistance(rsOhmPerSq: f64, lengthUm: f64, widthUm: f64): f64 {
  if (widthUm <= 0.0 || lengthUm <= 0.0 || rsOhmPerSq <= 0.0) return 0.0;
  return rsOhmPerSq * (lengthUm / widthUm);
}

/**
 * Computes interconnect capacitance C = Ca * Area + Cf * Perimeter in femtofarads (fF).
 */
export function gdsiiInterconnectCapFf(
  areaCapFfPerUm2: f64,
  fringeCapFfPerUm: f64,
  areaUm2: f64,
  perimeterUm: f64,
): f64 {
  const c = areaCapFfPerUm2 * areaUm2 + fringeCapFfPerUm * perimeterUm;
  return c > 0.0 ? c : 0.0;
}

/**
 * Computes distributed Elmore RC delay tau = 0.5 * R * C in picoseconds (ps),
 * given R in Ohms and C in femtofarads (1 Ohm * 1 fF = 0.001 ps).
 */
export function gdsiiElmoreDelayPs(resistanceOhm: f64, capacitanceFf: f64): f64 {
  if (resistanceOhm <= 0.0 || capacitanceFf <= 0.0) return 0.0;
  return 0.5 * resistanceOhm * capacitanceFf * 1e-3;
}

/**
 * Returns 1 if feature width passes min-width DRC check, 0 if violation.
 */
export function gdsiiCheckMinWidth(actualWidth: f64, minWidth: f64): i32 {
  return actualWidth + 1e-9 >= minWidth ? 1 : 0;
}

/**
 * Returns 1 if feature spacing passes min-spacing DRC check, 0 if violation.
 */
export function gdsiiCheckMinSpacing(actualSpacing: f64, minSpacing: f64): i32 {
  return actualSpacing + 1e-9 >= minSpacing ? 1 : 0;
}
