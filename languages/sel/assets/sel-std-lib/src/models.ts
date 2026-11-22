// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript protection & SELogic runtime for `@modelscript/sel-std-lib`.
 *
 * Implements standardized IEEE C37.112 / IEC 60255-151 time-overcurrent curves,
 * IEEE C37.2 protection elements (50P/50G, 51P/51G, 21P Mho, 21G Quad, 67P/67Q,
 * 87L/87T percentage differential, 79 recloser, 81O/81U, 27/59, 50BF), and
 * SELogic timers/latches using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — relay element settings vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal timers, TCC disk, latches
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — auxiliary scratch / rates
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — measurement & logic I/O bus:
 *       IO[0]  = iMag (A or pu)
 *       IO[1]  = iAngDeg (deg)
 *       IO[2]  = vMag (V or pu)
 *       IO[3]  = vAngDeg (deg)
 *       IO[4]  = zReal (Ohm)
 *       IO[5]  = zImag (Ohm)
 *       IO[6]  = iDiff (A or pu)
 *       IO[7]  = iRest (A or pu)
 *       IO[8]  = freqHz (Hz)
 *       IO[9]  = logicIn (0 or 1; SET for latch)
 *       IO[10] = logicReset (0 or 1; RESET / torque ctrl / 52a)
 *       IO[11] = auxIn (2nd harmonic % or math operand)
 *       IO[12] = pickup (out: 0 or 1)
 *       IO[13] = trip (out: 0 or 1)
 *       IO[14] = operateTimeSec (out: s, or -1 if not picked up)
 *       IO[15] = integrator (out: TCC disk 0..1, timer s, or math value)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `SelArchetypeId` in sel-std-schemas.ts)
const ARCH_TCC_CURVE: i32 = 1;
const ARCH_INST_OVERCURRENT: i32 = 10;
const ARCH_DISTANCE_MHO: i32 = 20;
const ARCH_DISTANCE_QUAD: i32 = 21;
const ARCH_DIRECTIONAL_OC: i32 = 30;
const ARCH_DIFFERENTIAL_87: i32 = 40;
const ARCH_RECLOSER_79: i32 = 50;
const ARCH_FREQUENCY_81: i32 = 60;
const ARCH_VOLTAGE_27_59: i32 = 61;
const ARCH_BREAKER_FAILURE_50BF: i32 = 62;
const ARCH_SELOGIC_TIMER: i32 = 70;
const ARCH_SELOGIC_LATCH: i32 = 71;
const ARCH_SELOGIC_MATH: i32 = 72;
const ARCH_WORD_BIT: i32 = 73;

const DEG_TO_RAD: f64 = Math.PI / 180.0;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

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

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function selGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Resets internal relay element states (TCC disk, timers, latches, reclose shots) to zero.
 * Returns the number of active internal states for the archetype.
 */
export function selModelInit(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  setIo(slotPtr, 12, 0.0);
  setIo(slotPtr, 13, 0.0);
  setIo(slotPtr, 14, -1.0);
  setIo(slotPtr, 15, 0.0);

  if (archetypeId == ARCH_TCC_CURVE) return 1; // disk position
  if (archetypeId == ARCH_INST_OVERCURRENT) return 2; // timer, prevPickup
  if (archetypeId == ARCH_DISTANCE_MHO || archetypeId == ARCH_DISTANCE_QUAD) return 1; // zone timer
  if (archetypeId == ARCH_DIRECTIONAL_OC) return 1; // timer
  if (archetypeId == ARCH_DIFFERENTIAL_87) return 1; // operate latch/flag
  if (archetypeId == ARCH_RECLOSER_79) return 3; // openTimer, shots, lockout
  if (archetypeId == ARCH_FREQUENCY_81 || archetypeId == ARCH_VOLTAGE_27_59) return 1; // delay timer
  if (archetypeId == ARCH_BREAKER_FAILURE_50BF) return 2; // bfTimer, retripOut
  if (archetypeId == ARCH_SELOGIC_TIMER) return 3; // puTimer, doTimer, outState
  if (archetypeId == ARCH_SELOGIC_LATCH) return 1; // latchState
  if (archetypeId == ARCH_SELOGIC_MATH || archetypeId == ARCH_WORD_BIT) return 1;
  return 0;
}

/**
 * Evaluates a single time step of an SEL protection element, TCC curve, or SELogic block.
 * Writes `pickup` (IO[12]), `trip` (IO[13]), `operateTimeSec` (IO[14]), and `integrator` (IO[15]).
 * Returns `trip` (0.0 or 1.0).
 */
