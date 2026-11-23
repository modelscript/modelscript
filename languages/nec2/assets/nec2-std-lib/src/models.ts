// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript wire antenna runtime for `@modelscript/nec2-std-lib`.
 *
 * Implements analytical/equivalent-RLC electromagnetic kernels for the 6 standard
 * NEC-2 wire antenna archetypes using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — antenna parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — [i_ant, v_cap]
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — [di_ant/dt, dv_cap/dt]
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — RF port bus:
 *       IO[0] = vFeed (V)          IO[1] = iFeed (A)
 *       IO[2] = rIn (Ohm)          IO[3] = xIn (Ohm)
 *       IO[4] = s11Mag             IO[5] = vswr
 *       IO[6] = directivityDbi     IO[7] = pRad (W)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const ARCH_HALF_WAVE_DIPOLE: i32 = 1;
const ARCH_QUARTER_WAVE_MONOPOLE: i32 = 2;
const ARCH_FOLDED_DIPOLE: i32 = 3;
const ARCH_YAGI_UDA_3EL: i32 = 4;
const ARCH_CIRCULAR_LOOP: i32 = 5;
const ARCH_GROUND_PLANE: i32 = 6;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

function nominalImpedanceRe(archetypeId: i32): f64 {
  if (archetypeId == ARCH_HALF_WAVE_DIPOLE) return 73.13;
  if (archetypeId == ARCH_QUARTER_WAVE_MONOPOLE) return 36.56;
  if (archetypeId == ARCH_FOLDED_DIPOLE) return 292.5;
  if (archetypeId == ARCH_YAGI_UDA_3EL) return 28.0;
  if (archetypeId == ARCH_CIRCULAR_LOOP) return 115.0;
  if (archetypeId == ARCH_GROUND_PLANE) return 50.0;
  return 73.13;
}

function nominalImpedanceIm(archetypeId: i32): f64 {
  if (archetypeId == ARCH_HALF_WAVE_DIPOLE) return 42.54;
  if (archetypeId == ARCH_QUARTER_WAVE_MONOPOLE) return 21.27;
  if (archetypeId == ARCH_FOLDED_DIPOLE) return 0.0;
  if (archetypeId == ARCH_YAGI_UDA_3EL) return 5.0;
  if (archetypeId == ARCH_CIRCULAR_LOOP) return 15.0;
  if (archetypeId == ARCH_GROUND_PLANE) return 0.0;
  return 42.54;
}

function nominalDirectivityDbi(archetypeId: i32): f64 {
  if (archetypeId == ARCH_HALF_WAVE_DIPOLE) return 2.15;
  if (archetypeId == ARCH_QUARTER_WAVE_MONOPOLE) return 5.16;
  if (archetypeId == ARCH_FOLDED_DIPOLE) return 2.15;
  if (archetypeId == ARCH_YAGI_UDA_3EL) return 7.6;
  if (archetypeId == ARCH_CIRCULAR_LOOP) return 3.1;
  if (archetypeId == ARCH_GROUND_PLANE) return 2.1;
  return 2.15;
}

/**
 * Initializes the antenna archetype slot state and nominal RF port characteristics.
 */
export function nec2ModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const rIn = nominalImpedanceRe(archetypeId);
  const xIn = nominalImpedanceIm(archetypeId);
  const dbi = nominalDirectivityDbi(archetypeId);
  const z0 = getCon(slotPtr, conCount, 4, 50.0);

  const numRe = rIn - z0;
  const numIm = xIn;
  const denRe = rIn + z0;
  const denIm = xIn;
  const s11Mag = Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
  const vswr = s11Mag < 0.9999 ? (1.0 + s11Mag) / (1.0 - s11Mag) : 10000.0;

  setState(slotPtr, 0, 0.0);
  setState(slotPtr, 1, 0.0);
  setDState(slotPtr, 0, 0.0);
  setDState(slotPtr, 1, 0.0);

  setIo(slotPtr, 1, 0.0);
  setIo(slotPtr, 2, rIn);
  setIo(slotPtr, 3, xIn);
  setIo(slotPtr, 4, s11Mag);
  setIo(slotPtr, 5, vswr);
  setIo(slotPtr, 6, dbi);
  setIo(slotPtr, 7, 0.0);
}

/**
 * Evaluates equivalent series RLC antenna circuit derivatives at time `t`.
 */
export function nec2ModelEvalDerivatives(
  archetypeId: i32,
  _t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const freqMhz = getCon(slotPtr, conCount, 0, 300.0);
  const omega0 = 2.0 * Math.PI * freqMhz * 1.0e6;
  const rRad = nominalImpedanceRe(archetypeId);
  const qFactor: f64 = 10.0;
  const lAnt = (qFactor * rRad) / omega0;
  const cAnt = 1.0 / (omega0 * omega0 * lAnt);

  const iAnt = getState(slotPtr, 0);
  const vCap = getState(slotPtr, 1);
  const vFeed = getIo(slotPtr, 0);

  const diDt = (vFeed - rRad * iAnt - vCap) / lAnt;
  const dvDt = iAnt / cAnt;

  setDState(slotPtr, 0, diDt);
  setDState(slotPtr, 1, dvDt);
  setIo(slotPtr, 1, iAnt);
  setIo(slotPtr, 7, rRad * iAnt * iAnt);
}

/**
 * Advances the equivalent RLC antenna circuit by one Heun predictor-corrector step `dt`.
 */
export function nec2ModelStep(archetypeId: i32, t: f64, dt: f64, slotPtr: usize, conCount: i32): void {
  const y0 = getState(slotPtr, 0);
  const y1 = getState(slotPtr, 1);

  nec2ModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = load<f64>(slotPtr + OFF_DSTATE);
  const k1_1 = load<f64>(slotPtr + OFF_DSTATE + 8);

  setState(slotPtr, 0, y0 + dt * k1_0);
  setState(slotPtr, 1, y1 + dt * k1_1);

  nec2ModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = load<f64>(slotPtr + OFF_DSTATE);
  const k2_1 = load<f64>(slotPtr + OFF_DSTATE + 8);

  setState(slotPtr, 0, y0 + 0.5 * dt * (k1_0 + k2_0));
  setState(slotPtr, 1, y1 + 0.5 * dt * (k1_1 + k2_1));

  nec2ModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}
