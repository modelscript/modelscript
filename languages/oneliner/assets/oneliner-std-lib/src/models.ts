// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript protection & sequence equipment runtime for `@modelscript/oneliner-std-lib`.
 *
 * Implements standardized IEEE C37.112 / IEC 60255-151 / IEEE C37.113 / IEEE C37.91 protection
 * evaluation formulas using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — relay / equipment parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal state / latch vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — auxiliary derivatives / counters
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — input / output bus:
 *       Inputs:
 *         IO[0] = iFaultA (primary fault current, A)
 *         IO[1] = rOhms (measured apparent resistance R, Ohms)
 *         IO[2] = xOhms (measured apparent reactance X, Ohms)
 *         IO[3] = iOpPu (differential operating current |Iop|, pu)
 *         IO[4] = iRestPu (differential restraint current Irest, pu)
 *         IO[5] = angleDeg (directional current-to-polarizing angle, deg)
 *         IO[6] = harm2Pct (2nd harmonic % of fundamental)
 *         IO[7] = lengthMiles (line length in miles for SEQ_LINE, default 1.0)
 *       Outputs:
 *         IO[8]  = tripped (1.0 if operated / tripped / over-duty, 0.0 otherwise)
 *         IO[9]  = tripTimeSec (operating/clearing time in seconds, 1e9 if no trip)
 *         IO[10] = pickupMultiple (M = I/Ipickup, Iop/Ithresh, or breaker duty ratio)
 *         IO[11] = margin (normalized reach/restraint/torque margin, > 0 inside zone)
 *         IO[12] = z1Mag (positive-sequence impedance magnitude)
 *         IO[13] = z0Mag (zero-sequence impedance magnitude)
 *         IO[14] = rTotal (total positive-sequence resistance)
 *         IO[15] = xTotal (total positive-sequence reactance)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_IO: usize = 0x780;

const NO_TRIP_TIME: f64 = 1e9;
const DEG_TO_RAD: f64 = 0.017453292519943295; // PI / 180

// Archetype IDs (must match `OneLinerArchetypeId` in oneliner-std-schemas.ts)
const ARCH_OVERCURRENT_INVERSE: i32 = 1;
const ARCH_OVERCURRENT_INST: i32 = 2;
const ARCH_DISTANCE_MHO: i32 = 10;
const ARCH_DISTANCE_QUAD: i32 = 11;
const ARCH_DIFFERENTIAL_87: i32 = 20;
const ARCH_DIRECTIONAL_67: i32 = 30;
const ARCH_RECLOSER_79: i32 = 31;
const ARCH_FUSE_LINK: i32 = 32;
const ARCH_BREAKER_52: i32 = 33;
const ARCH_SEQ_LINE: i32 = 40;
const ARCH_SEQ_TRANSFORMER: i32 = 41;

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
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

