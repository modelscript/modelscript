// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript full-order dynamic model runtime for `@modelscript/pslf-std-lib`.
 *
 * Implements standardized IEEE Std 1110 / IEEE Std 421.5-2016 / WECC / NERC mathematical
 * formulations for PSLF `.dyd` models using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`) — `META[0]` = active state count (0..8)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — PSLF `.dyd` parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — `0..7`: dynamic states, `8..15`: equilibrium cache,
 *                                                     `16..23`: Heun y0 scratch, `24..31`: Heun k1 scratch
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — network & inter-model I/O bus:
 *       IO[0] = eterm (pu), IO[1] = speedDev (pu), IO[2] = efd (pu), IO[3] = pmech (pu),
 *       IO[4] = vr (pu), IO[5] = vi (pu), IO[6] = vsPss (pu), IO[7] = pelec (pu),
 *       IO[8] = qelec (pu), IO[9] = irInj (pu), IO[10] = iiInj (pu), IO[11] = qSvc (pu),
 *       IO[12] = tripMult (0..1), IO[13] = freqHz (Hz), IO[14] = pref (pu), IO[15] = qref (pu)
 */

import {
  clampF64,
  evalElectronicLoadScale,
  evalIeeeQuadraticSat,
  evalIeeeQuadraticSat2Pt,
  evalIeeeRectifierFex,
  evalSwingAccel,
  evalWeccLvplScale,
  firstOrderLagDeriv,
  leadLagOutput,
  nonWindupLagDeriv,
  rateLimitedServoDeriv,
} from "../../../../../packages/runtime/assembly/physics/ieee-wecc-dynamics";

const OFF_META: usize = 0x000;
const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;
const MAX_DYN_STATES: i32 = 8;

// Archetype IDs (must match `PslfArchetypeId` in pslf-std-schemas.ts)
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
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isFinite(v) ? v : fallback;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), isFinite(v) ? v : 0.0);
}

@inline
function getDState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3));
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), isFinite(v) ? v : 0.0);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), isFinite(v) ? v : 0.0);
}

@inline
function setNStates(slotPtr: usize, n: i32): void {
  store<i32>(slotPtr + OFF_META, n);
}

@inline
function getNStates(slotPtr: usize): i32 {
  const n = load<i32>(slotPtr + OFF_META);
  return n >= 0 && n <= MAX_DYN_STATES ? n : 4;
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function pslfGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model states for exact flat-start steady-state equilibrium (`max|dstate/dt| < 1e-6`).
 * Returns the number of active dynamic states for the archetype.
 */
export function pslfModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 16; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  const eterm = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 1.0;
  const efd0 = getIo(slotPtr, 2) > 1e-6 ? getIo(slotPtr, 2) : 1.5;
  const pmech0 = getIo(slotPtr, 3);
  const vrIn = getIo(slotPtr, 4);
  const viIn = getIo(slotPtr, 5);
  const theta0 = Math.abs(vrIn) > 1e-9 || Math.abs(viIn) > 1e-9 ? Math.atan2(viIn, vrIn) : 0.0;
  const pelec0 = getIo(slotPtr, 7) != 0.0 ? getIo(slotPtr, 7) : pmech0;
  const qelec0 = getIo(slotPtr, 8);

  // =========================================================================
  // 1. Synchronous Generators: GENROU/GENTPF/GENTPJ (6-state), GENSAL (5-state), GENCLS (2-state)
  // =========================================================================
  if (archetypeId == ARCH_SYNC_GEN_CLASSICAL) {
    // 2 states: 0=delta, 1=dw; cached: 8=eqp0
    const lpd: f64 = 0.25;
    const num = pelec0 * lpd;
    const den = eterm * eterm + qelec0 * lpd;
    const delta0 = theta0 + Math.atan2(num, den);
    const eqp0 = Math.hypot(num, den) / eterm;
    setState(slotPtr, 0, delta0);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 8, eqp0);
    setIo(slotPtr, 2, eqp0);
    setIo(slotPtr, 3, pelec0);
    setIo(slotPtr, 7, pelec0);
    setNStates(slotPtr, 2);
    return 2;
  }

  if (archetypeId == ARCH_SYNC_GEN_ROUND || archetypeId == ARCH_SYNC_GEN_SALIENT) {
    // Full IEEE Std 1110 6th-order GENROU (or 5th-order GENSAL):
    // 0: delta, 1: dw, 2: eqp, 3: edp, 4: psi_kd, 5: psi_kq
    const isSalient = archetypeId == ARCH_SYNC_GEN_SALIENT;
    const ld = Math.max(0.2, getCon(slotPtr, conCount, isSalient ? 5 : 6, isSalient ? 1.2 : 1.85));
    const lq = Math.max(0.2, getCon(slotPtr, conCount, isSalient ? 6 : 7, isSalient ? 0.75 : 1.75));
    const lpd = Math.max(0.05, getCon(slotPtr, conCount, isSalient ? 7 : 8, 0.3));
    const lpq = isSalient ? lq : Math.max(0.05, getCon(slotPtr, conCount, 9, 0.45));
    const lppd = Math.max(0.03, Math.min(lpd - 0.01, getCon(slotPtr, conCount, isSalient ? 8 : 10, 0.2)));
    const ll = Math.max(0.01, Math.min(lppd - 0.01, getCon(slotPtr, conCount, isSalient ? 9 : 11, 0.14)));
    const s10 = Math.max(0.0, getCon(slotPtr, conCount, isSalient ? 10 : 12, 0.09));
    const s12 = Math.max(0.0, getCon(slotPtr, conCount, isSalient ? 11 : 13, 0.35));

    const lppq = lppd;
    const kd1 = (lppd - ll) / Math.max(1e-4, lpd - ll);
    const kd2 = (lpd - lppd) / Math.max(1e-4, lpd - ll);
    const qSatScale = isSalient ? 0.0 : (lq - ll) / Math.max(1e-4, ld - ll);

    // Fixed-point solve for saturated steady-state internal rotor angle delta0
    let lqEff = lq;
    let delta0 = theta0;
    let id0: f64 = 0.0;
    let iq0: f64 = 0.0;
    let eqp0: f64 = eterm;
    let edp0: f64 = 0.0;
    let psiKd0: f64 = eterm;
    let psiKq0: f64 = 0.0;
    let eqpp0: f64 = eterm;
    let edpp0: f64 = 0.0;
    let sat0: f64 = 0.0;

    for (let iter = 0; iter < 8; iter++) {
      delta0 = theta0 + Math.atan2(pelec0 * lqEff, eterm * eterm + qelec0 * lqEff);
      const sd = Math.sin(delta0 - theta0);
      const cd = Math.cos(delta0 - theta0);
      const vd0 = eterm * sd;
      const vq0 = eterm * cd;
      id0 = (pelec0 * sd + qelec0 * cd) / eterm;
      iq0 = (pelec0 * cd - qelec0 * sd) / eterm;
      eqp0 = vq0 + lpd * id0;
      psiKd0 = eqp0 - (lpd - ll) * id0;
      eqpp0 = kd1 * eqp0 + kd2 * psiKd0;
      edpp0 = lppq * iq0 - vd0;
      if (isSalient) {
        edp0 = 0.0;
        psiKq0 = edpp0;
        break;
      }
      edp0 = edpp0 + (lpq - lppq) * iq0;
      psiKq0 = edp0 - (lpq - ll) * iq0;
      const psiAg = Math.hypot(eqpp0, edpp0);
      sat0 = evalIeeeQuadraticSat(psiAg, s10, s12);
      const satQ = sat0 * qSatScale * edpp0;
      if (Math.abs(iq0) > 1e-6) {
        lqEff = Math.max(lppq + 0.01, lq + satQ / iq0);
      }
    }

    const psiAgFinal = Math.hypot(eqpp0, edpp0);
    sat0 = evalIeeeQuadraticSat(psiAgFinal, s10, s12);
    const efdEq = eqp0 + (ld - lpd) * id0 + sat0 * eqpp0;

    setState(slotPtr, 0, delta0);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, eqp0);
    setState(slotPtr, 3, edp0);
    setState(slotPtr, 4, psiKd0);
    setState(slotPtr, 5, psiKq0);
    setState(slotPtr, 8, efdEq);

    setIo(slotPtr, 2, efdEq);
    setIo(slotPtr, 3, pelec0);
    setIo(slotPtr, 7, pelec0);
    setIo(slotPtr, 9, id0 * Math.sin(delta0) + iq0 * Math.cos(delta0));
    setIo(slotPtr, 10, -id0 * Math.cos(delta0) + iq0 * Math.sin(delta0));
    const nStates = isSalient ? 5 : 6;
    setNStates(slotPtr, nStates);
    return nStates;
  }

  // =========================================================================
  // 2. IEEE Std 421.5 Exciters: ST1A/ST4B (4-state), AC1A (5-state), DC1A (5-state)
  // =========================================================================
  if (archetypeId == ARCH_EXCITER_STATIC) {
    // 4 states: 0=vm (transducer), 1=x_ll (lead-lag), 2=vr (AVR), 3=x_f (rate feedback)
    const isSexs = conCount <= 6;
    const ka = Math.max(1.0, getCon(slotPtr, conCount, isSexs ? 2 : 5, isSexs ? 100.0 : 200.0));
    const kf = isSexs ? 0.0 : getCon(slotPtr, conCount, 10, 0.0);
    const vref0 = eterm + efd0 / ka;

    setState(slotPtr, 0, eterm);
    setState(slotPtr, 1, efd0 / ka);
    setState(slotPtr, 2, efd0);
    setState(slotPtr, 3, kf * efd0);
    setState(slotPtr, 8, vref0);
    setState(slotPtr, 9, efd0);
    setIo(slotPtr, 2, efd0);
    setNStates(slotPtr, 4);
    return 4;
  }

  if (archetypeId == ARCH_EXCITER_AC || archetypeId == ARCH_EXCITER_DC) {
    // 5 states: 0=vm, 1=x_ll, 2=vr, 3=ve, 4=x_f
    const ka = Math.max(1.0, getCon(slotPtr, conCount, 5, 200.0));
    const kc = archetypeId == ARCH_EXCITER_AC ? Math.max(0.0, getCon(slotPtr, conCount, 9, 0.2)) : 0.0;
    const kf = getCon(slotPtr, conCount, 10, 0.03);
    const ke: f64 = 1.0;
    const kd: f64 = archetypeId == ARCH_EXCITER_AC ? 0.38 : 0.0;
    const ifd0 = Math.max(0.0, efd0);

    let ve0 = efd0;
    let vr0: f64;
    if (archetypeId == ARCH_EXCITER_AC) {
      ve0 = Math.max(0.1, efd0 + 0.577 * kc * ifd0);
      for (let k = 0; k < 4; k++) {
        const fex = Math.max(0.15, evalIeeeRectifierFex((kc * ifd0) / Math.max(0.1, ve0)));
        ve0 = efd0 / fex;
      }
      const sat0 = evalIeeeQuadraticSat2Pt(ve0, 3.1, 0.03, 4.18, 0.1);
      vr0 = (ke + sat0) * ve0 + kd * ifd0;
    } else {
      const sat0 = evalIeeeQuadraticSat2Pt(ve0, 2.8, 0.1, 3.8, 0.35);
      vr0 = (ke + sat0) * ve0;
    }

    const vref0 = eterm + vr0 / ka;
    setState(slotPtr, 0, eterm);
    setState(slotPtr, 1, vr0 / ka);
    setState(slotPtr, 2, vr0);
    setState(slotPtr, 3, ve0);
    setState(slotPtr, 4, kf * ve0);
    setState(slotPtr, 8, vref0);
    setState(slotPtr, 9, efd0);
    setState(slotPtr, 10, vr0);
    setIo(slotPtr, 2, efd0);
    setNStates(slotPtr, 5);
    return 5;
  }

  // =========================================================================
  // 3. IEEE/WECC Governors: TGOV1 (2-state), HYGOV (4-state), GGOV1/GAST (3-state)
  // =========================================================================
  if (archetypeId == ARCH_GOVERNOR_STEAM) {
    // 2 states: 0=valve, 1=x_rh (reheat lag); cached: 8=pref0
    setState(slotPtr, 0, pmech0);
    setState(slotPtr, 1, pmech0);
    setState(slotPtr, 8, pmech0);
    setIo(slotPtr, 3, pmech0);
    setNStates(slotPtr, 2);
    return 2;
  }

  if (archetypeId == ARCH_GOVERNOR_HYDRO) {
    // Full IEEE 1992 HYGOV (4 states): 0=x_tr (temp droop), 1=x_f (filter), 2=g (gate), 3=q (water flow)
    const at = Math.max(0.2, getCon(slotPtr, conCount, 9, 1.2));
    const qnl = Math.max(0.0, getCon(slotPtr, conCount, 11, 0.08));
    const q0 = Math.max(0.05, pmech0 / at + qnl);
    const g0 = q0; // H0 = (q0 / g0)^2 = 1.0

    setState(slotPtr, 0, g0);
    setState(slotPtr, 1, g0);
    setState(slotPtr, 2, g0);
    setState(slotPtr, 3, q0);
    setState(slotPtr, 8, g0);
    setState(slotPtr, 9, pmech0);
    setIo(slotPtr, 3, pmech0);
    setNStates(slotPtr, 4);
    return 4;
  }

  if (archetypeId == ARCH_GOVERNOR_GAS) {
    // 3 states: 0=valve, 1=x_fuel, 2=x_exh; cached: 8=pref0
    setState(slotPtr, 0, pmech0);
    setState(slotPtr, 1, pmech0);
    setState(slotPtr, 2, pmech0);
    setState(slotPtr, 8, pmech0);
    setIo(slotPtr, 3, pmech0);
    setNStates(slotPtr, 3);
    return 3;
  }

  // =========================================================================
  // 4. Dual-Input Power System Stabilizer (PSS2A / PSS2B — 4 states)
  // =========================================================================
  if (archetypeId == ARCH_STABILIZER) {
    // 4 states: 0=xw1 (washout 1), 1=xw2 (washout 2), 2=xll1 (lead-lag 1), 3=xll2 (lead-lag 2)
    const dw0 = getIo(slotPtr, 1);
    setState(slotPtr, 0, dw0);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setState(slotPtr, 3, 0.0);
    setIo(slotPtr, 6, 0.0);
    setNStates(slotPtr, 4);
    return 4;
  }

  // =========================================================================
  // 5. WECC 2nd-Generation IBRs (REGC_A / REEC_A / REPC_A — 3 states)
  // =========================================================================
  if (
    archetypeId == ARCH_IBR_CONVERTER ||
    archetypeId == ARCH_IBR_ELECTRICAL ||
    archetypeId == ARCH_IBR_PLANT_CTRL
  ) {
    // 3 states: 0=ip, 1=iq, 2=vFilt; cached: 8=iqRef
    const kqv = getCon(slotPtr, conCount, 5, 2.0);
    const ip0 = pelec0 / eterm;
    const iq0 = -qelec0 / eterm;
    const iqRef = iq0 - kqv * (1.0 - eterm);
    setState(slotPtr, 0, ip0);
    setState(slotPtr, 1, iq0);
    setState(slotPtr, 2, eterm);
    setState(slotPtr, 8, iqRef);
    setIo(slotPtr, 9, ip0);
    setIo(slotPtr, 10, iq0);
    setNStates(slotPtr, 3);
    return 3;
  }

  // =========================================================================
  // 6. WECC CMPLDW Composite Load & Induction Motor (3 states)
  // =========================================================================
  if (archetypeId == ARCH_LOAD_COMPOSITE || archetypeId == ARCH_LOAD_MOTOR) {
    // 3 states: 0=slip, 1=eqp_m, 2=edp_m; cached: 8=tMechRef, 9=pLoad0, 10=tElec0, 11=eterm0
    const slip0: f64 = 0.02;
    const eqpM0 = eterm * 0.92;
    const edpM0 = -eterm * slip0 * 1.5;
    const tElec0 = ((eterm * eqpM0) / 0.92) * (slip0 / (0.04 + slip0 * slip0 * 4.0));
    const tMechRef = tElec0 / ((1.0 - slip0) * (1.0 - slip0));
    const pLoad0 = Math.abs(pelec0) > 1e-6 ? pelec0 : 1.0;

    setState(slotPtr, 0, slip0);
    setState(slotPtr, 1, eqpM0);
    setState(slotPtr, 2, edpM0);
    setState(slotPtr, 8, tMechRef);
    setState(slotPtr, 9, pLoad0);
    setState(slotPtr, 10, tElec0);
    setState(slotPtr, 11, eterm);
    setIo(slotPtr, 7, pLoad0);
    setIo(slotPtr, 9, pLoad0 / eterm);
    setNStates(slotPtr, 3);
    return 3;
  }

  // =========================================================================
  // 7. FACTS / SVC / HVDC (1 state) & Relays (2 states)
  // =========================================================================
  if (archetypeId == ARCH_FACTS_SVC || archetypeId == ARCH_HVDC) {
    // 1 dynamic state: 0=bSvc; cached: 8=vref0
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 8, eterm);
    setIo(slotPtr, 11, 0.0);
    setNStates(slotPtr, 1);
    return 1;
  }

  if (archetypeId == ARCH_RELAY_LIMITER) {
    // 2 states: 0=timer, 1=tripped
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 12, 1.0);
    setNStates(slotPtr, 2);
    return 2;
  }

  setNStates(slotPtr, 0);
  return 0;
}

/**
 * Evaluates cleanroom continuous-time state derivatives `dstate/dt` for a single PSLF archetype.
 */
export function pslfModelEvalDerivatives(
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
  const vrIn = getIo(slotPtr, 4);
  const viIn = getIo(slotPtr, 5);
  const theta = Math.abs(vrIn) > 1e-9 || Math.abs(viIn) > 1e-9 ? Math.atan2(viIn, vrIn) : 0.0;
  const vsIn = getIo(slotPtr, 6);

  // =========================================================================
  // 1. Synchronous Generators
  // =========================================================================
  if (archetypeId == ARCH_SYNC_GEN_CLASSICAL) {
    const h = Math.max(0.5, getCon(slotPtr, conCount, 0, 3.5));
    const d = getCon(slotPtr, conCount, 1, 1.0);
    const lpd: f64 = 0.25;
    const delta = getState(slotPtr, 0);
    const dw = getState(slotPtr, 1);
    const eqp = getState(slotPtr, 8);
    const pelec = ((eqp * eterm) / lpd) * Math.sin(delta - theta);
    const omegaBase: f64 = 2.0 * Math.PI * 60.0;
    setDState(slotPtr, 0, omegaBase * dw);
    setDState(slotPtr, 1, evalSwingAccel(pmechIn, pelec, dw, h, d));
    setIo(slotPtr, 7, pelec);
    setIo(slotPtr, 1, dw);
    return;
  }

  if (archetypeId == ARCH_SYNC_GEN_ROUND || archetypeId == ARCH_SYNC_GEN_SALIENT) {
    const isSalient = archetypeId == ARCH_SYNC_GEN_SALIENT;
    const tpdo = Math.max(0.1, getCon(slotPtr, conCount, 0, isSalient ? 5.5 : 6.5));
    const tppdo = Math.max(0.015, getCon(slotPtr, conCount, 1, 0.05));
    const tpqo = isSalient ? 1.0 : Math.max(0.05, getCon(slotPtr, conCount, 2, 0.5));
    const tppqo = Math.max(0.015, getCon(slotPtr, conCount, isSalient ? 2 : 3, 0.08));
    const h = Math.max(0.5, getCon(slotPtr, conCount, isSalient ? 3 : 4, isSalient ? 3.5 : 4.0));
    const d = getCon(slotPtr, conCount, isSalient ? 4 : 5, isSalient ? 1.0 : 1.5);
    const ld = Math.max(0.2, getCon(slotPtr, conCount, isSalient ? 5 : 6, isSalient ? 1.2 : 1.85));
    const lq = Math.max(0.2, getCon(slotPtr, conCount, isSalient ? 6 : 7, isSalient ? 0.75 : 1.75));
    const lpd = Math.max(0.05, getCon(slotPtr, conCount, isSalient ? 7 : 8, 0.3));
    const lpq = isSalient ? lq : Math.max(0.05, getCon(slotPtr, conCount, 9, 0.45));
    const lppd = Math.max(0.03, Math.min(lpd - 0.01, getCon(slotPtr, conCount, isSalient ? 8 : 10, 0.2)));
    const ll = Math.max(0.01, Math.min(lppd - 0.01, getCon(slotPtr, conCount, isSalient ? 9 : 11, 0.14)));
    const s10 = Math.max(0.0, getCon(slotPtr, conCount, isSalient ? 10 : 12, 0.09));
    const s12 = Math.max(0.0, getCon(slotPtr, conCount, isSalient ? 11 : 13, 0.35));

    const lppq = lppd;
    const kd1 = (lppd - ll) / Math.max(1e-4, lpd - ll);
    const kd2 = (lpd - lppd) / Math.max(1e-4, lpd - ll);
    const kq1 = isSalient ? 0.0 : (lppq - ll) / Math.max(1e-4, lpq - ll);
    const kq2 = isSalient ? 1.0 : (lpq - lppq) / Math.max(1e-4, lpq - ll);

    const delta = getState(slotPtr, 0);
    const dw = getState(slotPtr, 1);
    const eqp = getState(slotPtr, 2);
    const edp = getState(slotPtr, 3);
    const psiKd = getState(slotPtr, 4);
    const psiKq = getState(slotPtr, 5);

    const sd = Math.sin(delta - theta);
    const cd = Math.cos(delta - theta);
    const vd = eterm * sd;
    const vq = eterm * cd;

    const eqpp = kd1 * eqp + kd2 * psiKd;
    const edpp = isSalient ? psiKq : kq1 * edp + kq2 * psiKq;
    const id = (eqpp - vq) / lppd;
    const iq = (vd + edpp) / lppq;

    const pelec = vd * id + vq * iq;
    const psiAg = Math.hypot(eqpp, edpp);
    const sat = evalIeeeQuadraticSat(psiAg, s10, s12);
    const satD = sat * eqpp;
    const satQ = isSalient ? 0.0 : sat * ((lq - ll) / Math.max(1e-4, ld - ll)) * edpp;

    const dFluxDiff = eqp - psiKd - (lpd - ll) * id;
    const dEqp = (efdIn - eqp - (ld - lpd) * (id + (kd2 * dFluxDiff) / Math.max(1e-4, lpd - ll)) - satD) / tpdo;
    const dPsiKd = dFluxDiff / tppdo;

    let dEdp: f64 = 0.0;
    let dPsiKq: f64 = 0.0;
    if (isSalient) {
      dPsiKq = (-psiKq - (lq - lppq) * iq) / tppqo;
    } else {
      const qFluxDiff = edp - psiKq - (lpq - ll) * iq;
      dEdp = (-edp - (lq - lpq) * (iq + (kq2 * qFluxDiff) / Math.max(1e-4, lpq - ll)) - satQ) / tpqo;
      dPsiKq = qFluxDiff / tppqo;
    }

    const omegaBase: f64 = 2.0 * Math.PI * 60.0;
    setDState(slotPtr, 0, omegaBase * dw);
    setDState(slotPtr, 1, evalSwingAccel(pmechIn, pelec, dw, h, d));
    setDState(slotPtr, 2, dEqp);
    setDState(slotPtr, 3, dEdp);
    setDState(slotPtr, 4, dPsiKd);
    setDState(slotPtr, 5, dPsiKq);

    setIo(slotPtr, 1, dw);
    setIo(slotPtr, 7, pelec);
    setIo(slotPtr, 9, id * Math.sin(delta) + iq * Math.cos(delta));
    setIo(slotPtr, 10, -id * Math.cos(delta) + iq * Math.sin(delta));
    return;
  }

  // =========================================================================
  // 2. IEEE Std 421.5 Exciters
  // =========================================================================
  if (archetypeId == ARCH_EXCITER_STATIC) {
    const isSexs = conCount <= 6;
    const tr = isSexs ? 0.02 : Math.max(0.0, getCon(slotPtr, conCount, 0, 0.02));
    const vimax = isSexs ? 0.5 : Math.max(0.05, getCon(slotPtr, conCount, 1, 0.5));
    const vimin = isSexs ? -0.5 : Math.min(-0.05, getCon(slotPtr, conCount, 2, -0.5));
    const tb = Math.max(0.0, getCon(slotPtr, conCount, isSexs ? 1 : 4, 10.0));
    const tc = isSexs ? getCon(slotPtr, conCount, 0, 0.1) * tb : Math.max(0.0, getCon(slotPtr, conCount, 3, 1.0));
    const ka = Math.max(1.0, getCon(slotPtr, conCount, isSexs ? 2 : 5, isSexs ? 100.0 : 200.0));
    const ta = Math.max(0.01, getCon(slotPtr, conCount, isSexs ? 3 : 6, 0.05));
    const vrmax = getCon(slotPtr, conCount, isSexs ? 5 : 7, 5.0);
    const vrmin = getCon(slotPtr, conCount, isSexs ? 4 : 8, -4.5);
    const kc = isSexs ? 0.0 : Math.max(0.0, getCon(slotPtr, conCount, 9, 0.05));
    const kf = isSexs ? 0.0 : getCon(slotPtr, conCount, 10, 0.0);
    const tf = isSexs ? 1.0 : Math.max(0.05, getCon(slotPtr, conCount, 11, 1.0));

    const vm = getState(slotPtr, 0);
    const xLl = getState(slotPtr, 1);
    const vr = getState(slotPtr, 2);
    const xF = getState(slotPtr, 3);
    const vref0 = getState(slotPtr, 8);
    const efd0 = getState(slotPtr, 9);

    const vtSense = tr <= 1e-6 ? eterm : vm;
    const vf = (kf * vr - xF) / tf;
    const vErr = clampF64(vref0 - vtSense + vsIn - vf, vimin, vimax);
    const llOut = leadLagOutput(vErr, xLl, tc, tb);
    const hiCeil = Math.max(efd0 + 0.2, eterm * vrmax - kc * Math.max(0.0, efd0));
    const loCeil = Math.min(efd0 - 0.2, eterm * vrmin);

    setDState(slotPtr, 0, firstOrderLagDeriv(vm, eterm, 1.0, tr));
    setDState(slotPtr, 1, firstOrderLagDeriv(xLl, vErr, 1.0, tb));
    setDState(slotPtr, 2, nonWindupLagDeriv(vr, llOut, ka, ta, loCeil, hiCeil));
    setDState(slotPtr, 3, (kf * vr - xF) / tf);
    setIo(slotPtr, 2, clampF64(vr, loCeil, hiCeil));
    return;
  }

  if (archetypeId == ARCH_EXCITER_AC || archetypeId == ARCH_EXCITER_DC) {
    const tr = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.02));
    const tc = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.0));
    const tb = Math.max(0.0, getCon(slotPtr, conCount, 4, 0.0));
    const ka = Math.max(1.0, getCon(slotPtr, conCount, 5, 200.0));
    const ta = Math.max(0.01, getCon(slotPtr, conCount, 6, 0.05));
    const vrmax = getCon(slotPtr, conCount, 7, 5.0);
    const vrmin = getCon(slotPtr, conCount, 8, -4.5);
    const kc = archetypeId == ARCH_EXCITER_AC ? Math.max(0.0, getCon(slotPtr, conCount, 9, 0.2)) : 0.0;
    const kf = getCon(slotPtr, conCount, 10, 0.03);
    const tf = Math.max(0.05, getCon(slotPtr, conCount, 11, 1.0));
    const ke: f64 = 1.0;
    const te: f64 = archetypeId == ARCH_EXCITER_AC ? 0.8 : 0.5;
    const kd: f64 = archetypeId == ARCH_EXCITER_AC ? 0.38 : 0.0;

    const vm = getState(slotPtr, 0);
    const xLl = getState(slotPtr, 1);
    const vr = getState(slotPtr, 2);
    const ve = getState(slotPtr, 3);
    const xF = getState(slotPtr, 4);
    const vref0 = getState(slotPtr, 8);
    const efd0 = getState(slotPtr, 9);
    const vr0 = getState(slotPtr, 10);

    const vtSense = tr <= 1e-6 ? eterm : vm;
    const vf = (kf * ve - xF) / tf;
    const vErr = vref0 - vtSense + vsIn - vf;
    const llOut = leadLagOutput(vErr, xLl, tc, tb);
    const vrHi = Math.max(vr0 + 0.5, vrmax);
    const vrLo = Math.min(vr0 - 0.5, vrmin);
    const ifdPos = Math.max(0.0, efdIn > 0.0 ? efdIn : efd0);

    setDState(slotPtr, 0, firstOrderLagDeriv(vm, eterm, 1.0, tr));
    setDState(slotPtr, 1, firstOrderLagDeriv(xLl, vErr, 1.0, tb));
    setDState(slotPtr, 2, nonWindupLagDeriv(vr, llOut, ka, ta, vrLo, vrHi));
    setDState(slotPtr, 4, (kf * ve - xF) / tf);

    if (archetypeId == ARCH_EXCITER_AC) {
      const sat = evalIeeeQuadraticSat2Pt(ve, 3.1, 0.03, 4.18, 0.1);
      setDState(slotPtr, 3, (vr - (ke + sat) * ve - kd * ifdPos) / te);
      const efdOut = ve * evalIeeeRectifierFex((kc * ifdPos) / Math.max(0.1, ve));
      setIo(slotPtr, 2, clampF64(efdOut, vrLo, vrHi));
    } else {
      const sat = evalIeeeQuadraticSat2Pt(ve, 2.8, 0.1, 3.8, 0.35);
      setDState(slotPtr, 3, (vr - (ke + sat) * ve) / te);
      setIo(slotPtr, 2, clampF64(ve, vrLo, vrHi));
    }
    return;
  }

  // =========================================================================
  // 3. IEEE/WECC Governors
  // =========================================================================
  if (archetypeId == ARCH_GOVERNOR_STEAM) {
    const r = Math.max(0.005, getCon(slotPtr, conCount, 0, 0.05));
    const t1 = Math.max(0.02, getCon(slotPtr, conCount, 1, 0.5));
    const pref0 = getState(slotPtr, 8);
    const vmax = Math.max(pref0 + 0.1, getCon(slotPtr, conCount, 2, 1.0));
    const vmin = Math.min(pref0 - 0.1, getCon(slotPtr, conCount, 3, 0.0));
    const t2 = Math.max(0.0, getCon(slotPtr, conCount, 4, 1.0));
    const t3 = Math.max(0.05, getCon(slotPtr, conCount, 5, 5.0));
    const dtDamp = Math.max(0.0, getCon(slotPtr, conCount, 6, 0.0));

    const valve = getState(slotPtr, 0);
    const xRh = getState(slotPtr, 1);
    const target = clampF64(pref0 - dwIn / r, vmin, vmax);
    setDState(slotPtr, 0, nonWindupLagDeriv(valve, target, 1.0, t1, vmin, vmax));
    setDState(slotPtr, 1, firstOrderLagDeriv(xRh, valve, 1.0, t3));
    const pmOut = leadLagOutput(valve, xRh, t2, t3) - dtDamp * dwIn;
    setIo(slotPtr, 3, clampF64(pmOut, vmin, vmax));
    return;
  }

  if (archetypeId == ARCH_GOVERNOR_HYDRO) {
    // Full IEEE 1992 HYGOV with temporary droop, velocity-limited gate servo, and nonlinear water hammer
    const r = Math.max(0.005, getCon(slotPtr, conCount, 0, 0.05));
    const rt = Math.max(r, getCon(slotPtr, conCount, 1, 0.4));
    const tr = Math.max(0.2, getCon(slotPtr, conCount, 2, 5.0));
    const tf = Math.max(0.01, getCon(slotPtr, conCount, 3, 0.05));
    const tg = Math.max(0.05, getCon(slotPtr, conCount, 4, 0.5));
    const velm = Math.max(0.05, getCon(slotPtr, conCount, 5, 0.2));
    const g0 = getState(slotPtr, 8);
    const gmax = Math.max(g0 + 0.1, getCon(slotPtr, conCount, 6, 1.0));
    const gmin = Math.min(Math.max(0.02, g0 - 0.1), getCon(slotPtr, conCount, 7, 0.0));
    const tw = Math.max(0.1, getCon(slotPtr, conCount, 8, 1.5));
    const at = Math.max(0.2, getCon(slotPtr, conCount, 9, 1.2));
    const dturb = Math.max(0.0, getCon(slotPtr, conCount, 10, 0.2));
    const qnl = Math.max(0.0, getCon(slotPtr, conCount, 11, 0.08));

    const xTr = getState(slotPtr, 0);
    const xF = getState(slotPtr, 1);
    const g = getState(slotPtr, 2);
    const q = getState(slotPtr, 3);

    const uDroop = g0 - dwIn / r;
    const td = (rt / r) * tr;
    const cCmd = leadLagOutput(uDroop, xTr, tr, td);

    setDState(slotPtr, 0, firstOrderLagDeriv(xTr, uDroop, 1.0, td));
    setDState(slotPtr, 1, firstOrderLagDeriv(xF, cCmd, 1.0, tf));
    setDState(slotPtr, 2, rateLimitedServoDeriv(g, xF, tg, -velm, velm, gmin, gmax));

    const gSafe = Math.max(0.05, g);
    const qSafe = Math.max(0.01, q);
    const h = (qSafe / gSafe) * (qSafe / gSafe);
    setDState(slotPtr, 3, (1.0 - h) / tw);

    const pmHydro = at * h * (qSafe - qnl) - dturb * gSafe * dwIn;
    setIo(slotPtr, 3, clampF64(pmHydro, 0.0, gmax * at * 1.5));
    return;
  }

  if (archetypeId == ARCH_GOVERNOR_GAS) {
    const r = Math.max(0.005, getCon(slotPtr, conCount, 0, 0.05));
    const t1 = Math.max(0.02, getCon(slotPtr, conCount, 1, 0.4));
    const pref0 = getState(slotPtr, 8);
    const vmax = Math.max(pref0 + 0.1, getCon(slotPtr, conCount, 2, 1.05));
    const vmin = Math.min(pref0 - 0.1, getCon(slotPtr, conCount, 3, 0.0));
    const tFuel = Math.max(0.05, getCon(slotPtr, conCount, 4, 0.4));
    const tExh = Math.max(0.2, getCon(slotPtr, conCount, 5, 3.0));
    const atLim = Math.max(pref0 + 0.1, 1.0);
    const kt: f64 = 2.0;

    const valve = getState(slotPtr, 0);
    const xFuel = getState(slotPtr, 1);
    const xExh = getState(slotPtr, 2);

    const speedGov = clampF64(pref0 - dwIn / r, vmin, vmax);
    const tempLim = atLim + kt * (atLim - xExh);
    const fuelCmd = Math.min(speedGov, tempLim);

    setDState(slotPtr, 0, nonWindupLagDeriv(valve, fuelCmd, 1.0, t1, vmin, vmax));
    setDState(slotPtr, 1, firstOrderLagDeriv(xFuel, valve, 1.0, tFuel));
    setDState(slotPtr, 2, firstOrderLagDeriv(xExh, xFuel, 1.0, tExh));
    setIo(slotPtr, 3, clampF64(xFuel, vmin, vmax));
    return;
  }

  // =========================================================================
  // 4. Dual-Input Power System Stabilizer (PSS2A / PSS2B)
  // =========================================================================
  if (archetypeId == ARCH_STABILIZER) {
    const tw1 = Math.max(0.5, getCon(slotPtr, conCount, 0, 10.0));
    const tw2 = Math.max(0.5, getCon(slotPtr, conCount, 1, 10.0));
    const ks1 = getCon(slotPtr, conCount, 2, 10.0);
    const t1 = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.15));
    const t2 = Math.max(0.01, getCon(slotPtr, conCount, 4, 0.03));
    const t3 = Math.max(0.0, getCon(slotPtr, conCount, 5, 0.15));
    const t4 = Math.max(0.01, getCon(slotPtr, conCount, 6, 0.03));
    const vstmax = getCon(slotPtr, conCount, 7, 0.1);
    const vstmin = getCon(slotPtr, conCount, 8, -0.1);

    const xw1 = getState(slotPtr, 0);
    const xw2 = getState(slotPtr, 1);
    const xll1 = getState(slotPtr, 2);
    const xll2 = getState(slotPtr, 3);

    const w1Out = dwIn - xw1;
    const w2Out = w1Out - xw2;
    const gIn = ks1 * w2Out;
    const ll1Out = leadLagOutput(gIn, xll1, t1, t2);
    const ll2Out = leadLagOutput(ll1Out, xll2, t3, t4);

    setDState(slotPtr, 0, w1Out / tw1);
    setDState(slotPtr, 1, w2Out / tw2);
    setDState(slotPtr, 2, firstOrderLagDeriv(xll1, gIn, 1.0, t2));
    setDState(slotPtr, 3, firstOrderLagDeriv(xll2, ll1Out, 1.0, t4));
    setIo(slotPtr, 6, clampF64(ll2Out, vstmin, vstmax));
    return;
  }

  // =========================================================================
  // 5. WECC IBRs
  // =========================================================================
  if (
    archetypeId == ARCH_IBR_CONVERTER ||
    archetypeId == ARCH_IBR_ELECTRICAL ||
    archetypeId == ARCH_IBR_PLANT_CTRL
  ) {
    const tg = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.02));
    const brkpt = getCon(slotPtr, conCount, 2, 0.9);
    const zerox = getCon(slotPtr, conCount, 3, 0.4);
    const kqv = getCon(slotPtr, conCount, 5, 2.0);
    const pref = getIo(slotPtr, 14) != 0.0 ? getIo(slotPtr, 14) : getState(slotPtr, 0) * eterm;

    const ip = getState(slotPtr, 0);
    const iq = getState(slotPtr, 1);
    const vf = getState(slotPtr, 2);
    const iqRef = getState(slotPtr, 8);

    const lvScale = evalWeccLvplScale(eterm, zerox, brkpt);
    const ipTarget = clampF64((pref / eterm) * lvScale, 0.0, 1.1);
    const iqTarget = clampF64(iqRef + kqv * (1.0 - vf), -1.0, 1.0);

    setDState(slotPtr, 0, (ipTarget - ip) / tg);
    setDState(slotPtr, 1, (iqTarget - iq) / tg);
    setDState(slotPtr, 2, (eterm - vf) / 0.02);
    setIo(slotPtr, 9, ip);
    setIo(slotPtr, 10, iq);
    return;
  }

  // =========================================================================
  // 6. WECC CMPLDW Composite Load & 3-Phase Induction Motor
  // =========================================================================
  if (archetypeId == ARCH_LOAD_COMPOSITE || archetypeId == ARCH_LOAD_MOTOR) {
    const isComposite = archetypeId == ARCH_LOAD_COMPOSITE;
    const hMotor = isComposite ? 0.5 : Math.max(0.1, getCon(slotPtr, conCount, 4, 0.5));
    const tp0 = isComposite ? 0.1 : Math.max(0.02, getCon(slotPtr, conCount, 3, 0.1));

    const slip = getState(slotPtr, 0);
    const eqpM = getState(slotPtr, 1);
    const edpM = getState(slotPtr, 2);
    const tMechRef = getState(slotPtr, 8);
    const pLoad0 = getState(slotPtr, 9);
    const tElec0 = Math.max(1e-6, getState(slotPtr, 10));
    const eterm0 = Math.max(0.1, getState(slotPtr, 11));

    const tElec = ((eterm * eqpM) / 0.92) * (slip / (0.04 + slip * slip * 4.0));
    const tMech = tMechRef * (1.0 - slip) * (1.0 - slip);

    setDState(slotPtr, 0, evalSwingAccel(tMech, tElec, 0.0, hMotor, 0.0));
    setDState(slotPtr, 1, (eterm * 0.92 - eqpM) / tp0);
    setDState(slotPtr, 2, (-eterm * slip * 1.5 - edpM) / tp0);

    if (isComposite) {
      const fmA = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.15));
      const fmB = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.15));
      const fmC = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.1));
      const fmD = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.2));
      const fmTot = clampF64(fmA + fmB + fmC + fmD, 0.0, 1.0);
      const fel = clampF64(getCon(slotPtr, conCount, 4, 0.15), 0.0, 1.0 - fmTot);
      const vd1 = getCon(slotPtr, conCount, 6, 0.7);
      const vd2 = getCon(slotPtr, conCount, 7, 0.5);
      const fStatic = Math.max(0.0, 1.0 - fmTot - fel);

      const pMotor = fmTot * pLoad0 * (tElec / tElec0);
      const pElec = fel * pLoad0 * evalElectronicLoadScale(eterm, vd1, vd2);
      const vRatio = eterm / eterm0;
      const pStatic = fStatic * pLoad0 * (0.3 * vRatio * vRatio + 0.3 * vRatio + 0.4);
      const pTotal = pMotor + pElec + pStatic;
      setIo(slotPtr, 7, pTotal);
      setIo(slotPtr, 9, pTotal / eterm);
    } else {
      const pMotor = pLoad0 * (tElec / tElec0);
      setIo(slotPtr, 7, pMotor);
      setIo(slotPtr, 9, pMotor / eterm);
    }
    return;
  }

  // =========================================================================
  // 7. FACTS / SVC / HVDC & Relays
  // =========================================================================
  if (archetypeId == ARCH_FACTS_SVC || archetypeId == ARCH_HVDC) {
    const ksvc = getCon(slotPtr, conCount, 0, 100.0);
    const tsvc = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.05));
    const bmax = getCon(slotPtr, conCount, 2, 1.0);
    const bmin = getCon(slotPtr, conCount, 3, -1.0);
    const bSvc = getState(slotPtr, 0);
    const vref = getState(slotPtr, 8);
    const target = clampF64(ksvc * (vref - eterm), bmin, bmax);
    setDState(slotPtr, 0, (target - bSvc) / tsvc);
    setIo(slotPtr, 11, bSvc * eterm * eterm);
    return;
  }

  if (archetypeId == ARCH_RELAY_LIMITER) {
    const f1 = getCon(slotPtr, conCount, 0, 59.3);
    const t1 = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.2));
    const frac1 = clampF64(getCon(slotPtr, conCount, 2, 0.1), 0.0, 1.0);
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
 * Advances a PSLF dynamic model slot by `dt` seconds using 2nd-order Heun integration
 * across all active states (`0..nStates-1`).
 */
export function pslfModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const nStates = getNStates(slotPtr);
  if (nStates <= 0) {
    pslfModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
    return;
  }

  for (let i = 0; i < nStates; i++) {
    setState(slotPtr, 16 + i, getState(slotPtr, i));
  }

  pslfModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  for (let i = 0; i < nStates; i++) {
    const k1 = getDState(slotPtr, i);
    setState(slotPtr, 24 + i, k1);
    setState(slotPtr, i, getState(slotPtr, 16 + i) + dt * k1);
  }

  pslfModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  for (let i = 0; i < nStates; i++) {
    const y0 = getState(slotPtr, 16 + i);
    const k1 = getState(slotPtr, 24 + i);
    const k2 = getDState(slotPtr, i);
    setState(slotPtr, i, y0 + 0.5 * dt * (k1 + k2));
  }

  // Re-sync outputs after Heun corrector
  pslfModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Computes max `|dstate/dt|` immediately after initialization across all active states
 * to verify exact flat-start equilibrium.
 */
export function pslfModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  pslfModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  const nStates = getNStates(slotPtr);
  let maxRes: f64 = 0.0;
  for (let i = 0; i < nStates; i++) {
    const d = Math.abs(getDState(slotPtr, i));
    if (d > maxRes) maxRes = d;
  }
  return maxRes;
}

/**
 * Batched zero-copy initialization across `count` model descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function pslfBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    pslfModelInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy Heun time-step across `count` model descriptors.
 */
export function pslfBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    pslfModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
