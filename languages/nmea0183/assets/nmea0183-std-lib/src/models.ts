// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript telemetry & kinematics runtime for `@modelscript/nmea0183-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — sentence schema parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — kinematic state [e, n, u, s]
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives [ve, vn, vu, speed]
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — navigation I/O bus:
 *       IO[0] = latDeg       IO[1] = lonDeg
 *       IO[2] = altM         IO[3] = sogMps
 *       IO[4] = cogDeg       IO[5] = hdop
 *       IO[6] = headingTrue  IO[7] = depthM
 *       IO[8] = windSpeedMps IO[9] = windAngleDeg
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const DEG2RAD: f64 = 0.017453292519943295;
const KNOTS_TO_MPS: f64 = 0.5144444444444445;

// Archetype IDs (must match Nmea0183ArchetypeId in nmea0183-std-schemas.ts)
const ARCH_GGA: i32 = 1;
const ARCH_RMC: i32 = 2;
const ARCH_GSA: i32 = 3;
const ARCH_GSV: i32 = 4;
const ARCH_VTG: i32 = 5;
const ARCH_HDG: i32 = 6;
const ARCH_DBT: i32 = 7;
const ARCH_MWV: i32 = 8;

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
function setState(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), val);
}

@inline
function getDState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3));
}

@inline
function setDState(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), val);
}

@inline
function setIO(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), val);
}

function stateCountForArchetype(archetypeId: i32): i32 {
  if (archetypeId == ARCH_RMC || archetypeId == ARCH_VTG) return 3; // e, n, s
  return 0;
}

export function nmea0183ModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  setState(slotPtr, 0, 0.0);
  setState(slotPtr, 1, 0.0);
  setState(slotPtr, 2, 0.0);
  setDState(slotPtr, 0, 0.0);
  setDState(slotPtr, 1, 0.0);
  setDState(slotPtr, 2, 0.0);

  if (archetypeId == ARCH_GGA) {
    setIO(slotPtr, 2, getCon(slotPtr, conCount, 2, 0.0));
  } else if (archetypeId == ARCH_RMC) {
    const sogKn = getCon(slotPtr, conCount, 0, 0.0);
    const cogDeg = getCon(slotPtr, conCount, 1, 0.0);
    setIO(slotPtr, 3, sogKn * KNOTS_TO_MPS);
    setIO(slotPtr, 4, cogDeg);
  } else if (archetypeId == ARCH_GSA) {
    setIO(slotPtr, 5, getCon(slotPtr, conCount, 2, 1.0));
  } else if (archetypeId == ARCH_HDG) {
    const mag = getCon(slotPtr, conCount, 0, 0.0);
    const dev = getCon(slotPtr, conCount, 1, 0.0);
    const varDeg = getCon(slotPtr, conCount, 2, 0.0);
    let hTrue = (mag + dev + varDeg) % 360.0;
    if (hTrue < 0.0) hTrue += 360.0;
    setIO(slotPtr, 6, hTrue);
  } else if (archetypeId == ARCH_DBT) {
    const depthM = getCon(slotPtr, conCount, 0, 10.0);
    const offsetM = getCon(slotPtr, conCount, 1, 0.0);
    setIO(slotPtr, 7, depthM + offsetM);
  } else if (archetypeId == ARCH_MWV) {
    setIO(slotPtr, 9, getCon(slotPtr, conCount, 0, 0.0));
    setIO(slotPtr, 8, getCon(slotPtr, conCount, 1, 0.0));
  }
}

export function nmea0183ModelEvalDerivatives(
  archetypeId: i32,
  _t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  if (archetypeId == ARCH_RMC) {
    const sogMps = getCon(slotPtr, conCount, 0, 0.0) * KNOTS_TO_MPS;
    const cogRad = getCon(slotPtr, conCount, 1, 0.0) * DEG2RAD;
    setDState(slotPtr, 0, sogMps * Math.sin(cogRad));
    setDState(slotPtr, 1, sogMps * Math.cos(cogRad));
    setDState(slotPtr, 2, sogMps);
    setIO(slotPtr, 3, sogMps);
  } else if (archetypeId == ARCH_VTG) {
    const cogRad = getCon(slotPtr, conCount, 0, 0.0) * DEG2RAD;
    const sogMps = getCon(slotPtr, conCount, 2, 0.0) * KNOTS_TO_MPS;
    setDState(slotPtr, 0, sogMps * Math.sin(cogRad));
    setDState(slotPtr, 1, sogMps * Math.cos(cogRad));
    setDState(slotPtr, 2, sogMps);
    setIO(slotPtr, 3, sogMps);
  } else if (archetypeId == ARCH_GGA || archetypeId == ARCH_GSA || archetypeId == ARCH_GSV) {
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, 0.0);
    setDState(slotPtr, 2, 0.0);
  }
}

export function nmea0183ModelStep(archetypeId: i32, t: f64, dt: f64, slotPtr: usize, conCount: i32): void {
  const nStates = stateCountForArchetype(archetypeId);
  nmea0183ModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  for (let i = 0; i < nStates; i++) {
    setState(slotPtr, i, getState(slotPtr, i) + dt * getDState(slotPtr, i));
  }
}
