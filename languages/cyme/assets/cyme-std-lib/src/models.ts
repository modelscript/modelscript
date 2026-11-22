// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript distribution equipment runtime for `@modelscript/cyme-std-lib`.
 *
 * Implements standardized IEEE 1547-2018 / IEEE C37.112 / IEC 60255 / Kersting mathematical
 * formulations using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — CYME equipment parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal equipment state
 *   - `0x680..0x77F` (256 B):  `AUX[32]`    (`f64`) — auxiliary workspace
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — evaluation I/O bus:
 *       Inputs:
 *         IO[0] = vPu (pu), IO[1] = iAmps (A), IO[2] = lengthKm (km), IO[3] = freqHz (Hz),
 *         IO[4] = rhoOhmM (Ohm*m), IO[5] = tapStep (steps or NaN for auto), IO[6] = pAvailPu (pu),
 *         IO[7] = closedFlag (1=closed, 0=open)
 *       Outputs:
 *         IO[8] = r1Ohm (Ohm), IO[9] = x1Ohm (Ohm), IO[10] = r0Ohm (Ohm), IO[11] = x0Ohm (Ohm),
 *         IO[12] = tripTimeSec (s, -1 if no trip), IO[13] = tapRatio (pu),
 *         IO[14] = pOutPu (pu), IO[15] = qOutPu (pu)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `CymeArchetypeId` in cyme-std-schemas.ts)
const ARCH_OVERHEAD_CONDUCTOR: i32 = 1;
const ARCH_UNDERGROUND_CABLE: i32 = 2;
const ARCH_TRANSFORMER: i32 = 10;
const ARCH_VOLTAGE_REGULATOR: i32 = 11;
const ARCH_FUSE_LINK: i32 = 20;
const ARCH_OVERCURRENT_IEEE: i32 = 21;
const ARCH_OVERCURRENT_IEC: i32 = 22;
const ARCH_SWITCHGEAR: i32 = 23;
const ARCH_SHUNT_CAPACITOR: i32 = 30;
const ARCH_ZIP_LOAD: i32 = 31;
const ARCH_DER_IEEE1547: i32 = 40;

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

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function cymeGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes equipment model internal state slots.
 * Returns the number of active state slots for the archetype.
 */
export function cymeModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  // Clear outputs to safe defaults
  setIo(slotPtr, 8, 0.0);
  setIo(slotPtr, 9, 0.0);
  setIo(slotPtr, 10, 0.0);
  setIo(slotPtr, 11, 0.0);
  setIo(slotPtr, 12, -1.0);
  setIo(slotPtr, 13, 1.0);
  setIo(slotPtr, 14, 0.0);
  setIo(slotPtr, 15, 0.0);

  if (archetypeId == ARCH_VOLTAGE_REGULATOR) {
    setState(slotPtr, 0, 0.0); // current tap step
    setState(slotPtr, 1, 1.0); // tap ratio
    return 2;
  }

  if (
    archetypeId == ARCH_FUSE_LINK ||
    archetypeId == ARCH_OVERCURRENT_IEEE ||
    archetypeId == ARCH_OVERCURRENT_IEC
  ) {
    setState(slotPtr, 0, 0.0); // trip state (0=armed, 1=tripped)
    setState(slotPtr, 1, -1.0); // last computed trip time
    return 2;
  }

  if (archetypeId == ARCH_TRANSFORMER) {
    const tapPu = getCon(slotPtr, conCount, 6, 1.0);
    setState(slotPtr, 0, tapPu);
    setIo(slotPtr, 13, tapPu);
    return 1;
  }

  if (archetypeId == ARCH_DER_IEEE1547) {
    setState(slotPtr, 0, 1.0); // active power setpoint
    setState(slotPtr, 1, 0.0); // reactive power output
    return 2;
  }

  setState(slotPtr, 0, 0.0);
  return 1;
}

/**
 * Evaluates the distribution equipment physics model for the current I/O bus inputs.
 */
