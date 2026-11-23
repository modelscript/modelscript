// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript Bateman isotope depletion & decay-heat runtime for
 * `@modelscript/scale-std-lib`.
 */

const BARN_TO_CM2: f64 = 1.0e-24;
const MEV_TO_JOULES: f64 = 1.602176634e-13;

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function scaleGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Evaluates single-nuclide analytical depletion/decay:
 *   N(t) = N0 * exp(-(lambda + sigma * phi) * t)
 */
export function scaleDepleteSingle(
  n0: f64,
  decayConst: f64,
  sigmaBarns: f64,
  flux: f64,
  dt: f64,
): f64 {
  const rate = decayConst + sigmaBarns * BARN_TO_CM2 * flux;
  return n0 * Math.exp(-rate * dt);
}

/**
 * Evaluates 2-step Bateman analytical daughter concentration N2(t) from parent N1(0):
 *   dN1/dt = -k1 * N1
 *   dN2/dt = b12 * N1 - k2 * N2
 */
export function scaleBatemanTwoStep(
  n10: f64,
  n20: f64,
  k1: f64,
  k2: f64,
  b12: f64,
  dt: f64,
): f64 {
  const e2 = Math.exp(-k2 * dt);
  if (Math.abs(k2 - k1) < 1.0e-14 * (Math.abs(k1) + Math.abs(k2) + 1.0)) {
    return n20 * e2 + b12 * n10 * dt * e2;
  }
  const e1 = Math.exp(-k1 * dt);
  return n20 * e2 + (b12 * n10 / (k2 - k1)) * (e1 - e2);
}

/**
 * Evaluates instantaneous radioactive decay heat in Watts:
 *   P_decay = lambda * N * E_MeV * 1.602176634e-13
 */
export function scaleDecayHeatWatts(
  atoms: f64,
  decayConst: f64,
  energyMeV: f64,
): f64 {
  if (atoms <= 0.0 || decayConst <= 0.0 || energyMeV <= 0.0) return 0.0;
  return decayConst * atoms * energyMeV * MEV_TO_JOULES;
}
