// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript dynamic model & protection relay runtime for
 * `@modelscript/powerfactory-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — PowerFactory type / DSL parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — network & inter-model I/O bus:
 *       IO[0] = eterm (pu), IO[1] = speedDev (pu), IO[2] = efd (pu), IO[3] = pmech (pu),
 *       IO[4] = vr (pu), IO[5] = vi (pu), IO[6] = vsPss (pu), IO[7] = pelec (pu),
 *       IO[8] = qelec (pu), IO[9] = irInj (pu), IO[10] = iiInj (pu), IO[11] = qSvc (pu),
 *       IO[12] = tripMult (0..1), IO[13] = freqHz (Hz), IO[14] = iMeas (pu), IO[15] = pref (pu)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `PowerFactoryArchetypeId` in powerfactory-std-schemas.ts)
const ARCH_EQUIP_SYNC_MACHINE: i32 = 10;
const ARCH_EQUIP_ASYNC_MOTOR: i32 = 11;
const ARCH_EQUIP_STATIC_GEN: i32 = 13;
const ARCH_DSL_EXCITER_STATIC: i32 = 20;
const ARCH_DSL_EXCITER_AC: i32 = 21;
const ARCH_DSL_EXCITER_DC: i32 = 22;
const ARCH_DSL_GOVERNOR_STEAM: i32 = 30;
const ARCH_DSL_GOVERNOR_HYDRO: i32 = 31;
const ARCH_DSL_GOVERNOR_GAS: i32 = 32;
const ARCH_DSL_STABILIZER: i32 = 40;
const ARCH_DSL_IBR_CONVERTER: i32 = 50;
const ARCH_DSL_IBR_ELECTRICAL: i32 = 51;
const ARCH_DSL_IBR_PLANT_CTRL: i32 = 52;
const ARCH_DSL_FACTS_SVC: i32 = 60;
const ARCH_RELAY_TOC_IEC: i32 = 70;
const ARCH_RELAY_TOC_IEEE: i32 = 71;
const ARCH_RELAY_DISTANCE_21: i32 = 72;
const ARCH_RELAY_DIFF_87: i32 = 73;
const ARCH_RELAY_UFLS_81: i32 = 74;

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
function getDState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3));
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
export function pfGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Evaluates standardized IEC 60255-151 and IEEE C37.112 inverse-time overcurrent
 * relay trip time (seconds) for current multiple `M = I / I_pickup`.
 *
 * Curve types:
 *   - 0:  IEC Standard Inverse (SI):      TMS * 0.14 / (M^0.02 - 1)
 *   - 1:  IEC Very Inverse (VI):          TMS * 13.5 / (M - 1)
 *   - 2:  IEC Extremely Inverse (EI):     TMS * 80.0 / (M^2 - 1)
 *   - 3:  IEC Long-Time Inverse (LTI):    TMS * 120.0 / (M - 1)
 *   - 10: IEEE Moderately Inverse (MI):   TD * (0.0515 / (M^0.02 - 1) + 0.114)
 *   - 11: IEEE Very Inverse (VI):         TD * (19.61 / (M^2 - 1) + 0.491)
 *   - 12: IEEE Extremely Inverse (EI):    TD * (28.2 / (M^2 - 1) + 0.1217)
 */
export function pfEvalTocTripTime(curveType: i32, iMultiple: f64, tms: f64): f64 {
  if (iMultiple <= 1.0 || tms <= 0.0) {
    return Infinity;
  }
  if (curveType == 0) {
    return tms * (0.14 / (Math.pow(iMultiple, 0.02) - 1.0));
  }
  if (curveType == 1) {
    return tms * (13.5 / (iMultiple - 1.0));
  }
  if (curveType == 2) {
    return tms * (80.0 / (iMultiple * iMultiple - 1.0));
  }
  if (curveType == 3) {
    return tms * (120.0 / (iMultiple - 1.0));
  }
  if (curveType == 10) {
    return tms * (0.0515 / (Math.pow(iMultiple, 0.02) - 1.0) + 0.114);
  }
  if (curveType == 11) {
    return tms * (19.61 / (iMultiple * iMultiple - 1.0) + 0.491);
  }
  if (curveType == 12) {
    return tms * (28.2 / (iMultiple * iMultiple - 1.0) + 0.1217);
  }
  // Default fallback: IEC Standard Inverse
  return tms * (0.14 / (Math.pow(iMultiple, 0.02) - 1.0));
}

/**
 * Initializes model states for flat-start steady-state equilibrium (`dstate/dt = 0`).
 * Returns the number of active dynamic states for the archetype.
 */
export function pfModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 4; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  const eterm = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 1.0;
  const efd0 = getIo(slotPtr, 2) > 1e-6 ? getIo(slotPtr, 2) : 1.5;
  const pmech0 = getIo(slotPtr, 3);
  const pelec0 = getIo(slotPtr, 7) != 0.0 ? getIo(slotPtr, 7) : pmech0;
  const qelec0 = getIo(slotPtr, 8);

  if (archetypeId == ARCH_EQUIP_SYNC_MACHINE) {
    // State 0: delta (rad), State 1: dw (pu), State 2: eqp (pu), State 3: edp (pu)
    const xdp = Math.max(0.05, getCon(slotPtr, conCount, 6, 0.28));
    const num = pelec0 * xdp;
    const den = eterm * eterm + qelec0 * xdp;
    const delta0 = Math.atan2(num, den);
    const eqp0 = Math.hypot(num, den) / eterm;
    setState(slotPtr, 0, delta0);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, eqp0);
    setState(slotPtr, 3, 0.0);
    setIo(slotPtr, 2, eqp0);
    setIo(slotPtr, 3, pelec0);
    return 4;
  }

  if (archetypeId == ARCH_EQUIP_ASYNC_MOTOR) {
    // State 0: slip, State 1: eqp_motor, State 2: tMechRef
    const slip0: f64 = 0.02;
    const tElec0 = eterm * eterm * (slip0 / (0.04 + slip0 * slip0 * 4.0));
    const tMechRef = tElec0 / ((1.0 - slip0) * (1.0 - slip0));
    setState(slotPtr, 0, slip0);
    setState(slotPtr, 1, eterm * 0.92);
    setState(slotPtr, 2, tMechRef);
    return 3;
  }

  if (
    archetypeId == ARCH_DSL_EXCITER_STATIC ||
    archetypeId == ARCH_DSL_EXCITER_AC ||
    archetypeId == ARCH_DSL_EXCITER_DC
  ) {
    // State 0: vref, State 1: vm (transducer), State 2: efd
    const ka = Math.max(1.0, getCon(slotPtr, conCount, 5, 200.0));
    const vref = eterm + efd0 / ka;
    setState(slotPtr, 0, vref);
    setState(slotPtr, 1, eterm);
    setState(slotPtr, 2, efd0);
    return 3;
  }

  if (
    archetypeId == ARCH_DSL_GOVERNOR_STEAM ||
    archetypeId == ARCH_DSL_GOVERNOR_HYDRO ||
    archetypeId == ARCH_DSL_GOVERNOR_GAS
  ) {
    // State 0: pref, State 1: valve/gate, State 2: pmech
    setState(slotPtr, 0, pmech0);
    setState(slotPtr, 1, pmech0);
    setState(slotPtr, 2, pmech0);
    return 3;
  }

  if (archetypeId == ARCH_DSL_STABILIZER) {
    // State 0: washout state, State 1: lead-lag state, State 2: vsOut
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setIo(slotPtr, 6, 0.0);
    return 3;
  }

  if (
    archetypeId == ARCH_EQUIP_STATIC_GEN ||
    archetypeId == ARCH_DSL_IBR_CONVERTER ||
    archetypeId == ARCH_DSL_IBR_ELECTRICAL ||
    archetypeId == ARCH_DSL_IBR_PLANT_CTRL
  ) {
    // State 0: ip, State 1: iq, State 2: vFilt, State 3: iqRef
    const kqv = getCon(slotPtr, conCount, 5, 2.0);
    const ip0 = pelec0 / eterm;
    const iq0 = -qelec0 / eterm;
    const iqRef = iq0 - kqv * (1.0 - eterm);
    setState(slotPtr, 0, ip0);
    setState(slotPtr, 1, iq0);
    setState(slotPtr, 2, eterm);
    setState(slotPtr, 3, iqRef);
    setIo(slotPtr, 9, ip0);
    setIo(slotPtr, 10, iq0);
    setIo(slotPtr, 15, pelec0);
    return 4;
  }

  if (archetypeId == ARCH_DSL_FACTS_SVC) {
    // State 0: vref, State 1: bSvc
    setState(slotPtr, 0, eterm);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 11, 0.0);
    return 2;
  }

  if (
    archetypeId == ARCH_RELAY_TOC_IEC ||
    archetypeId == ARCH_RELAY_TOC_IEEE ||
    archetypeId == ARCH_RELAY_DISTANCE_21 ||
    archetypeId == ARCH_RELAY_DIFF_87 ||
    archetypeId == ARCH_RELAY_UFLS_81
  ) {
    // State 0: timer / integrator (0..1 or s), State 1: tripped flag (0 or 1)
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 12, 1.0);
    return 2;
  }

  // Passive algebraic equipment (TypLne, TypTr2, TypTr3, TypLod)
  return 0;
}

/**
 * Evaluates cleanroom continuous-time state derivatives `dstate/dt` for a PowerFactory archetype.
 */
export function pfModelEvalDerivatives(
  archetypeId: i32,
  _t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const eterm = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 1.0;
  const dwIn = getIo(slotPtr, 1);
  const efdIn = getIo(slotPtr, 2);
  const pmechIn = getIo(slotPtr, 3);
  const vsIn = getIo(slotPtr, 6);
  const iMeas = getIo(slotPtr, 14);

  if (archetypeId == ARCH_EQUIP_SYNC_MACHINE) {
    const h = Math.max(0.5, getCon(slotPtr, conCount, 2, 4.5));
    const d = getCon(slotPtr, conCount, 3, 1.5);
    const xdp = Math.max(0.05, getCon(slotPtr, conCount, 6, 0.28));
    const tdp0 = Math.max(0.1, getCon(slotPtr, conCount, 8, 6.5));

    const delta = getState(slotPtr, 0);
    const dw = getState(slotPtr, 1);
    const eqp = getState(slotPtr, 2);

    const pelec = ((eqp * eterm) / xdp) * Math.sin(delta);
    const omegaBase: f64 = 2.0 * Math.PI * 50.0;
    setDState(slotPtr, 0, omegaBase * dw);
    setDState(slotPtr, 1, (pmechIn - pelec - d * dw) / (2.0 * h));
    setDState(slotPtr, 2, (efdIn - eqp) / tdp0);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 7, pelec);
    setIo(slotPtr, 1, dw);
    return;
  }

  if (archetypeId == ARCH_EQUIP_ASYNC_MOTOR) {
    const h = Math.max(0.1, getCon(slotPtr, conCount, 2, 0.8));
    const slip = getState(slotPtr, 0);
    const eqp = getState(slotPtr, 1);
    const tMechRef = getState(slotPtr, 2);
    const tElec = eterm * eterm * (slip / (0.04 + slip * slip * 4.0));
    const tMech = tMechRef * (1.0 - slip) * (1.0 - slip);
    setDState(slotPtr, 0, (tMech - tElec) / (2.0 * h));
    setDState(slotPtr, 1, (eterm * 0.92 - eqp) / 0.1);
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    return;
  }

  if (
    archetypeId == ARCH_DSL_EXCITER_STATIC ||
    archetypeId == ARCH_DSL_EXCITER_AC ||
    archetypeId == ARCH_DSL_EXCITER_DC
  ) {
    const tr = Math.max(0.005, getCon(slotPtr, conCount, 0, 0.02));
    const ka = Math.max(1.0, getCon(slotPtr, conCount, 5, 200.0));
    const ta = Math.max(0.01, getCon(slotPtr, conCount, 6, 0.05));
    const vrmax = getCon(slotPtr, conCount, 7, 5.0);
    const vrmin = getCon(slotPtr, conCount, 8, -4.5);

    const vref = getState(slotPtr, 0);
    const vm = getState(slotPtr, 1);
    const efd = getState(slotPtr, 2);

    const err = vref - vm + vsIn;
    const target = clamp(ka * err, vrmin, vrmax);
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, (eterm - vm) / tr);
    setDState(slotPtr, 2, (target - efd) / ta);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 2, efd);
    return;
  }

  if (
    archetypeId == ARCH_DSL_GOVERNOR_STEAM ||
    archetypeId == ARCH_DSL_GOVERNOR_HYDRO ||
    archetypeId == ARCH_DSL_GOVERNOR_GAS
  ) {
    const r = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.05));
    const t1 = Math.max(0.05, getCon(slotPtr, conCount, 1, 0.5));
    const vmax = getCon(slotPtr, conCount, 2, 1.0);
    const vmin = getCon(slotPtr, conCount, 3, 0.0);
    const t3 = Math.max(
      0.1,
      archetypeId == ARCH_DSL_GOVERNOR_HYDRO
        ? getCon(slotPtr, conCount, 5, 1.5)
        : getCon(slotPtr, conCount, 5, 5.0),
    );

    const pref = getState(slotPtr, 0);
    const valve = getState(slotPtr, 1);
    const pmech = getState(slotPtr, 2);

    const cmd = clamp(pref - dwIn / r, vmin, vmax);
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, (cmd - valve) / t1);
    setDState(slotPtr, 2, (valve - pmech) / t3);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 3, pmech);
    return;
  }

  if (archetypeId == ARCH_DSL_STABILIZER) {
    const tw = Math.max(0.5, getCon(slotPtr, conCount, 0, 10.0));
    const ks1 = getCon(slotPtr, conCount, 2, 10.0);
    const t2 = Math.max(0.01, getCon(slotPtr, conCount, 4, 0.03));
    const vmax = getCon(slotPtr, conCount, 7, 0.1);
    const vmin = getCon(slotPtr, conCount, 8, -0.1);

    const xw = getState(slotPtr, 0);
    const vs = getState(slotPtr, 1);
    const washOut = dwIn - xw;
    setDState(slotPtr, 0, washOut / tw);
    setDState(slotPtr, 1, (clamp(ks1 * washOut, vmin, vmax) - vs) / t2);
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 6, clamp(vs, vmin, vmax));
    return;
  }

  if (
    archetypeId == ARCH_EQUIP_STATIC_GEN ||
    archetypeId == ARCH_DSL_IBR_CONVERTER ||
    archetypeId == ARCH_DSL_IBR_ELECTRICAL ||
    archetypeId == ARCH_DSL_IBR_PLANT_CTRL
  ) {
    const tg = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.02));
    const brkpt = getCon(slotPtr, conCount, 2, 0.9);
    const zerox = getCon(slotPtr, conCount, 3, 0.4);
    const kqv = getCon(slotPtr, conCount, 5, 2.0);
    const pref = getIo(slotPtr, 15) != 0.0 ? getIo(slotPtr, 15) : getState(slotPtr, 0) * eterm;

    const ip = getState(slotPtr, 0);
    const iq = getState(slotPtr, 1);
    const vf = getState(slotPtr, 2);
    const iqRef = getState(slotPtr, 3);

    const lvSpan = Math.max(0.05, brkpt - zerox);
    const lvScale = eterm < brkpt ? clamp((eterm - zerox) / lvSpan, 0.0, 1.0) : 1.0;
    const ipTarget = clamp((pref / eterm) * lvScale, -1.1, 1.1);
    const iqTarget = clamp(iqRef + kqv * (1.0 - vf), -1.0, 1.0);

    setDState(slotPtr, 0, (ipTarget - ip) / tg);
    setDState(slotPtr, 1, (iqTarget - iq) / tg);
    setDState(slotPtr, 2, (eterm - vf) / 0.02);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 9, ip);
    setIo(slotPtr, 10, iq);
    return;
  }

  if (archetypeId == ARCH_DSL_FACTS_SVC) {
    const ksvc = getCon(slotPtr, conCount, 0, 100.0);
    const tsvc = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.05));
    const bmax = getCon(slotPtr, conCount, 2, 1.0);
    const bmin = getCon(slotPtr, conCount, 3, -1.0);
    const vref = getState(slotPtr, 0);
    const bSvc = getState(slotPtr, 1);
    const target = clamp(ksvc * (vref - eterm), bmin, bmax);
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, (target - bSvc) / tsvc);
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 11, bSvc * eterm * eterm);
    return;
  }

  if (archetypeId == ARCH_RELAY_TOC_IEC || archetypeId == ARCH_RELAY_TOC_IEEE) {
    const ipickup = Math.max(0.05, getCon(slotPtr, conCount, 0, 1.2));
    const tms = Math.max(0.01, getCon(slotPtr, conCount, 1, archetypeId == ARCH_RELAY_TOC_IEEE ? 1.0 : 0.2));
    const defaultCurve: i32 = archetypeId == ARCH_RELAY_TOC_IEEE ? 10 : 0;
    const curveType = <i32>Math.round(getCon(slotPtr, conCount, 2, <f64>defaultCurve));

    const accum = getState(slotPtr, 0);
    const tripped = getState(slotPtr, 1);
    if (tripped >= 0.5) {
      setDState(slotPtr, 0, 0.0);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 12, 0.0);
    } else if (iMeas > ipickup) {
      const tTrip = Math.max(0.005, pfEvalTocTripTime(curveType, iMeas / ipickup, tms));
      setDState(slotPtr, 0, 1.0 / tTrip);
      setDState(slotPtr, 1, accum >= 1.0 ? 100.0 : 0.0);
      setIo(slotPtr, 12, accum >= 1.0 ? 0.0 : 1.0);
    } else {
      setDState(slotPtr, 0, -accum * 10.0);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 12, 1.0);
    }
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    return;
  }

  if (archetypeId == ARCH_RELAY_DISTANCE_21) {
    const z1 = Math.max(0.05, getCon(slotPtr, conCount, 0, 0.8));
    const t1 = Math.max(0.005, getCon(slotPtr, conCount, 1, 0.02));
    const zMeas = iMeas > 1e-6 ? eterm / iMeas : 1e6;
    const timer = getState(slotPtr, 0);
    const tripped = getState(slotPtr, 1);
    if (tripped >= 0.5) {
      setDState(slotPtr, 0, 0.0);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 12, 0.0);
    } else if (zMeas < z1) {
      setDState(slotPtr, 0, 1.0);
      setDState(slotPtr, 1, timer >= t1 ? 100.0 : 0.0);
      setIo(slotPtr, 12, timer >= t1 ? 0.0 : 1.0);
    } else {
      setDState(slotPtr, 0, -timer * 10.0);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 12, 1.0);
    }
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    return;
  }

  if (archetypeId == ARCH_RELAY_DIFF_87) {
    const idiffMin = Math.max(0.05, getCon(slotPtr, conCount, 0, 0.25));
    const tTrip = Math.max(0.005, getCon(slotPtr, conCount, 3, 0.025));
    const timer = getState(slotPtr, 0);
    const tripped = getState(slotPtr, 1);
    if (tripped >= 0.5) {
      setDState(slotPtr, 0, 0.0);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 12, 0.0);
    } else if (iMeas > idiffMin) {
      setDState(slotPtr, 0, 1.0);
      setDState(slotPtr, 1, timer >= tTrip ? 100.0 : 0.0);
      setIo(slotPtr, 12, timer >= tTrip ? 0.0 : 1.0);
    } else {
      setDState(slotPtr, 0, -timer * 10.0);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 12, 1.0);
    }
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    return;
  }

  if (archetypeId == ARCH_RELAY_UFLS_81) {
    const f1 = getCon(slotPtr, conCount, 0, 49.0);
    const t1 = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.2));
    const frac1 = clamp(getCon(slotPtr, conCount, 2, 0.15), 0.0, 1.0);
    const freqHz = getIo(slotPtr, 13) > 1.0 ? getIo(slotPtr, 13) : 50.0 * (1.0 + dwIn);
    const timer = getState(slotPtr, 0);
    const tripped = getState(slotPtr, 1);
    if (tripped >= 0.5) {
      setDState(slotPtr, 0, 0.0);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 12, 1.0 - frac1);
    } else if (freqHz < f1) {
      setDState(slotPtr, 0, 1.0);
      setDState(slotPtr, 1, timer >= t1 ? 100.0 : 0.0);
      setIo(slotPtr, 12, timer >= t1 ? 1.0 - frac1 : 1.0);
    } else {
      setDState(slotPtr, 0, -timer * 10.0);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 12, 1.0);
    }
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    return;
  }

  // Passive algebraic equipment
  setDState(slotPtr, 0, 0.0);
  setDState(slotPtr, 1, 0.0);
  setDState(slotPtr, 2, 0.0);
  setDState(slotPtr, 3, 0.0);
}

/**
 * Advances a PowerFactory dynamic model slot by `dt` seconds using 2nd-order Heun integration.
 */
export function pfModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);
  const y0_2 = getState(slotPtr, 2);
  const y0_3 = getState(slotPtr, 3);

  pfModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);
  const k1_2 = getDState(slotPtr, 2);
  const k1_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  setState(slotPtr, 1, y0_1 + dt * k1_1);
  setState(slotPtr, 2, y0_2 + dt * k1_2);
  setState(slotPtr, 3, y0_3 + dt * k1_3);

  pfModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);
  const k2_2 = getDState(slotPtr, 2);
  const k2_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + 0.5 * dt * (k1_0 + k2_0));
  setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));
  setState(slotPtr, 2, y0_2 + 0.5 * dt * (k1_2 + k2_2));
  setState(slotPtr, 3, y0_3 + 0.5 * dt * (k1_3 + k2_3));

  // Re-sync outputs after Heun corrector
  pfModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Computes max `|dstate/dt|` immediately after initialization to verify flat-start equilibrium.
 */
export function pfModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  pfModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  let maxRes: f64 = 0.0;
  for (let i = 0; i < 4; i++) {
    const d = Math.abs(getDState(slotPtr, i));
    if (d > maxRes) maxRes = d;
  }
  return maxRes;
}

/**
 * Batched zero-copy initialization across `count` model descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function pfBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    pfModelInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy Heun time-step across `count` model descriptors.
 */
export function pfBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    pfModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
