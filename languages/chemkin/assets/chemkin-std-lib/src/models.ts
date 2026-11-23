// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript chemical thermodynamics & kinetics runtime for
 * `@modelscript/chemkin-std-lib`.
 *
 * Implements NASA-7 polynomial evaluation (Cp/R, H/(RT), S/R), modified Arrhenius
 * rate constants, and Lindemann/Troe falloff factors in linear memory with zero GC.
 */

const R_UNIVERSAL: f64 = 8.31446261815324;

/**
 * Evaluates dimensionless heat capacity Cp/R from NASA-7 coefficients a1..a5.
 */
export function chemkinNasa7CpOverR(
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
  a5: f64,
  T: f64,
): f64 {
  const t2 = T * T;
  const t3 = t2 * T;
  const t4 = t3 * T;
  return a1 + a2 * T + a3 * t2 + a4 * t3 + a5 * t4;
}

/**
 * Evaluates dimensionless enthalpy H/(R*T) from NASA-7 coefficients a1..a6.
 */
export function chemkinNasa7HOverRT(
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
  a5: f64,
  a6: f64,
  T: f64,
): f64 {
  const t2 = T * T;
  const t3 = t2 * T;
  const t4 = t3 * T;
  return a1 + (a2 * T) / 2.0 + (a3 * t2) / 3.0 + (a4 * t3) / 4.0 + (a5 * t4) / 5.0 + a6 / T;
}

/**
 * Evaluates dimensionless entropy S/R from NASA-7 coefficients a1..a5, a7.
 */
export function chemkinNasa7SOverR(
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
  a5: f64,
  a7: f64,
  T: f64,
): f64 {
  const t2 = T * T;
  const t3 = t2 * T;
  const t4 = t3 * T;
  return a1 * Math.log(T) + a2 * T + (a3 * t2) / 2.0 + (a4 * t3) / 3.0 + (a5 * t4) / 4.0 + a7;
}

/**
 * Evaluates molar heat capacity Cp [J/(mol*K)] from NASA-7 coefficients.
 */
export function chemkinEvalNasa7Cp(
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
  a5: f64,
  T: f64,
): f64 {
  return chemkinNasa7CpOverR(a1, a2, a3, a4, a5, T) * R_UNIVERSAL;
}

/**
 * Evaluates molar enthalpy H [J/mol] from NASA-7 coefficients.
 */
export function chemkinEvalNasa7H(
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
  a5: f64,
  a6: f64,
  T: f64,
): f64 {
  return chemkinNasa7HOverRT(a1, a2, a3, a4, a5, a6, T) * R_UNIVERSAL * T;
}

/**
 * Evaluates modified Arrhenius rate constant k(T) = A * T^b * exp(-Ea / (R * T))
 * where Ea is in J/mol.
 */
export function chemkinArrheniusRate(A: f64, b: f64, EaJPerMol: f64, T: f64): f64 {
  return A * Math.pow(T, b) * Math.exp(-EaJPerMol / (R_UNIVERSAL * T));
}

/**
 * Evaluates Troe falloff broadening factor F(T, Pr) with optional T2 (pass <= 0 to omit T2 term).
 */
export function chemkinTroeFactor(
  a: f64,
  T3: f64,
  T1: f64,
  T2: f64,
  T: f64,
  Pr: f64,
): f64 {
  if (Pr <= 0.0) return 1.0;
  let fCent: f64 = (1.0 - a) * Math.exp(-T / T3) + a * Math.exp(-T / T1);
  if (T2 > 0.0) {
    fCent += Math.exp(-T2 / T);
  }
  if (fCent < 1e-300) fCent = 1e-300;
  const logFcent = Math.log10(fCent);
  const c = -0.4 - 0.67 * logFcent;
  const n = 0.75 - 1.27 * logFcent;
  const d: f64 = 0.14;
  const logPr = Math.log10(Pr);
  const num = logPr + c;
  const den = n - d * num;
  const ratio = num / den;
  const logF = logFcent / (1.0 + ratio * ratio);
  return Math.pow(10.0, logF);
}
