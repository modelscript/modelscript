// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript aerodynamic runtime for `@modelscript/datcom-std-lib`.
 *
 * Zero-GC 1024-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B): `CON[16]` (`f64`) — airfoil or aircraft parameters
 *   - `0x080..0x0FF` (128 B): `IO[16]`  (`f64`) — aerodynamic I/O bus:
 *       IO[0] = alphaRad    IO[1] = mach
 *       IO[2] = CL          IO[3] = CD
 *       IO[4] = Cm          IO[5] = CLalpha
 *       IO[6] = CD0         IO[7] = oswaldE
 */

const OFF_CON: usize = 0x000;
const OFF_IO: usize = 0x080;

const PI: f64 = 3.141592653589793;
const DEG2RAD: f64 = 0.017453292519943295;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getIO(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIO(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * Evaluates Helmbold / Polhamus finite-wing lift-curve slope CL_alpha (1/rad).
 */
export function datcomFiniteWingCLalpha(aspectRatio: f64, mach: f64, sweepHalfChordDeg: f64): f64 {
  if (mach < 0.92) {
    const beta2: f64 = Math.max(1e-4, 1.0 - mach * mach);
    const tanSweep: f64 = Math.tan(sweepHalfChordDeg * DEG2RAD);
    const inner: f64 = 4.0 + aspectRatio * aspectRatio * beta2 * (1.0 + (tanSweep * tanSweep) / beta2);
    return (2.0 * PI * aspectRatio) / (2.0 + Math.sqrt(inner));
  }
  const betaSup: f64 = Math.sqrt(Math.max(1e-4, mach * mach - 1.0));
  const tipCorr: f64 = Math.max(0.35, 1.0 - 1.0 / (2.0 * aspectRatio * betaSup));
  return (4.0 / betaSup) * tipCorr;
}

/**
 * Evaluates a DATCOM standard library archetype (airfoil section or aircraft template).
 */
export function datcomModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const alphaRad = getIO(slotPtr, 0);
  const mach = getIO(slotPtr, 1);

  if (archetypeId < 10) {
    // NACA airfoil section
    const alphaL0Deg = getCon(slotPtr, conCount, 2, 0.0);
    const clAlpha2D = getCon(slotPtr, conCount, 3, 2.0 * PI);
    const cd0 = getCon(slotPtr, conCount, 4, 0.0056);
    const cmAc = getCon(slotPtr, conCount, 5, 0.0);
    const beta = mach < 0.9 ? Math.sqrt(Math.max(0.04, 1.0 - mach * mach)) : 0.4359;
    const clAlpha = clAlpha2D / beta;
    const cl = clAlpha * (alphaRad - alphaL0Deg * DEG2RAD);
    const cd = cd0 + 0.008 * cl * cl;
    setIO(slotPtr, 2, cl);
    setIO(slotPtr, 3, cd);
    setIO(slotPtr, 4, cmAc);
    setIO(slotPtr, 5, clAlpha);
    setIO(slotPtr, 6, cd0);
    setIO(slotPtr, 7, 1.0);
    return;
  }

  // Aircraft configuration template
  const ar = getCon(slotPtr, conCount, 3, 7.5);
  const sweepDeg = getCon(slotPtr, conCount, 4, 0.0);
  const mEval = mach > 0.01 ? mach : getCon(slotPtr, conCount, 6, 0.2);
  const clAlpha = datcomFiniteWingCLalpha(ar, mEval, sweepDeg);
  const eRaw = 1.78 * (1.0 - 0.045 * Math.pow(ar, 0.68)) - 0.64;
  const e = Math.max(0.6, Math.min(0.92, eRaw));
  const cd0: f64 = archetypeId == 12 ? 0.022 : 0.024;
  const cl = clAlpha * alphaRad;
  const cd = cd0 + (cl * cl) / (PI * e * ar);
  const cm = -0.12 * clAlpha * alphaRad;

  setIO(slotPtr, 2, cl);
  setIO(slotPtr, 3, cd);
  setIO(slotPtr, 4, cm);
  setIO(slotPtr, 5, clAlpha);
  setIO(slotPtr, 6, cd0);
  setIO(slotPtr, 7, e);
}
