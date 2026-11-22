// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript dynamic model runtime for `@modelscript/powerworld-std-lib`.
 *
 * Implements standardized IEEE / WECC / NERC mathematical formulations for PowerWorld `.aux`
 * dynamic models using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — PowerWorld `.aux` parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — network & inter-model I/O bus:
 *       IO[0] = eterm (pu), IO[1] = speedDev (pu), IO[2] = efd (pu), IO[3] = pmech (pu),
 *       IO[4] = vr (pu), IO[5] = vi (pu), IO[6] = vsPss (pu), IO[7] = pelec (pu),
 *       IO[8] = qelec (pu), IO[9] = irInj (pu), IO[10] = iiInj (pu), IO[11] = qSvc (pu),
 *       IO[12] = tripMult (0..1), IO[13] = freqHz (Hz), IO[14] = pref (pu), IO[15] = qref (pu)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `PowerWorldArchetypeId` in powerworld-std-schemas.ts)
const ARCH_SYNC_GEN_ROUND: i32 = 1;
const ARCH_SYNC_GEN_SALIENT: i32 = 2;
const ARCH_SYNC_GEN_CLASSICAL: i32 = 3;
const ARCH_EXCITER_STATIC: i32 = 10;
const ARCH_EXCITER_AC: i32 = 11;
const ARCH_EXCITER_DC: i32 = 12;
const ARCH_GOVERNOR_STEAM: i32 = 20;
const ARCH_GOVERNOR_HYDRO: i32 = 21;
const ARCH_GOVERNOR_GAS: i32 = 22;
const ARCH_STABILIZER: i32 = 30;
const ARCH_IBR_CONVERTER: i32 = 40;
const ARCH_IBR_ELECTRICAL: i32 = 41;
const ARCH_IBR_PLANT_CTRL: i32 = 42;
const ARCH_LOAD_COMPOSITE: i32 = 50;
const ARCH_LOAD_MOTOR: i32 = 51;
const ARCH_FACTS_SVC: i32 = 60;
const ARCH_HVDC: i32 = 61;
const ARCH_RELAY_LIMITER: i32 = 70;

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
export function pwGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model states for flat-start steady-state equilibrium (`dstate/dt = 0`).
 * Returns the number of active dynamic states for the archetype.
 */
export function pwModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const eterm = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 1.0;
  const efd0 = getIo(slotPtr, 2) > 1e-6 ? getIo(slotPtr, 2) : 1.5;
  const pmech0 = getIo(slotPtr, 3);
  const pelec0 = getIo(slotPtr, 7) != 0.0 ? getIo(slotPtr, 7) : pmech0;
  const qelec0 = getIo(slotPtr, 8);

  if (
    archetypeId == ARCH_SYNC_GEN_ROUND ||
    archetypeId == ARCH_SYNC_GEN_SALIENT ||
    archetypeId == ARCH_SYNC_GEN_CLASSICAL
  ) {
    // State 0: delta (rad), State 1: dw (pu), State 2: eqp (pu), State 3: edp (pu)
    const xdp = archetypeId == ARCH_SYNC_GEN_CLASSICAL ? 0.25 : getCon(slotPtr, conCount, 8, 0.3);
    const delta0 = Math.atan2(pelec0 * xdp, eterm * eterm + qelec0 * xdp);
    const eqp0 = eterm * Math.cos(delta0) + (qelec0 / eterm) * xdp;
    setState(slotPtr, 0, delta0);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, eqp0 > 0.5 ? eqp0 : 1.05);
    setState(slotPtr, 3, 0.0);
    setIo(slotPtr, 3, pelec0);
    setIo(slotPtr, 2, eqp0 > 0.5 ? eqp0 : 1.05);
    return 4;
  }

  if (
    archetypeId == ARCH_EXCITER_STATIC ||
    archetypeId == ARCH_EXCITER_AC ||
    archetypeId == ARCH_EXCITER_DC
  ) {
    // State 0: vref (param-cached), State 1: vm (transducer), State 2: efd
    const ka = Math.max(1.0, getCon(slotPtr, conCount, 5, 200.0));
    const vref = eterm + efd0 / ka;
    setState(slotPtr, 0, vref);
    setState(slotPtr, 1, eterm);
    setState(slotPtr, 2, efd0);
    return 3;
  }

  if (
    archetypeId == ARCH_GOVERNOR_STEAM ||
    archetypeId == ARCH_GOVERNOR_HYDRO ||
    archetypeId == ARCH_GOVERNOR_GAS
  ) {
    // State 0: pref, State 1: valve/gate, State 2: pmech
    setState(slotPtr, 0, pmech0);
    setState(slotPtr, 1, pmech0);
    setState(slotPtr, 2, pmech0);
    return 3;
  }

  if (archetypeId == ARCH_STABILIZER) {
    // State 0: washout state, State 1: lead-lag state, State 2: vsOut
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setIo(slotPtr, 6, 0.0);
    return 3;
  }

  if (
    archetypeId == ARCH_IBR_CONVERTER ||
    archetypeId == ARCH_IBR_ELECTRICAL ||
    archetypeId == ARCH_IBR_PLANT_CTRL
  ) {
    // State 0: ipCmd/ip, State 1: iqCmd/iq, State 2: vFilt, State 3: piInt
    const ip0 = pelec0 / eterm;
    const iq0 = -qelec0 / eterm;
    setState(slotPtr, 0, ip0);
    setState(slotPtr, 1, iq0);
    setState(slotPtr, 2, eterm);
    setState(slotPtr, 3, iq0);
    setIo(slotPtr, 9, ip0);
    setIo(slotPtr, 10, iq0);
    return 4;
  }

  if (archetypeId == ARCH_LOAD_COMPOSITE || archetypeId == ARCH_LOAD_MOTOR) {
    // State 0: slip, State 1: eqp_motor
    setState(slotPtr, 0, 0.02);
    setState(slotPtr, 1, eterm * 0.92);
    return 2;
  }

  if (archetypeId == ARCH_FACTS_SVC || archetypeId == ARCH_HVDC) {
    // State 0: vref, State 1: bSvc / pDc
    setState(slotPtr, 0, eterm);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 11, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_RELAY_LIMITER) {
    // State 0: timer (s), State 1: tripped flag (0 or 1)
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 12, 1.0);
    return 2;
  }

  return 0;
}