export function selModelEval(
  archetypeId: i32,
  _t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): f64 {
  const stepDt = dt > 0.0 ? dt : 0.0;

  // 1. IEEE C37.112 (U1–U5) & IEC 60255-151 (C1–C5) Time-Overcurrent Curves
  if (archetypeId == ARCH_TCC_CURVE) {
    const iMag = getIo(slotPtr, 0);
    const pickup = Math.max(1e-6, getCon(slotPtr, conCount, 0, 1.0));
    const timeDial = Math.max(1e-6, getCon(slotPtr, conCount, 1, 1.0));
    const a = getCon(slotPtr, conCount, 2, 0.14);
    const b = getCon(slotPtr, conCount, 3, 0.0);
    const p = getCon(slotPtr, conCount, 4, 0.02);
    const tr = getCon(slotPtr, conCount, 5, 0.0);

    const m = iMag / pickup;
    let disk = getState(slotPtr, 0);
    let pickedUp: f64 = 0.0;
    let tOp: f64 = -1.0;

    if (m > 1.0) {
      pickedUp = 1.0;
      const denom = Math.max(Math.pow(m, p) - 1.0, 1e-9);
      tOp = timeDial * (a / denom + b);
      if (stepDt > 0.0) {
        disk = clamp(disk + stepDt / Math.max(tOp, 1e-6), 0.0, 1.0);
      }
      setDState(slotPtr, 0, 1.0 / Math.max(tOp, 1e-6));
    } else {
      pickedUp = 0.0;
      tOp = -1.0;
      if (tr > 0.0 && stepDt > 0.0) {
        const tReset = timeDial * tr / Math.max(1.0 - m * m, 1e-6);
        disk = clamp(disk - stepDt / Math.max(tReset, 1e-6), 0.0, 1.0);
        setDState(slotPtr, 0, -1.0 / Math.max(tReset, 1e-6));
      } else if (tr <= 0.0) {
        disk = 0.0;
        setDState(slotPtr, 0, 0.0);
      }
    }

    const trip: f64 = pickedUp > 0.5 && disk >= 1.0 - 1e-9 ? 1.0 : 0.0;
    setState(slotPtr, 0, disk);
    setIo(slotPtr, 12, pickedUp);
    setIo(slotPtr, 13, trip);
    setIo(slotPtr, 14, tOp);
    setIo(slotPtr, 15, disk);
    return trip;
  }

  // 2. Instantaneous / Definite-Time Overcurrent (50P / 50G)
  if (archetypeId == ARCH_INST_OVERCURRENT) {
    const iMag = getIo(slotPtr, 0);
    const pickup = Math.max(1e-6, getCon(slotPtr, conCount, 0, 10.0));
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.0));
    const dropoutRatio = clamp(getCon(slotPtr, conCount, 2, 0.95), 0.5, 1.0);

    let timer = getState(slotPtr, 0);
    const prevPickup = getState(slotPtr, 1) > 0.5;
    const pickedUp = prevPickup ? iMag >= pickup * dropoutRatio : iMag >= pickup;

    if (pickedUp) {
      timer += stepDt;
    } else {
      timer = 0.0;
    }

    const trip: f64 = pickedUp && timer >= delaySec - 1e-9 ? 1.0 : 0.0;
    setState(slotPtr, 0, timer);
    setState(slotPtr, 1, pickedUp ? 1.0 : 0.0);
    setIo(slotPtr, 12, pickedUp ? 1.0 : 0.0);
    setIo(slotPtr, 13, trip);
    setIo(slotPtr, 14, pickedUp ? delaySec : -1.0);
    setIo(slotPtr, 15, timer);
    return trip;
  }

  // 3. Mho Distance Zone (21P)
  if (archetypeId == ARCH_DISTANCE_MHO) {
    const reach = Math.max(1e-6, getCon(slotPtr, conCount, 0, 5.0));
    const mtaRad = getCon(slotPtr, conCount, 1, 75.0) * DEG_TO_RAD;
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.0));

    let zR = getIo(slotPtr, 4);
    let zX = getIo(slotPtr, 5);
    if (zR == 0.0 && zX == 0.0) {
      const iMag = getIo(slotPtr, 0);
      const vMag = getIo(slotPtr, 2);
      if (iMag > 1e-6) {
        const zMag = vMag / iMag;
        const phiRad = (getIo(slotPtr, 3) - getIo(slotPtr, 1)) * DEG_TO_RAD;
        zR = zMag * Math.cos(phiRad);
        zX = zMag * Math.sin(phiRad);
      }
    }

    // Point (zR, zX) lies inside the origin-passing Mho circle iff:
    // zR^2 + zX^2 <= reach * (zR * cos(mta) + zX * sin(mta)) and zMag > 0
    const zSq = zR * zR + zX * zX;
    const proj = zR * Math.cos(mtaRad) + zX * Math.sin(mtaRad);
    const inside = (zSq > 0.0 || proj > 0.0) && proj > 0.0 && zSq <= reach * proj + 1e-9;

    let timer = getState(slotPtr, 0);
    timer = inside ? timer + stepDt : 0.0;
    const trip: f64 = inside && timer >= delaySec - 1e-9 ? 1.0 : 0.0;

    setState(slotPtr, 0, timer);
    setIo(slotPtr, 12, inside ? 1.0 : 0.0);
    setIo(slotPtr, 13, trip);
    setIo(slotPtr, 14, inside ? delaySec : -1.0);
    setIo(slotPtr, 15, Math.sqrt(zSq));
    return trip;
  }

  // 4. Quadrilateral Distance Zone (21G)
  if (archetypeId == ARCH_DISTANCE_QUAD) {
    const xReach = Math.max(1e-6, getCon(slotPtr, conCount, 0, 5.0));
    const rReach = Math.max(1e-6, getCon(slotPtr, conCount, 1, 3.0));
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.0));

    const zR = getIo(slotPtr, 4);
    const zX = getIo(slotPtr, 5);
    const inside = zX > 0.0 && zX <= xReach && zR >= -0.25 * rReach && zR <= rReach;

    let timer = getState(slotPtr, 0);
    timer = inside ? timer + stepDt : 0.0;
    const trip: f64 = inside && timer >= delaySec - 1e-9 ? 1.0 : 0.0;

    setState(slotPtr, 0, timer);
    setIo(slotPtr, 12, inside ? 1.0 : 0.0);
    setIo(slotPtr, 13, trip);
    setIo(slotPtr, 14, inside ? delaySec : -1.0);
    setIo(slotPtr, 15, timer);
    return trip;
  }

  // 5. Directional Overcurrent (67P / 67Q)
  if (archetypeId == ARCH_DIRECTIONAL_OC) {
    const iMag = getIo(slotPtr, 0);
    const iAng = getIo(slotPtr, 1);
    const vAng = getIo(slotPtr, 3);
    const pickup = Math.max(1e-6, getCon(slotPtr, conCount, 0, 6.0));
    const mtaDeg = getCon(slotPtr, conCount, 1, 60.0);
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.0));

    const torqueCos = Math.cos((vAng - iAng - mtaDeg) * DEG_TO_RAD);
    const pickedUp = iMag >= pickup && torqueCos > 0.0;

    let timer = getState(slotPtr, 0);
    timer = pickedUp ? timer + stepDt : 0.0;
    const trip: f64 = pickedUp && timer >= delaySec - 1e-9 ? 1.0 : 0.0;

    setState(slotPtr, 0, timer);
    setIo(slotPtr, 12, pickedUp ? 1.0 : 0.0);
    setIo(slotPtr, 13, trip);
    setIo(slotPtr, 14, pickedUp ? delaySec : -1.0);
    setIo(slotPtr, 15, torqueCos);
    return trip;
  }

  // 6. Dual-Slope Percentage Differential (87L / 87T)
  if (archetypeId == ARCH_DIFFERENTIAL_87) {
    const iDiff = Math.abs(getIo(slotPtr, 6));
    const iRest = Math.abs(getIo(slotPtr, 7));
    const harm2Pct = getIo(slotPtr, 11);

    const pickup = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.3));
    const slope1 = clamp(getCon(slotPtr, conCount, 1, 25.0), 0.0, 200.0) * 0.01;
    const slope2 = clamp(getCon(slotPtr, conCount, 2, 60.0), 0.0, 200.0) * 0.01;
    const irBreak = Math.max(0.0, getCon(slotPtr, conCount, 3, 2.0));
    const harm2BlockPct = Math.max(0.0, getCon(slotPtr, conCount, 4, 0.0));

    let iThresh = Math.max(pickup, slope1 * iRest);
    if (iRest > irBreak) {
      const slope2Thresh = slope1 * irBreak + slope2 * (iRest - irBreak);
      if (slope2Thresh > iThresh) iThresh = slope2Thresh;
    }

    const blocked = harm2BlockPct > 0.0 && harm2Pct >= harm2BlockPct;
    const pickedUp = iDiff >= iThresh;
    const trip: f64 = pickedUp && !blocked ? 1.0 : 0.0;

    setState(slotPtr, 0, trip);
    setIo(slotPtr, 12, pickedUp ? 1.0 : 0.0);
    setIo(slotPtr, 13, trip);
    setIo(slotPtr, 14, trip > 0.5 ? 0.0 : -1.0);
    setIo(slotPtr, 15, iDiff - iThresh);
    return trip;
  }

  // 7. Automatic Reclosing (79)
  if (archetypeId == ARCH_RECLOSER_79) {
    const initiate = getIo(slotPtr, 9) > 0.5;
    const breakerClosed = getIo(slotPtr, 10) > 0.5;
    const openInterval = Math.max(0.01, getCon(slotPtr, conCount, 0, 1.0));
    const resetTime = Math.max(0.1, getCon(slotPtr, conCount, 1, 15.0));
    const maxShots = Math.max(1.0, getCon(slotPtr, conCount, 2, 3.0));

    let timer = getState(slotPtr, 0);
    let shots = getState(slotPtr, 1);
    let lockout = getState(slotPtr, 2);
    let closeCmd: f64 = 0.0;

    if (lockout < 0.5) {
      if (initiate && !breakerClosed) {
        timer += stepDt;
        if (timer >= openInterval - 1e-9) {
          shots += 1.0;
          timer = 0.0;
          if (shots > maxShots) {
            lockout = 1.0;
          } else {
            closeCmd = 1.0;
          }
        }
      } else if (breakerClosed && shots > 0.0) {
        timer += stepDt;
        if (timer >= resetTime) {
          shots = 0.0;
          timer = 0.0;
        }
      }
    }

    setState(slotPtr, 0, timer);
    setState(slotPtr, 1, shots);
    setState(slotPtr, 2, lockout);
    setIo(slotPtr, 12, lockout);
    setIo(slotPtr, 13, closeCmd);
    setIo(slotPtr, 14, openInterval);
    setIo(slotPtr, 15, shots);
    return closeCmd;
  }

  // 8. Under / Over-Frequency (81O / 81U)
  if (archetypeId == ARCH_FREQUENCY_81) {
    const freqHz = getIo(slotPtr, 8);
    const pickupHz = getCon(slotPtr, conCount, 0, 59.5);
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.1));
    const mode = getCon(slotPtr, conCount, 2, -1.0);

    const pickedUp = mode < 0.0 ? freqHz > 0.0 && freqHz <= pickupHz : freqHz >= pickupHz;
    let timer = getState(slotPtr, 0);
    timer = pickedUp ? timer + stepDt : 0.0;
    const trip: f64 = pickedUp && timer >= delaySec - 1e-9 ? 1.0 : 0.0;

    setState(slotPtr, 0, timer);
    setIo(slotPtr, 12, pickedUp ? 1.0 : 0.0);
    setIo(slotPtr, 13, trip);
    setIo(slotPtr, 14, pickedUp ? delaySec : -1.0);
    setIo(slotPtr, 15, timer);
    return trip;
  }

  // 9. Under / Over-Voltage (27 / 59)
  if (archetypeId == ARCH_VOLTAGE_27_59) {
    const vMag = getIo(slotPtr, 2);
    const pickupV = getCon(slotPtr, conCount, 0, 0.85);
    const delaySec = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.2));
    const mode = getCon(slotPtr, conCount, 2, -1.0);

    const pickedUp = mode < 0.0 ? vMag <= pickupV : vMag >= pickupV;
    let timer = getState(slotPtr, 0);
    timer = pickedUp ? timer + stepDt : 0.0;
    const trip: f64 = pickedUp && timer >= delaySec - 1e-9 ? 1.0 : 0.0;

    setState(slotPtr, 0, timer);
    setIo(slotPtr, 12, pickedUp ? 1.0 : 0.0);
    setIo(slotPtr, 13, trip);
    setIo(slotPtr, 14, pickedUp ? delaySec : -1.0);
    setIo(slotPtr, 15, timer);
    return trip;
  }

  // 10. Breaker Failure (50BF)
  if (archetypeId == ARCH_BREAKER_FAILURE_50BF) {
    const iMag = getIo(slotPtr, 0);
    const bfi = getIo(slotPtr, 9) > 0.5;
    const pickup = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.5));
    const retripDelay = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.05));
    const bfDelay = Math.max(retripDelay, getCon(slotPtr, conCount, 2, 0.15));

    const faultDetected = bfi && iMag >= pickup;
    let timer = getState(slotPtr, 0);
    timer = faultDetected ? timer + stepDt : 0.0;
    const retrip: f64 = faultDetected && timer >= retripDelay - 1e-9 ? 1.0 : 0.0;
    const bfTrip: f64 = faultDetected && timer >= bfDelay - 1e-9 ? 1.0 : 0.0;

    setState(slotPtr, 0, timer);
    setState(slotPtr, 1, retrip);
    setIo(slotPtr, 12, retrip);
    setIo(slotPtr, 13, bfTrip);
    setIo(slotPtr, 14, faultDetected ? bfDelay : -1.0);
    setIo(slotPtr, 15, timer);
    return bfTrip;
  }

  // 11. SELogic Pickup / Dropout Timer (SV_TIMER) with optional rising/falling edge trigger
  if (archetypeId == ARCH_SELOGIC_TIMER) {
    const rawInp = getIo(slotPtr, 9) > 0.5;
    const puDelay = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.1));
    const doDelay = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.05));
    const edgeMode = getCon(slotPtr, conCount, 2, 0.0); // 0=level, >0.5=rising '/', <-0.5=falling '\'

    let puTimer = getState(slotPtr, 0);
    let doTimer = getState(slotPtr, 1);
    let outState = getState(slotPtr, 2) > 0.5;
    const prevRaw = getState(slotPtr, 3) > 0.5;

    let inp = rawInp;
    if (edgeMode > 0.5) {
      inp = rawInp && !prevRaw;
    } else if (edgeMode < -0.5) {
      inp = !rawInp && prevRaw;
    }

    if (inp) {
      doTimer = 0.0;
      if (!outState) {
        puTimer += stepDt;
        if (puTimer >= puDelay - 1e-9) {
          outState = true;
        }
      }
    } else {
      puTimer = 0.0;
      if (outState) {
        doTimer += stepDt;
        if (doTimer >= doDelay - 1e-9) {
          outState = false;
        }
      }
    }

    const outVal: f64 = outState ? 1.0 : 0.0;
    setState(slotPtr, 0, puTimer);
    setState(slotPtr, 1, doTimer);
    setState(slotPtr, 2, outVal);
    setState(slotPtr, 3, rawInp ? 1.0 : 0.0);
    setIo(slotPtr, 12, inp ? 1.0 : 0.0);
    setIo(slotPtr, 13, outVal);
    setIo(slotPtr, 14, outState ? doDelay : puDelay);
    setIo(slotPtr, 15, outState ? doTimer : puTimer);
    return outVal;
  }

  // 12. SELogic Set/Reset Latch (LT_LATCH)
  if (archetypeId == ARCH_SELOGIC_LATCH) {
    const setIn = getIo(slotPtr, 9) > 0.5;
    const rstIn = getIo(slotPtr, 10) > 0.5;
    const setDominant = getCon(slotPtr, conCount, 0, 0.0) > 0.5;

    let latch = getState(slotPtr, 0) > 0.5;
    if (setDominant) {
      if (setIn) latch = true;
      else if (rstIn) latch = false;
    } else {
      if (rstIn) latch = false;
      else if (setIn) latch = true;
    }

    const outVal: f64 = latch ? 1.0 : 0.0;
    setState(slotPtr, 0, outVal);
    setIo(slotPtr, 12, setIn ? 1.0 : 0.0);
    setIo(slotPtr, 13, outVal);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, outVal);
    return outVal;
  }

  // 13. SELogic Protection Math Variable (PMV_MATH)
  if (archetypeId == ARCH_SELOGIC_MATH) {
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const offset = getCon(slotPtr, conCount, 1, 0.0);
    const threshold = getCon(slotPtr, conCount, 2, 1.0);
    const val = gain * getIo(slotPtr, 0) + offset * getIo(slotPtr, 11);
    const asserted: f64 = val >= threshold ? 1.0 : 0.0;
    setState(slotPtr, 0, val);
    setIo(slotPtr, 12, asserted);
    setIo(slotPtr, 13, asserted);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, val);
    return asserted;
  }

  // 14. Relay Word Bits (52A / TRIP)
  if (archetypeId == ARCH_WORD_BIT) {
    const invert = getCon(slotPtr, conCount, 0, 0.0) > 0.5;
    const raw = getIo(slotPtr, 9) > 0.5;
    const outVal: f64 = (invert ? !raw : raw) ? 1.0 : 0.0;
    setState(slotPtr, 0, outVal);
    setIo(slotPtr, 12, outVal);
    setIo(slotPtr, 13, outVal);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, outVal);
    return outVal;
  }

  return 0.0;
}
