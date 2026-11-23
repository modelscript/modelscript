// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript thermodynamic runtime for `@modelscript/cea-std-lib`.
 *
 * Implements NASA-7 / NASA-9 polynomial evaluation in linear memory using a
 * zero-GC 256-byte slot ABI:
 *   - `0x000..0x087` (136 B): `COEFFS[17]` (`f64`)
 *       COEFFS[0] = tMid (K)
 *       COEFFS[1..7]  = low-T NASA-7 coefficients a1..a7
 *       COEFFS[8..14] = high-T NASA-7 coefficients a1..a7
 *       COEFFS[15]    = molarMass (kg/mol)
 *       COEFFS[16]    = temperature (K)
 *   - `0x088..0x0C7` (64 B): `OUT[8]` (`f64`)
 *       OUT[0] = Cp°/R
 *       OUT[1] = H°/(RT)
 *       OUT[2] = S°/R
 *       OUT[3] = G°/(RT)
 *       OUT[4] = Cp° [J/(mol*K)]
 *       OUT[5] = H°  [J/mol]
 *       OUT[6] = S°  [J/(mol*K)]
 *       OUT[7] = G°  [J/mol]
 */

const R_UNIVERSAL: f64 = 8.31446261815324;
const OFF_COEFFS: usize = 0x000;
const OFF_OUT: usize = 0x088;

@inline
function getCoeff(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_COEFFS + (<usize>idx << 3));
}

@inline
function setOut(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_OUT + (<usize>idx << 3), val);
}

/**
 * Evaluates NASA-7 polynomial properties for a species slot at temperature `tempK`.
 * Returns `H°/(RT)` directly and populates `OUT[0..7]` in linear memory.
 */
export function evalSpeciesNasa7(slotPtr: usize, tempK: f64): f64 {
  let T: f64 = tempK;
  if (T < 50.0) T = 50.0;
  if (T > 20000.0) T = 20000.0;

  const tMid = getCoeff(slotPtr, 0);
  const baseIdx: i32 = T >= tMid ? 8 : 1;

  const a1 = getCoeff(slotPtr, baseIdx + 0);
  const a2 = getCoeff(slotPtr, baseIdx + 1);
  const a3 = getCoeff(slotPtr, baseIdx + 2);
  const a4 = getCoeff(slotPtr, baseIdx + 3);
  const a5 = getCoeff(slotPtr, baseIdx + 4);
  const a6 = getCoeff(slotPtr, baseIdx + 5);
  const a7 = getCoeff(slotPtr, baseIdx + 6);

  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  const cpOverR = a1 + a2 * T + a3 * T2 + a4 * T3 + a5 * T4;
  const hOverRT = a1 + (a2 * T) / 2.0 + (a3 * T2) / 3.0 + (a4 * T3) / 4.0 + (a5 * T4) / 5.0 + a6 / T;
  const sOverR = a1 * Math.log(T) + a2 * T + (a3 * T2) / 2.0 + (a4 * T3) / 3.0 + (a5 * T4) / 4.0 + a7;
  const gOverRT = hOverRT - sOverR;

  const RT = R_UNIVERSAL * T;
  setOut(slotPtr, 0, cpOverR);
  setOut(slotPtr, 1, hOverRT);
  setOut(slotPtr, 2, sOverR);
  setOut(slotPtr, 3, gOverRT);
  setOut(slotPtr, 4, cpOverR * R_UNIVERSAL);
  setOut(slotPtr, 5, hOverRT * RT);
  setOut(slotPtr, 6, sOverR * R_UNIVERSAL);
  setOut(slotPtr, 7, gOverRT * RT);

  return hOverRT;
}

/**
 * Evaluates NASA-9 dimensionless Cp°/R given coefficients [a1..a7] at temperature T [K]:
 *   Cp°/R = a1*T^-2 + a2*T^-1 + a3 + a4*T + a5*T^2 + a6*T^3 + a7*T^4
 */
export function evalNasa9CpOverR(
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
  a5: f64,
  a6: f64,
  a7: f64,
  tempK: f64,
): f64 {
  const T = tempK < 50.0 ? 50.0 : tempK;
  const invT = 1.0 / T;
  const T2 = T * T;
  return a1 * invT * invT + a2 * invT + a3 + a4 * T + a5 * T2 + a6 * T2 * T + a7 * T2 * T2;
}