@inline
function wrapAngleDeg(deg: f64): f64 {
  let a = deg % 360.0;
  if (a > 180.0) a -= 360.0;
  if (a < -180.0) a += 360.0;
  return a;
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function olGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes relay / sequence equipment slot states to un-tripped resting state.
 * Returns the number of state variables initialized.
 */
export function olModelInit(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  setState(slotPtr, 0, 0.0); // trip latch
  setState(slotPtr, 1, 0.0); // elapsed / shot counter
  setIo(slotPtr, 8, 0.0);
  setIo(slotPtr, 9, NO_TRIP_TIME);
  setIo(slotPtr, 10, 0.0);
  setIo(slotPtr, 11, 0.0);
  setIo(slotPtr, 12, 0.0);
  setIo(slotPtr, 13, 0.0);
  setIo(slotPtr, 14, 0.0);
  setIo(slotPtr, 15, 0.0);
  return archetypeId > 0 ? 2 : 0;
}

/**
 * Evaluates protection relay operating decision & trip time (or sequence equipment impedance).
 * Returns 1 if the relay trips (or breaker is over-duty), 0 otherwise.
 */
export function olModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  // Reset outputs
  setIo(slotPtr, 8, 0.0);
  setIo(slotPtr, 9, NO_TRIP_TIME);
  setIo(slotPtr, 10, 0.0);
  setIo(slotPtr, 11, 0.0);

  // 1. IEEE C37.112 / IEC 60255-151 Inverse-Time Overcurrent: t = TD * (A / (M^p - 1) + B)
  if (archetypeId == ARCH_OVERCURRENT_INVERSE) {
    const iFaultA = Math.abs(getIo(slotPtr, 0));
    const pickupA = Math.max(1e-6, getCon(slotPtr, conCount, 0, 600.0));
    const timeDial = Math.max(0.0, getCon(slotPtr, conCount, 1, 1.0));
    const coeffA = getCon(slotPtr, conCount, 2, 0.0515);
    const coeffB = getCon(slotPtr, conCount, 3, 0.114);
    const expP = getCon(slotPtr, conCount, 4, 0.02);
    const instMult = getCon(slotPtr, conCount, 6, 0.0);

    const m = iFaultA / pickupA;
    setIo(slotPtr, 10, m);
    setIo(slotPtr, 11, m - 1.0);

    if (instMult > 0.0 && m >= instMult) {
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, 0.0167);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    if (m > 1.0) {
      const denom = Math.pow(m, expP) - 1.0;
      const tTrip = denom > 1e-12 ? timeDial * (coeffA / denom + coeffB) : NO_TRIP_TIME;
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, tTrip);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 2. ANSI 50 Instantaneous Overcurrent
  if (archetypeId == ARCH_OVERCURRENT_INST) {
    const iFaultA = Math.abs(getIo(slotPtr, 0));
    const pickupA = Math.max(1e-6, getCon(slotPtr, conCount, 0, 4000.0));
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.0167));

    const m = iFaultA / pickupA;
    setIo(slotPtr, 10, m);
    setIo(slotPtr, 11, m - 1.0);

    if (iFaultA >= pickupA) {
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, delaySec);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 3. ANSI 21 Mho Circle Distance Zone: |Z - Zr/2| <= |Zr|/2
  if (archetypeId == ARCH_DISTANCE_MHO) {
    const r = getIo(slotPtr, 1);
    const x = getIo(slotPtr, 2);
    const reachMag = Math.max(1e-6, getCon(slotPtr, conCount, 0, 12.0));
    const mtaRad = getCon(slotPtr, conCount, 1, 78.0) * DEG_TO_RAD;
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.02));

    const halfRadius = 0.5 * reachMag;
    const cx = halfRadius * Math.cos(mtaRad);
    const cy = halfRadius * Math.sin(mtaRad);
    const dr = r - cx;
    const dx = x - cy;
    const dist = Math.sqrt(dr * dr + dx * dx);
    const margin = (halfRadius - dist) / halfRadius;
    const zMag = Math.sqrt(r * r + x * x);

    setIo(slotPtr, 10, zMag / reachMag);
    setIo(slotPtr, 11, margin);
    setIo(slotPtr, 12, zMag);

    if (dist <= halfRadius + 1e-9) {
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, delaySec);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 4. ANSI 21 Quadrilateral Distance Zone (R/X box + forward directional check)
  if (archetypeId == ARCH_DISTANCE_QUAD) {
    const r = getIo(slotPtr, 1);
    const x = getIo(slotPtr, 2);
    const xReach = Math.max(1e-6, getCon(slotPtr, conCount, 0, 12.0));
    const rReach = Math.max(1e-6, getCon(slotPtr, conCount, 1, 8.0));
    const mtaRad = getCon(slotPtr, conCount, 2, 78.0) * DEG_TO_RAD;
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.02));

    const forwardProj = r * Math.cos(mtaRad) + x * Math.sin(mtaRad);
    const inX = x >= 0.0 && x <= xReach;
    const inR = Math.abs(r) <= rReach;
    const inForward = forwardProj >= 0.0;

    const xMargin = (xReach - x) / xReach;
    const rMargin = (rReach - Math.abs(r)) / rReach;
    const margin = Math.min(xMargin, rMargin);
    const zMag = Math.sqrt(r * r + x * x);

    setIo(slotPtr, 10, x / xReach);
    setIo(slotPtr, 11, inForward ? margin : -1.0);
    setIo(slotPtr, 12, zMag);

    if (inX && inR && inForward) {
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, delaySec);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 5. ANSI 87 Dual-Slope Percentage-Restraint Differential with optional 2nd-harmonic block
  if (archetypeId == ARCH_DIFFERENTIAL_87) {
    const iOp = Math.abs(getIo(slotPtr, 3));
    const iRest = Math.max(0.0, getIo(slotPtr, 4));
    const harm2Pct = Math.max(0.0, getIo(slotPtr, 6));

    const iPickup = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.3));
    const slope1 = Math.max(0.0, getCon(slotPtr, conCount, 1, 25.0)) * 0.01;
    const slope2 = Math.max(0.0, getCon(slotPtr, conCount, 2, 50.0)) * 0.01;
    const breakpoint = Math.max(0.0, getCon(slotPtr, conCount, 3, 2.0));
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 4, 0.025));
    const harm2Block = Math.max(0.0, getCon(slotPtr, conCount, 5, 0.0));

    let slopeThresh: f64;
    if (iRest <= breakpoint) {
      slopeThresh = slope1 * iRest;
    } else {
      slopeThresh = slope1 * breakpoint + slope2 * (iRest - breakpoint);
    }
    const thresh = Math.max(iPickup, slopeThresh);
    const blocked = harm2Block > 0.0 && harm2Pct >= harm2Block;

    setIo(slotPtr, 10, iOp / thresh);
    setIo(slotPtr, 11, blocked ? -1.0 : (iOp - thresh) / thresh);

    if (!blocked && iOp >= thresh) {
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, delaySec);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 6. ANSI 67 Directional Torque Angle + Inverse-Time Overcurrent
  if (archetypeId == ARCH_DIRECTIONAL_67) {
    const iFaultA = Math.abs(getIo(slotPtr, 0));
    const angleDeg = getIo(slotPtr, 5);

    const pickupA = Math.max(1e-6, getCon(slotPtr, conCount, 0, 500.0));
    const timeDial = Math.max(0.0, getCon(slotPtr, conCount, 1, 1.0));
    const mtaDeg = getCon(slotPtr, conCount, 2, -45.0);
    const halfAngleDeg = Math.max(1.0, getCon(slotPtr, conCount, 3, 85.0));
    const coeffA = getCon(slotPtr, conCount, 4, 19.61);
    const coeffB = getCon(slotPtr, conCount, 5, 0.491);
    const expP = getCon(slotPtr, conCount, 6, 2.0);

    const angDiff = Math.abs(wrapAngleDeg(angleDeg - mtaDeg));
    const isForward = angDiff <= halfAngleDeg;
    const m = iFaultA / pickupA;

    setIo(slotPtr, 10, m);
    setIo(slotPtr, 11, Math.cos(angDiff * DEG_TO_RAD) - Math.cos(halfAngleDeg * DEG_TO_RAD));

    if (isForward && m > 1.0) {
      const denom = Math.pow(m, expP) - 1.0;
      const tTrip = denom > 1e-12 ? timeDial * (coeffA / denom + coeffB) : NO_TRIP_TIME;
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, tTrip);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 7. ANSI 79 Automatic Recloser
  if (archetypeId == ARCH_RECLOSER_79) {
    const iFaultA = Math.abs(getIo(slotPtr, 0));
    const pickupA = Math.max(1e-6, getCon(slotPtr, conCount, 0, 400.0));
    const fastDelay = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.05));
    const m = iFaultA / pickupA;

    setIo(slotPtr, 10, m);
    setIo(slotPtr, 11, m - 1.0);

    if (iFaultA >= pickupA) {
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, fastDelay);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 8. IEEE C37.41 Expulsion Fuse Link (K / T)
  if (archetypeId == ARCH_FUSE_LINK) {
    const iFaultA = Math.abs(getIo(slotPtr, 0));
    const ratedA = Math.max(1e-6, getCon(slotPtr, conCount, 0, 100.0));
    const kCoeff = Math.max(1e-6, getCon(slotPtr, conCount, 1, 18.0));
    const pExp = Math.max(0.5, getCon(slotPtr, conCount, 2, 2.0));
    const minMeltMult = Math.max(1.0, getCon(slotPtr, conCount, 3, 2.0));

    const m = iFaultA / (ratedA * minMeltMult);
    setIo(slotPtr, 10, m);
    setIo(slotPtr, 11, m - 1.0);

    if (m > 1.0) {
      const denom = Math.pow(m, pExp) - 1.0;
      const tMelt = denom > 1e-12 ? kCoeff / denom : NO_TRIP_TIME;
      setIo(slotPtr, 8, 1.0);
      setIo(slotPtr, 9, tMelt);
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 9. ANSI 52 Circuit Breaker Interrupting Duty Check
  if (archetypeId == ARCH_BREAKER_52) {
    const iFaultA = Math.abs(getIo(slotPtr, 0));
    const interruptingKa = Math.max(1e-6, getCon(slotPtr, conCount, 1, 40.0));
    const clearCycles = Math.max(0.5, getCon(slotPtr, conCount, 2, 3.0));
    const freqHz = Math.max(1.0, getCon(slotPtr, conCount, 3, 60.0));

    const dutyRatio = (iFaultA * 0.001) / interruptingKa;
    const clearSec = clearCycles / freqHz;

    setIo(slotPtr, 9, clearSec);
    setIo(slotPtr, 10, dutyRatio);
    setIo(slotPtr, 11, 1.0 - dutyRatio);

    if (dutyRatio > 1.0) {
      setIo(slotPtr, 8, 1.0); // over-duty flag
      setState(slotPtr, 0, 1.0);
      return 1;
    }

    setState(slotPtr, 0, 0.0);
    return 0;
  }

  // 10. Sequence Transmission Line
  if (archetypeId == ARCH_SEQ_LINE) {
    const rawLen = getIo(slotPtr, 7);
    const len = rawLen > 1e-9 ? rawLen : 1.0;
    const r1 = getCon(slotPtr, conCount, 0, 0.1288) * len;
    const x1 = getCon(slotPtr, conCount, 1, 0.788) * len;
    const r0 = getCon(slotPtr, conCount, 2, 0.415) * len;
    const x0 = getCon(slotPtr, conCount, 3, 2.32) * len;

    setIo(slotPtr, 12, Math.sqrt(r1 * r1 + x1 * x1));
    setIo(slotPtr, 13, Math.sqrt(r0 * r0 + x0 * x0));
    setIo(slotPtr, 14, r1);
    setIo(slotPtr, 15, x1);
    return 0;
  }

  // 11. Sequence Power Transformer
  if (archetypeId == ARCH_SEQ_TRANSFORMER) {
    const r1 = getCon(slotPtr, conCount, 3, 0.004);
    const x1 = getCon(slotPtr, conCount, 4, 0.1);
    const r0 = getCon(slotPtr, conCount, 5, 0.004);
    const x0 = getCon(slotPtr, conCount, 6, 0.095);

    setIo(slotPtr, 12, Math.sqrt(r1 * r1 + x1 * x1));
    setIo(slotPtr, 13, Math.sqrt(r0 * r0 + x0 * x0));
    setIo(slotPtr, 14, r1);
    setIo(slotPtr, 15, x1);
    return 0;
  }

  return 0;
}
