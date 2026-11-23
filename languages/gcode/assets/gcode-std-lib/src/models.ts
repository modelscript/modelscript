// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript CNC kinematics & cutting-physics runtime for `@modelscript/gcode-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — G-code / tool preset parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — cumulative volume / energy states
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — CNC kinematic & cutting bus:
 *       IO[0] = pathLengthMm      IO[1] = cycleTimeSec
 *       IO[2] = spindleRpm        IO[3] = feedrateMmPerMin
 *       IO[4] = mrrMm3PerSec      IO[5] = cuttingPowerW
 *       IO[6] = spindleTorqueNm   IO[7] = peckCount
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const PI: f64 = 3.141592653589793;
const DEG_TO_RAD: f64 = 0.017453292519943295;

// Archetype IDs matching GCodeArchetypeId
const ARCH_G00: i32 = 1;
const ARCH_G01: i32 = 2;
const ARCH_G02: i32 = 3;
const ARCH_G03: i32 = 4;
const ARCH_G04: i32 = 5;
const ARCH_G81: i32 = 11;
const ARCH_G82: i32 = 12;
const ARCH_G83: i32 = 13;

const ARCH_ENDMILL_CARBIDE_AL: i32 = 40;
const ARCH_ENDMILL_CARBIDE_STEEL: i32 = 41;
const ARCH_ENDMILL_HSS_AL: i32 = 42;
const ARCH_DRILL_CARBIDE_STEEL: i32 = 43;
const ARCH_DRILL_HSS_AL: i32 = 44;
const ARCH_FACEMILL_CARBIDE_CASTIRON: i32 = 45;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

export function gcodeModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  setState(slotPtr, 0, 0.0);
  setState(slotPtr, 1, 0.0);
  setDState(slotPtr, 0, 0.0);
  setDState(slotPtr, 1, 0.0);
  for (let i = 0; i < 8; i++) {
    setIo(slotPtr, i, 0.0);
  }
  gcodeModelStep(archetypeId, 0.0, 0.0, slotPtr, conCount);
}