/**
 * Evaluates cleanroom continuous-time state derivatives `dstate/dt` for a single PowerWorld archetype.
 */
export function pwModelEvalDerivatives(
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

  if (
    archetypeId == ARCH_SYNC_GEN_ROUND ||
    archetypeId == ARCH_SYNC_GEN_SALIENT ||
    archetypeId == ARCH_SYNC_GEN_CLASSICAL
  ) {
    const tdo = Math.max(0.1, getCon(slotPtr, conCount, 0, 6.5));
    const h = Math.max(
      0.5,
      archetypeId == ARCH_SYNC_GEN_CLASSICAL ? getCon(slotPtr, conCount, 0, 3.5) : getCon(slotPtr, conCount, 4, 4.0),
    );
    const d =
      archetypeId == ARCH_SYNC_GEN_CLASSICAL ? getCon(slotPtr, conCount, 1, 1.0) : getCon(slotPtr, conCount, 5, 1.5);
    const xdp = Math.max(0.05, archetypeId == ARCH_SYNC_GEN_CLASSICAL ? 0.25 : getCon(slotPtr, conCount, 8, 0.3));

    const delta = getState(slotPtr, 0);
    const dw = getState(slotPtr, 1);
    const eqp = getState(slotPtr, 2);

    const pelec = ((eqp * eterm) / xdp) * Math.sin(delta);
    const omegaBase: f64 = 2.0 * Math.PI * 60.0;
    setDState(slotPtr, 0, omegaBase * dw);
    setDState(slotPtr, 1, (pmechIn - pelec - d * dw) / (2.0 * h));
    setDState(slotPtr, 2, archetypeId == ARCH_SYNC_GEN_CLASSICAL ? 0.0 : (efdIn - eqp) / tdo);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 7, pelec);
    setIo(slotPtr, 1, dw);
    return;
  }

  if (
    archetypeId == ARCH_EXCITER_STATIC ||
    archetypeId == ARCH_EXCITER_AC ||
    archetypeId == ARCH_EXCITER_DC
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
    setIo(slotPtr, 2, efd);
    return;
  }

  if (
    archetypeId == ARCH_GOVERNOR_STEAM ||
    archetypeId == ARCH_GOVERNOR_HYDRO ||
    archetypeId == ARCH_GOVERNOR_GAS
  ) {
    const r = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.05));
    const t1 = Math.max(0.05, getCon(slotPtr, conCount, 1, 0.5));
    const t3 = Math.max(
      0.1,
      archetypeId == ARCH_GOVERNOR_HYDRO ? getCon(slotPtr, conCount, 8, 1.5) : getCon(slotPtr, conCount, 5, 5.0),
    );
    const vmax = getCon(slotPtr, conCount, 2, 1.0);
    const vmin = getCon(slotPtr, conCount, 3, 0.0);

    const pref = getState(slotPtr, 0);
    const valve = getState(slotPtr, 1);
    const pmech = getState(slotPtr, 2);

    const cmd = clamp(pref - dwIn / r, vmin, vmax);
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, (cmd - valve) / t1);
    setDState(slotPtr, 2, (valve - pmech) / t3);
    setIo(slotPtr, 3, pmech);
    return;
  }

  if (archetypeId == ARCH_STABILIZER) {
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
    setIo(slotPtr, 6, clamp(vs, vmin, vmax));
    return;
  }

  if (
    archetypeId == ARCH_IBR_CONVERTER ||
    archetypeId == ARCH_IBR_ELECTRICAL ||
    archetypeId == ARCH_IBR_PLANT_CTRL
  ) {
    const tg = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.02));
    const kqv = getCon(slotPtr, conCount, 5, 2.0);
    const pref = getIo(slotPtr, 14) != 0.0 ? getIo(slotPtr, 14) : getState(slotPtr, 0) * eterm;

    const ip = getState(slotPtr, 0);
    const iq = getState(slotPtr, 1);
    const vf = getState(slotPtr, 2);

    // LVPL active current scaling below 0.9 pu
    const lvScale = eterm < 0.9 ? clamp((eterm - 0.4) / 0.5, 0.0, 1.0) : 1.0;
    const ipTarget = clamp((pref / eterm) * lvScale, 0.0, 1.1);
    const iqTarget = clamp(getState(slotPtr, 3) + kqv * (1.0 - vf), -1.0, 1.0);

    setDState(slotPtr, 0, (ipTarget - ip) / tg);
    setDState(slotPtr, 1, (iqTarget - iq) / tg);
    setDState(slotPtr, 2, (eterm - vf) / 0.02);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 9, ip);
    setIo(slotPtr, 10, iq);
    return;
  }

  if (archetypeId == ARCH_LOAD_COMPOSITE || archetypeId == ARCH_LOAD_MOTOR) {
    const h = Math.max(0.1, getCon(slotPtr, conCount, 4, 0.5));
    const slip = getState(slotPtr, 0);
    const eqp = getState(slotPtr, 1);
    const tElec = eterm * eterm * (slip / (0.04 + slip * slip * 4.0));
    const tMech = 0.25 * (1.0 - slip) * (1.0 - slip);
    setDState(slotPtr, 0, (tMech - tElec) / (2.0 * h));
    setDState(slotPtr, 1, (eterm * 0.92 - eqp) / 0.1);
    return;
  }

  if (archetypeId == ARCH_FACTS_SVC || archetypeId == ARCH_HVDC) {
    const ksvc = getCon(slotPtr, conCount, 0, 100.0);
    const tsvc = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.05));
    const bmax = getCon(slotPtr, conCount, 2, 1.0);
    const bmin = getCon(slotPtr, conCount, 3, -1.0);
    const vref = getState(slotPtr, 0);
    const bSvc = getState(slotPtr, 1);
    const target = clamp(ksvc * (vref - eterm), bmin, bmax);
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, (target - bSvc) / tsvc);
    setIo(slotPtr, 11, bSvc * eterm * eterm);
    return;
  }

  if (archetypeId == ARCH_RELAY_LIMITER) {
    const f1 = getCon(slotPtr, conCount, 0, 59.3);
    const t1 = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.2));
    const frac1 = clamp(getCon(slotPtr, conCount, 2, 0.1), 0.0, 1.0);
    const freqHz = getIo(slotPtr, 13) > 1.0 ? getIo(slotPtr, 13) : 60.0 * (1.0 + dwIn);
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
  }
}