export function cymeModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const vPuRaw = getIo(slotPtr, 0);
  const vPu = vPuRaw > 1e-6 ? vPuRaw : 1.0;
  const iAmps = Math.max(0.0, getIo(slotPtr, 1));
  const lengthRaw = getIo(slotPtr, 2);
  const lengthKm = lengthRaw > 0.0 ? lengthRaw : 1.0;
  const freqRaw = getIo(slotPtr, 3);
  const freqHz = freqRaw > 1.0 ? freqRaw : 60.0;
  const rhoRaw = getIo(slotPtr, 4);
  const rhoOhmM = rhoRaw > 0.1 ? rhoRaw : 100.0;
  const tapStepIn = getIo(slotPtr, 5);
  const pAvailRaw = getIo(slotPtr, 6);
  const pAvailPu = isNaN(pAvailRaw) ? 1.0 : clamp(pAvailRaw, 0.0, 1.2);
  const closedFlag = getIo(slotPtr, 7);

  // 1. Overhead Conductor & Underground Cable: Carson's sequence impedance equations (Kersting Ch. 4)
  if (archetypeId == ARCH_OVERHEAD_CONDUCTOR || archetypeId == ARCH_UNDERGROUND_CABLE) {
    const rAc = getCon(slotPtr, conCount, 0, 0.19);
    const gmrMm = Math.max(0.1, getCon(slotPtr, conCount, 1, 7.4));
    const gmdMm = Math.max(gmrMm * 1.1, getCon(slotPtr, conCount, 2, 1200.0));
    const omega = 2.0 * Math.PI * freqHz;
    // mu0 / (2*pi) = 2e-4 H/km
    const coeff = omega * 2.0e-4;

    const r1 = rAc * lengthKm;
    const x1 = coeff * Math.log(gmdMm / gmrMm) * lengthKm;

    // Carson earth-return resistance r_e = pi^2 * 1e-4 * f (Ohm/km) and depth D_e = 658.5 * sqrt(rho/f) m
    const rEarth = 0.00098696044 * freqHz;
    const deMm = 658500.0 * Math.sqrt(rhoOhmM / freqHz);
    const screenFactor = archetypeId == ARCH_UNDERGROUND_CABLE ? 0.65 : 1.0;

    const r0 = (rAc + 3.0 * rEarth * screenFactor) * lengthKm;
    const x0PerKm =
      coeff * (Math.log(deMm / gmrMm) + 2.0 * Math.log(deMm / gmdMm)) * screenFactor;
    const x0 = Math.max(x1, x0PerKm * lengthKm);

    setIo(slotPtr, 8, r1);
    setIo(slotPtr, 9, x1);
    setIo(slotPtr, 10, r0);
    setIo(slotPtr, 11, x0);
    setIo(slotPtr, 12, -1.0);
    setIo(slotPtr, 13, 1.0);
    return;
  }

  // 2. Distribution & Substation Transformer (IEEE C57.12 / Kersting Ch. 8)
  if (archetypeId == ARCH_TRANSFORMER) {
    const ratingKva = Math.max(1.0, getCon(slotPtr, conCount, 0, 1500.0));
    const vPriKv = Math.max(0.1, getCon(slotPtr, conCount, 1, 12.47));
    const zPct = Math.max(0.1, getCon(slotPtr, conCount, 3, 5.75));
    const xrRatio = Math.max(0.1, getCon(slotPtr, conCount, 4, 6.5));
    const noLoadLossKw = Math.max(0.0, getCon(slotPtr, conCount, 5, 2.4));
    const tapPu = getCon(slotPtr, conCount, 6, 1.0);

    const zBaseOhm = (vPriKv * vPriKv * 1000.0) / ratingKva;
    const zOhm = (zPct / 100.0) * zBaseOhm;
    const rOhm = zOhm / Math.sqrt(1.0 + xrRatio * xrRatio);
    const xOhm = rOhm * xrRatio;

    setIo(slotPtr, 8, rOhm);
    setIo(slotPtr, 9, xOhm);
    setIo(slotPtr, 10, rOhm);
    setIo(slotPtr, 11, xOhm);
    setIo(slotPtr, 13, tapPu);
    setIo(slotPtr, 14, -noLoadLossKw / ratingKva);
    setIo(slotPtr, 15, 0.0);
    return;
  }

  // 3. 32-Step Voltage Regulator (IEEE C57.15 / Kersting Ch. 7)
  if (archetypeId == ARCH_VOLTAGE_REGULATOR) {
    const vSetPu = getCon(slotPtr, conCount, 0, 1.025);
    const bandwidthPu = getCon(slotPtr, conCount, 1, 0.01667);
    const stepSizePu = getCon(slotPtr, conCount, 2, 0.00625);
    const maxSteps = getCon(slotPtr, conCount, 3, 16.0);

    let tap: f64 = 0.0;
    if (!isNaN(tapStepIn)) {
      tap = clamp(Math.round(tapStepIn), -maxSteps, maxSteps);
    } else {
      const vErr = vSetPu - vPu;
      if (Math.abs(vErr) <= 0.5 * bandwidthPu) {
        tap = 0.0;
      } else {
        tap = clamp(Math.round(vErr / (vPu * stepSizePu)), -maxSteps, maxSteps);
      }
    }

    const tapRatio = 1.0 + tap * stepSizePu;
    setState(slotPtr, 0, tap);
    setState(slotPtr, 1, tapRatio);
    setIo(slotPtr, 13, tapRatio);
    setIo(slotPtr, 14, vPu * tapRatio);
    return;
  }

  // 4. Fuse Link Minimum Melting Curve I^2*t (IEEE C37.41 / ANSI C37.42)
  if (archetypeId == ARCH_FUSE_LINK) {
    const ratedAmps = Math.max(1.0, getCon(slotPtr, conCount, 0, 65.0));
    const i2tMelt = Math.max(1.0, getCon(slotPtr, conCount, 1, 18500.0));
    const minMeltMult = Math.max(1.0, getCon(slotPtr, conCount, 2, 2.0));
    const iPickup = ratedAmps * minMeltMult;

    let tripTime: f64 = -1.0;
    if (iAmps > iPickup) {
      const denom = iAmps * iAmps - iPickup * iPickup;
      tripTime = Math.max(0.004, i2tMelt / denom);
      setState(slotPtr, 0, 1.0);
    } else {
      setState(slotPtr, 0, 0.0);
    }
    setState(slotPtr, 1, tripTime);
    setIo(slotPtr, 12, tripTime);
    return;
  }

  // 5. IEEE C37.112-2018 Inverse-Time Overcurrent Relay / Hydraulic Recloser
  if (archetypeId == ARCH_OVERCURRENT_IEEE) {
    const pickupAmps = Math.max(1.0, getCon(slotPtr, conCount, 0, 400.0));
    const timeDial = Math.max(0.05, getCon(slotPtr, conCount, 1, 1.0));
    const curveA = getCon(slotPtr, conCount, 2, 19.61);
    const curveB = getCon(slotPtr, conCount, 3, 0.491);
    const curveP = getCon(slotPtr, conCount, 4, 2.0);
    const instMult = getCon(slotPtr, conCount, 5, 10.0);
    const instTime = getCon(slotPtr, conCount, 6, 0.02);

    const m = iAmps / pickupAmps;
    let tripTime: f64 = -1.0;
    if (m > 1.0) {
      if (instMult > 0.0 && m >= instMult) {
        tripTime = instTime;
      } else {
        tripTime = timeDial * (curveA / (Math.pow(m, curveP) - 1.0) + curveB);
      }
      setState(slotPtr, 0, 1.0);
    } else {
      setState(slotPtr, 0, 0.0);
    }
    setState(slotPtr, 1, tripTime);
    setIo(slotPtr, 12, tripTime);
    return;
  }

  // 6. IEC 60255-151 Inverse-Time Overcurrent Relay
  if (archetypeId == ARCH_OVERCURRENT_IEC) {
    const pickupAmps = Math.max(1.0, getCon(slotPtr, conCount, 0, 400.0));
    const tms = Math.max(0.025, getCon(slotPtr, conCount, 1, 0.5));
    const curveK = getCon(slotPtr, conCount, 2, 0.14);
    const curveAlpha = getCon(slotPtr, conCount, 3, 0.02);
    const instMult = getCon(slotPtr, conCount, 4, 10.0);
    const instTime = getCon(slotPtr, conCount, 5, 0.02);

    const m = iAmps / pickupAmps;
    let tripTime: f64 = -1.0;
    if (m > 1.0) {
      if (instMult > 0.0 && m >= instMult) {
        tripTime = instTime;
      } else {
        tripTime = tms * (curveK / (Math.pow(m, curveAlpha) - 1.0));
      }
      setState(slotPtr, 0, 1.0);
    } else {
      setState(slotPtr, 0, 0.0);
    }
    setState(slotPtr, 1, tripTime);
    setIo(slotPtr, 12, tripTime);
    return;
  }

  // 7. Distribution Circuit Breaker / Load-Break Switch
  if (archetypeId == ARCH_SWITCHGEAR) {
    const rClosed = getCon(slotPtr, conCount, 2, 0.001);
    const clearTime = getCon(slotPtr, conCount, 3, 0.05);
    const isClosed = isNaN(closedFlag) || closedFlag >= 0.5;
    setIo(slotPtr, 8, isClosed ? rClosed : 1.0e9);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 12, isClosed ? clearTime : 0.0);
    return;
  }

  // 8. Shunt Capacitor Bank (Q = Q_nom * V_pu^2)
  if (archetypeId == ARCH_SHUNT_CAPACITOR) {
    const qNomKvar = Math.max(1.0, getCon(slotPtr, conCount, 0, 1200.0));
    const vNomKv = Math.max(0.1, getCon(slotPtr, conCount, 1, 12.47));
    const xcOhm = (vNomKv * vNomKv * 1000.0) / qNomKvar;
    setIo(slotPtr, 8, 0.0);
    setIo(slotPtr, 9, -xcOhm);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, vPu * vPu);
    return;
  }

  // 9. Composite ZIP Load / EV Fast Charger
  if (archetypeId == ARCH_ZIP_LOAD) {
    const zp = getCon(slotPtr, conCount, 2, 0.3);
    const ip = getCon(slotPtr, conCount, 3, 0.3);
    const pp = getCon(slotPtr, conCount, 4, 0.4);
    const zq = getCon(slotPtr, conCount, 5, 0.5);
    const iq = getCon(slotPtr, conCount, 6, 0.2);
    const pq = getCon(slotPtr, conCount, 7, 0.3);

    const pOut = zp * vPu * vPu + ip * vPu + pp;
    const qOut = zq * vPu * vPu + iq * vPu + pq;
    setIo(slotPtr, 14, pOut);
    setIo(slotPtr, 15, qOut);
    return;
  }

  // 10. IEEE 1547-2018 Category B DER Volt-VAR & Volt-Watt Smart Inverter Curves
  if (archetypeId == ARCH_DER_IEEE1547) {
    const v1 = getCon(slotPtr, conCount, 1, 0.92);
    const v2 = getCon(slotPtr, conCount, 2, 0.98);
    const v3 = getCon(slotPtr, conCount, 3, 1.02);
    const v4 = getCon(slotPtr, conCount, 4, 1.08);
    const qMax = getCon(slotPtr, conCount, 5, 0.44);
    const qMinAbs = getCon(slotPtr, conCount, 6, 0.44);
    const vw1 = getCon(slotPtr, conCount, 7, 1.06);
    const vw2 = getCon(slotPtr, conCount, 8, 1.1);
    const pMin = getCon(slotPtr, conCount, 9, 0.2);

    // Volt-VAR piecewise linear curve (+Q = capacitive injection, -Q = inductive absorption)
    let qOut: f64 = 0.0;
    if (vPu <= v1) {
      qOut = qMax;
    } else if (vPu < v2) {
      qOut = qMax * ((v2 - vPu) / Math.max(1e-6, v2 - v1));
    } else if (vPu <= v3) {
      qOut = 0.0;
    } else if (vPu < v4) {
      qOut = -qMinAbs * ((vPu - v3) / Math.max(1e-6, v4 - v3));
    } else {
      qOut = -qMinAbs;
    }

    // Volt-Watt piecewise linear active power curtailment curve
    let pLimit: f64 = 1.0;
    if (vPu <= vw1) {
      pLimit = 1.0;
    } else if (vPu < vw2) {
      pLimit = pMin + (1.0 - pMin) * ((vw2 - vPu) / Math.max(1e-6, vw2 - vw1));
    } else {
      pLimit = pMin;
    }
    const pOut = Math.min(pAvailPu, pLimit);

    setState(slotPtr, 0, pOut);
    setState(slotPtr, 1, qOut);
    setIo(slotPtr, 14, pOut);
    setIo(slotPtr, 15, qOut);
    return;
  }
}