export function gcodeModelStep(
  archetypeId: i32,
  _t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  if (archetypeId == ARCH_G00) {
    const rapidRate = Math.max(1.0, getCon(slotPtr, conCount, 0, 10000.0));
    const dist = Math.max(0.0, getCon(slotPtr, conCount, 1, 100.0));
    const timeSec = (dist / rapidRate) * 60.0;
    setIo(slotPtr, 0, dist);
    setIo(slotPtr, 1, timeSec);
    setIo(slotPtr, 3, rapidRate);
    return;
  }

  if (archetypeId == ARCH_G01) {
    const feed = Math.max(1e-6, getCon(slotPtr, conCount, 0, 500.0));
    const dist = Math.max(0.0, getCon(slotPtr, conCount, 1, 50.0));
    const timeSec = (dist / feed) * 60.0;
    setIo(slotPtr, 0, dist);
    setIo(slotPtr, 1, timeSec);
    setIo(slotPtr, 3, feed);
    return;
  }

  if (archetypeId == ARCH_G02 || archetypeId == ARCH_G03) {
    const feed = Math.max(1e-6, getCon(slotPtr, conCount, 0, 400.0));
    const radius = Math.max(0.0, getCon(slotPtr, conCount, 1, 25.0));
    const sweepRad = Math.abs(getCon(slotPtr, conCount, 2, 90.0)) * DEG_TO_RAD;
    const dz = getCon(slotPtr, conCount, 3, 0.0);
    const arc2d = radius * sweepRad;
    const length = Math.sqrt(arc2d * arc2d + dz * dz);
    const timeSec = (length / feed) * 60.0;
    setIo(slotPtr, 0, length);
    setIo(slotPtr, 1, timeSec);
    setIo(slotPtr, 3, feed);
    return;
  }

  if (archetypeId == ARCH_G04) {
    const dwell = Math.max(0.0, getCon(slotPtr, conCount, 0, 1.0));
    setIo(slotPtr, 0, 0.0);
    setIo(slotPtr, 1, dwell);
    return;
  }

  if (archetypeId == ARCH_G81 || archetypeId == ARCH_G82) {
    const rPlane = getCon(slotPtr, conCount, 0, 2.0);
    const zDepth = getCon(slotPtr, conCount, 1, -15.0);
    const feed = Math.max(1e-6, getCon(slotPtr, conCount, 2, 180.0));
    const dwell = archetypeId == ARCH_G82 ? Math.max(0.0, getCon(slotPtr, conCount, 3, 0.5)) : 0.0;
    const rapid = Math.max(1.0, getCon(slotPtr, conCount, archetypeId == ARCH_G82 ? 4 : 3, 10000.0));
    const depth = Math.max(0.0, rPlane - zDepth);
    const timeSec = (depth / feed) * 60.0 + dwell + (depth / rapid) * 60.0;
    setIo(slotPtr, 0, depth * 2.0);
    setIo(slotPtr, 1, timeSec);
    setIo(slotPtr, 3, feed);
    setIo(slotPtr, 7, 1.0);
    return;
  }

  if (archetypeId == ARCH_G83) {
    const rPlane = getCon(slotPtr, conCount, 0, 2.0);
    const zDepth = getCon(slotPtr, conCount, 1, -24.0);
    const q = Math.max(1e-3, getCon(slotPtr, conCount, 2, 4.0));
    const feed = Math.max(1e-6, getCon(slotPtr, conCount, 3, 160.0));
    const rapid = Math.max(1.0, getCon(slotPtr, conCount, 4, 10000.0));
    const clearance = Math.max(0.0, getCon(slotPtr, conCount, 5, 0.5));
    const totalDepth = Math.max(0.0, rPlane - zDepth);

    let currentDepth: f64 = 0.0;
    let cutDist: f64 = 0.0;
    let rapidDist: f64 = 0.0;
    let pecks: f64 = 0.0;

    while (currentDepth < totalDepth - 1e-9) {
      const nextDepth = Math.min(totalDepth, currentDepth + q);
      const rapidEntry = pecks > 0.0 ? Math.max(0.0, currentDepth - clearance) : 0.0;
      const cutStroke = nextDepth - rapidEntry;
      rapidDist += rapidEntry + nextDepth; // rapid down to clearance + full retract to R
      cutDist += cutStroke;
      currentDepth = nextDepth;
      pecks += 1.0;
    }
    const timeSec = (cutDist / feed) * 60.0 + (rapidDist / rapid) * 60.0;
    setIo(slotPtr, 0, cutDist + rapidDist);
    setIo(slotPtr, 1, timeSec);
    setIo(slotPtr, 3, feed);
    setIo(slotPtr, 7, pecks);
    return;
  }

  // Cutting Tool Presets (milling & drilling)
  if (
    archetypeId == ARCH_ENDMILL_CARBIDE_AL ||
    archetypeId == ARCH_ENDMILL_CARBIDE_STEEL ||
    archetypeId == ARCH_ENDMILL_HSS_AL ||
    archetypeId == ARCH_FACEMILL_CARBIDE_CASTIRON
  ) {
    const d = Math.max(0.1, getCon(slotPtr, conCount, 0, 10.0));
    const flutes = Math.max(1.0, getCon(slotPtr, conCount, 1, 3.0));
    const vc = Math.max(1.0, getCon(slotPtr, conCount, 2, 300.0));
    const fz = Math.max(1e-4, getCon(slotPtr, conCount, 3, 0.06));
    const kc = Math.max(1.0, getCon(slotPtr, conCount, 4, 700.0));
    const ap = Math.max(0.0, getCon(slotPtr, conCount, 5, 5.0));
    const ae = Math.max(0.0, getCon(slotPtr, conCount, 6, 5.0));

    // N = 1000 * Vc / (pi * D)
    const rpm = (1000.0 * vc) / (PI * d);
    // F = N * z * fz
    const feed = rpm * flutes * fz;
    // MRR = ap * ae * F / 60 (mm^3/s)
    const mrr = (ap * ae * feed) / 60.0;
    // P_cut = kc * MRR * 1e-3 (W)
    const powerW = kc * mrr * 1e-3;
    const omega = (2.0 * PI * rpm) / 60.0;
    const torqueNm = omega > 1e-9 ? powerW / omega : 0.0;

    setDState(slotPtr, 0, mrr);
    setDState(slotPtr, 1, powerW);
    if (dt > 0.0) {
      setState(slotPtr, 0, getState(slotPtr, 0) + mrr * dt);
      setState(slotPtr, 1, getState(slotPtr, 1) + powerW * dt);
    }

    setIo(slotPtr, 2, rpm);
    setIo(slotPtr, 3, feed);
    setIo(slotPtr, 4, mrr);
    setIo(slotPtr, 5, powerW);
    setIo(slotPtr, 6, torqueNm);
    return;
  }

  if (archetypeId == ARCH_DRILL_CARBIDE_STEEL || archetypeId == ARCH_DRILL_HSS_AL) {
    const d = Math.max(0.1, getCon(slotPtr, conCount, 0, 6.0));
    const vc = Math.max(1.0, getCon(slotPtr, conCount, 2, 80.0));
    const fn = Math.max(1e-4, getCon(slotPtr, conCount, 3, 0.12));
    const kc = Math.max(1.0, getCon(slotPtr, conCount, 4, 2200.0));

    const rpm = (1000.0 * vc) / (PI * d);
    const feed = rpm * fn;
    // Drilling MRR = (pi/4) * D^2 * F / 60 (mm^3/s)
    const mrr = (0.25 * PI * d * d * feed) / 60.0;
    const powerW = kc * mrr * 1e-3;
    const omega = (2.0 * PI * rpm) / 60.0;
    const torqueNm = omega > 1e-9 ? powerW / omega : 0.0;

    setDState(slotPtr, 0, mrr);
    setDState(slotPtr, 1, powerW);
    if (dt > 0.0) {
      setState(slotPtr, 0, getState(slotPtr, 0) + mrr * dt);
      setState(slotPtr, 1, getState(slotPtr, 1) + powerW * dt);
    }

    setIo(slotPtr, 2, rpm);
    setIo(slotPtr, 3, feed);
    setIo(slotPtr, 4, mrr);
    setIo(slotPtr, 5, powerW);
    setIo(slotPtr, 6, torqueNm);
  }
}