/**
 * Advances a PowerWorld dynamic model slot by `dt` seconds using 2nd-order Heun integration.
 */
export function pwModelStep(archetypeId: i32, t: f64, dt: f64, slotPtr: usize, conCount: i32): void {
  const nStates = 4;
  // Save y0 and k1 in local registers (max 4 states per archetype)
  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);
  const y0_2 = getState(slotPtr, 2);
  const y0_3 = getState(slotPtr, 3);

  pwModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);
  const k1_2 = getDState(slotPtr, 2);
  const k1_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  setState(slotPtr, 1, y0_1 + dt * k1_1);
  setState(slotPtr, 2, y0_2 + dt * k1_2);
  setState(slotPtr, 3, y0_3 + dt * k1_3);

  pwModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);
  const k2_2 = getDState(slotPtr, 2);
  const k2_3 = getDState(slotPtr, 3);

  if (nStates > 0) {
    setState(slotPtr, 0, y0_0 + 0.5 * dt * (k1_0 + k2_0));
    setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));
    setState(slotPtr, 2, y0_2 + 0.5 * dt * (k1_2 + k2_2));
    setState(slotPtr, 3, y0_3 + 0.5 * dt * (k1_3 + k2_3));
  }

  // Re-sync outputs after Heun corrector
  pwModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Computes max `|dstate/dt|` immediately after initialization to verify flat-start equilibrium.
 */
export function pwModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  pwModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
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
export function pwBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    pwModelInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy Heun time-step across `count` model descriptors.
 */
export function pwBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    pwModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
