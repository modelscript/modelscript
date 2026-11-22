// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  OFF_CON,
  clamp,
  evalFex,
  evalQuadraticSat,
  firstOrderLagDeriv,
  getCon,
  getIo,
  getState,
  leadLagOutput,
  nonWindupIntDeriv,
  nonWindupLagDeriv,
  setDState,
  setIo,
  setSlotMeta,
  setState,
} from "./blocks";

/**
 * Initializes exciters, limiters & compensators (`10..19`, plus `58` = `comp_rc_xc`)
 * in exact flat-start equilibrium (`dstate == 0` at `t = 0`).
 *
 * State layout:
 *   0: Vt_f (voltage transducer state)
 *   1: x_ll (lead-lag state)
 *   2: Vr (regulator output)
 *   3: Ve / Efd (exciter field / output)
 *   4: Vf (rate feedback washout state)
 *   5: x_pi (integral state for ST4B / PID / OEL thermal integrator)
 *   24: Vref0 (calibrated steady-state voltage reference)
 *   25: Efd0 (steady-state field voltage)
 */
export function initExciterOrLimiter(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.1, getIo(slotPtr, 0));
  const efd0 = getIo(slotPtr, 2);

  // Archetype 58: comp_rc_xc (reactive current compensator COMP / IEEEVC)
  if (archetypeId == 58) {
    const pmech0 = getIo(slotPtr, 3);
    const rc = getCon(conPtr, conCount, 0, 0.0);
    const xc = getCon(conPtr, conCount, 1, 0.0);
    const vTarget0 = eterm + (pmech0 * rc + 0.2 * xc) / Math.max(0.2, eterm);
    setState(slotPtr, 0, vTarget0);
    setState(slotPtr, 24, vTarget0);
    setSlotMeta(slotPtr, 1, 0.02);
    setIo(slotPtr, 13, vTarget0);
    return 1;
  }

  // Archetype 17: lim_oel (over-excitation limiter MAXEX1 / OEL)
  if (archetypeId == 17) {
    setState(slotPtr, 0, efd0); // filtered Ifd
    setState(slotPtr, 5, 0.0);  // inverse-time overload integrator
    setState(slotPtr, 25, efd0);
    setSlotMeta(slotPtr, 6, 0.05);
    return 6;
  }

  // Archetype 18: lim_uel (under-excitation limiter UEL1/UEL2)
  if (archetypeId == 18) {
    setState(slotPtr, 0, eterm);
    setState(slotPtr, 24, eterm);
    setState(slotPtr, 25, efd0);
    setSlotMeta(slotPtr, 2, 0.05);
    return 2;
  }

  // Archetype 19: lim_vhz (Volts/Hz limiter VHZL1)
  if (archetypeId == 19) {
    setState(slotPtr, 0, eterm); // filtered V/f ratio
    setState(slotPtr, 1, 0.0);   // inverse-time V/Hz integrator
    setState(slotPtr, 24, eterm);
    setSlotMeta(slotPtr, 2, 0.05);
    return 2;
  }

  // Standard Exciters (10..16)
  const tr = Math.max(0.0, getCon(conPtr, conCount, 0, 0.02));
  let ka: f64;
  let ta: f64;
  let te: f64 = 0.02;
  let vr0: f64 = efd0;
  let ve0: f64 = efd0;

  if (archetypeId == 10 || archetypeId == 11) {
    // SEXS / SCRX
    ka = Math.max(1.0, getCon(conPtr, conCount, 2, 100.0));
    ta = Math.max(0.01, getCon(conPtr, conCount, 3, 0.05));
    vr0 = efd0;
    ve0 = efd0;
  } else if (archetypeId == 12) {
    // IEEE DC (IEEET1 / ESDC1A) with Ke + Se(Efd)
    ka = Math.max(1.0, getCon(conPtr, conCount, 1, 200.0));
    ta = Math.max(0.01, getCon(conPtr, conCount, 2, 0.04));
    const ke = getCon(conPtr, conCount, 5, 1.0);
    te = Math.max(0.02, getCon(conPtr, conCount, 6, 0.8));
    const e1 = getCon(conPtr, conCount, 10, 2.8);
    const se1 = getCon(conPtr, conCount, 11, 0.1);
    const e2 = getCon(conPtr, conCount, 12, 3.8);
    const se2 = getCon(conPtr, conCount, 13, 0.35);
    vr0 = ke * efd0 + evalQuadraticSat(efd0, e1, se1, e2, se2) * efd0;
    ve0 = efd0;
  } else if (archetypeId == 13) {
    // IEEE AC (ESAC1A..8B) with rectifier regulation F_EX(I_N) + Kd + Se(Ve)
    ka = Math.max(1.0, getCon(conPtr, conCount, 3, 200.0));
    ta = Math.max(0.01, getCon(conPtr, conCount, 4, 0.04));
    const ke = getCon(conPtr, conCount, 7, 1.0);
    te = Math.max(0.02, getCon(conPtr, conCount, 8, 0.8));
    const kc = Math.max(0.0, getCon(conPtr, conCount, 11, 0.2));
    const kd = Math.max(0.0, getCon(conPtr, conCount, 12, 0.38));
    const e1 = getCon(conPtr, conCount, 13, 3.1);
    const se1 = getCon(conPtr, conCount, 14, 0.03);
    const e2 = getCon(conPtr, conCount, 15, 4.18);
    const se2 = getCon(conPtr, conCount, 16, 0.1);
    // Solve Ve0 approximately so Ve0 * Fex(Kc*Ifd0/Ve0) == Efd0
    const ifd0 = Math.max(0.0, efd0);
    ve0 = Math.max(0.1, efd0 + 0.577 * kc * ifd0);
    const fex0 = Math.max(0.2, evalFex((kc * ifd0) / Math.max(0.1, ve0)));
    ve0 = efd0 / fex0;
    vr0 = ke * ve0 + kd * ifd0 + evalQuadraticSat(ve0, e1, se1, e2, se2) * ve0;
  } else if (archetypeId == 14) {
    // IEEE ST (EXST1 / ESST1A)
    ka = Math.max(1.0, getCon(conPtr, conCount, 5, 200.0));
    ta = Math.max(0.01, getCon(conPtr, conCount, 6, 0.04));
    vr0 = efd0;
    ve0 = efd0;
  } else {
    // ST4B PI (15) or PID (16)
    ka = Math.max(1.0, getCon(conPtr, conCount, 3, 100.0));
    ta = Math.max(0.01, getCon(conPtr, conCount, 4, 0.05));
    vr0 = efd0;
    ve0 = efd0;
  }

  const vref0 = archetypeId == 15 || archetypeId == 16 ? eterm : eterm + vr0 / ka;
  const kf = archetypeId == 12 || archetypeId == 13 ? getCon(conPtr, conCount, 9, 0.03) : 0.0;

  setState(slotPtr, 0, eterm);
  setState(slotPtr, 1, vref0 - eterm);
  setState(slotPtr, 2, vr0);
  setState(slotPtr, 3, ve0);
  setState(slotPtr, 4, kf * ve0); // washout state initialized to kf * ve0 so Vf = 0 at t=0
  setState(slotPtr, 5, vr0);      // PI integrator initialized to vr0 so d(x_pi)/dt = 0 at t=0
  setState(slotPtr, 24, vref0);
  setState(slotPtr, 25, efd0);

  let tMin = ta;
  if (tr > 1e-4 && tr < tMin) tMin = tr;
  if (te > 1e-4 && te < tMin) tMin = te;
  setSlotMeta(slotPtr, 6, tMin);
  setIo(slotPtr, 2, efd0);
  return 6;
}

/**
 * Evaluates derivatives and outputs for exciters, limiters & compensators (`10..19` and `58`).
 */
export function evalExciterOrLimiterDerivs(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.05, getIo(slotPtr, 0));
  const speedDev = getIo(slotPtr, 1);
  const efdIn = getIo(slotPtr, 2);
  const pmechIn = getIo(slotPtr, 3);
  const vsPss = getIo(slotPtr, 6);
  const ifdIn = getIo(slotPtr, 8) > 0.0 ? getIo(slotPtr, 8) : efdIn;

  // Archetype 58: comp_rc_xc (reactive current compensator)
  if (archetypeId == 58) {
    const rc = getCon(conPtr, conCount, 0, 0.0);
    const xc = getCon(conPtr, conCount, 1, 0.0);
    const tr = getCon(conPtr, conCount, 2, 0.02);
    const vTarget = eterm + (pmechIn * rc + 0.2 * xc) / Math.max(0.2, eterm);
    const vState = getState(slotPtr, 0);
    setDState(slotPtr, 0, firstOrderLagDeriv(vState, vTarget, 1.0, tr));
    setIo(slotPtr, 13, tr <= 1e-6 ? vTarget : vState);
    return;
  }

  // Archetype 17: lim_oel (inverse-time over-excitation limiter)
  if (archetypeId == 17) {
    const ifdMax = Math.max(getState(slotPtr, 25) + 0.1, getCon(conPtr, conCount, 1, 2.8));
    const kr = Math.max(0.1, getCon(conPtr, conCount, 2, 2.0));
    const trLim = getCon(conPtr, conCount, 3, 0.05);
    const ifdF = getState(slotPtr, 0);
    const thermInt = getState(slotPtr, 5);
    setDState(slotPtr, 0, firstOrderLagDeriv(ifdF, ifdIn, 1.0, trLim));
    const over = Math.max(0.0, ifdF - ifdMax);
    const cool = over > 0.0 ? over : -0.25 * thermInt;
    setDState(slotPtr, 5, nonWindupIntDeriv(thermInt, cool, 1.0, 0.0, 10.0));
    if (thermInt > 0.0 || over > 0.0) {
      setIo(slotPtr, 2, Math.min(efdIn, Math.max(0.5, ifdMax - kr * 0.25 * thermInt)));
    }
    return;
  }

  // Archetype 18: lim_uel (under-excitation limiter — raises Efd when Q/Efd drops below curve)
  if (archetypeId == 18) {
    const efdMinUel = Math.max(0.2, getCon(conPtr, conCount, 0, 0.65) * eterm);
    const vtF = getState(slotPtr, 0);
    setDState(slotPtr, 0, firstOrderLagDeriv(vtF, eterm, 1.0, 0.05));
    setDState(slotPtr, 1, 0.0);
    setIo(slotPtr, 2, Math.max(efdIn, efdMinUel));
    return;
  }

  // Archetype 19: lim_vhz (Volts/Hz limiter — reduces Efd when V / f_pu > threshold)
  if (archetypeId == 19) {
    const vhzMax = Math.max(1.02, getCon(conPtr, conCount, 0, 1.1));
    const kVhz = Math.max(0.5, getCon(conPtr, conCount, 1, 5.0));
    const fPu = Math.max(0.5, 1.0 + speedDev);
    const vhz = eterm / fPu;
    const vhzF = getState(slotPtr, 0);
    const timer = getState(slotPtr, 1);
    setDState(slotPtr, 0, firstOrderLagDeriv(vhzF, vhz, 1.0, 0.05));
    const excess = Math.max(0.0, vhzF - vhzMax);
    setDState(slotPtr, 1, nonWindupIntDeriv(timer, excess > 0.0 ? excess : -0.5 * timer, 1.0, 0.0, 5.0));
    if (excess > 0.0) {
      setIo(slotPtr, 2, Math.max(0.0, efdIn - kVhz * excess));
    }
    return;
  }

  // Exciters 10..16
  const tr = Math.max(0.0, getCon(conPtr, conCount, 0, 0.02));
  const vref0 = getState(slotPtr, 24);
  const efd0 = getState(slotPtr, 25);
  const vtF = getState(slotPtr, 0);
  const xLl = getState(slotPtr, 1);
  const vrReg = getState(slotPtr, 2);
  const ve = getState(slotPtr, 3);
  const xWash = getState(slotPtr, 4);
  const xPi = getState(slotPtr, 5);

  const vtSense = tr <= 1e-6 ? eterm : vtF;
  setDState(slotPtr, 0, firstOrderLagDeriv(vtF, eterm, 1.0, tr));

  if (archetypeId == 10 || archetypeId == 11) {
    // SEXS / SCRX: lead-lag (Ta/Tb) + non-windup lag K / (1 + s Te)
    const taRatio = getCon(conPtr, conCount, 0, 0.1);
    const tb = Math.max(0.0, getCon(conPtr, conCount, 1, 10.0));
    const k = Math.max(1.0, getCon(conPtr, conCount, 2, 100.0));
    const te = Math.max(0.01, getCon(conPtr, conCount, 3, 0.05));
    const eMin = Math.min(efd0 - 0.5, getCon(conPtr, conCount, 4, -5.0));
    const eMax = Math.max(efd0 + 0.5, getCon(conPtr, conCount, 5, 5.0));
    const vErr = vref0 - vtSense + vsPss;
    const tc = taRatio * tb;
    setDState(slotPtr, 1, firstOrderLagDeriv(xLl, vErr, 1.0, tb));
    const llOut = leadLagOutput(vErr, xLl, tc, tb);
    const dVr = nonWindupLagDeriv(vrReg, llOut, k, te, eMin, eMax);
    setDState(slotPtr, 2, dVr);
    setDState(slotPtr, 3, 0.0);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 2, clamp(vrReg, eMin, eMax));
    return;
  }

  if (archetypeId == 12) {
    // IEEE DC (IEEET1 / ESDC1A): non-windup AVR + DC exciter with Ke + Se(Efd) + Kf/Tf washout
    const ka = Math.max(1.0, getCon(conPtr, conCount, 1, 200.0));
    const ta = Math.max(0.01, getCon(conPtr, conCount, 2, 0.04));
    const vrMax = Math.max(vrReg + 0.5, getCon(conPtr, conCount, 3, 5.0));
    const vrMin = Math.min(vrReg - 0.5, getCon(conPtr, conCount, 4, -4.0));
    const ke = getCon(conPtr, conCount, 5, 1.0);
    const te = Math.max(0.02, getCon(conPtr, conCount, 6, 0.8));
    const kf = getCon(conPtr, conCount, 9, 0.03);
    const tf = Math.max(0.05, getCon(conPtr, conCount, 10, 1.0));
    const e1 = getCon(conPtr, conCount, 10, 2.8);
    const se1 = getCon(conPtr, conCount, 11, 0.1);
    const e2 = getCon(conPtr, conCount, 12, 3.8);
    const se2 = getCon(conPtr, conCount, 13, 0.35);

    const vf = kf * ve - xWash;
    const vErr = vref0 - vtSense + vsPss - vf;
    setDState(slotPtr, 1, 0.0);
    setDState(slotPtr, 2, nonWindupLagDeriv(vrReg, vErr, ka, ta, vrMin, vrMax));
    const sat = evalQuadraticSat(ve, e1, se1, e2, se2);
    const dVe = (vrReg - (ke + sat) * ve) / te;
    setDState(slotPtr, 3, dVe);
    setDState(slotPtr, 4, (kf * ve - xWash) / tf);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 2, clamp(ve, vrMin, vrMax));
    return;
  }

  if (archetypeId == 13) {
    // IEEE AC (ESAC1A..8B): AVR + AC exciter with Se(Ve), Kd*Ifd demagnetization, and F_EX rectifier bridge
    const ka = Math.max(1.0, getCon(conPtr, conCount, 3, 200.0));
    const ta = Math.max(0.01, getCon(conPtr, conCount, 4, 0.04));
    const vrMax = Math.max(vrReg + 0.5, getCon(conPtr, conCount, 5, 5.0));
    const vrMin = Math.min(vrReg - 0.5, getCon(conPtr, conCount, 6, -4.0));
    const ke = getCon(conPtr, conCount, 7, 1.0);
    const te = Math.max(0.02, getCon(conPtr, conCount, 8, 0.8));
    const kf = getCon(conPtr, conCount, 9, 0.03);
    const tf = Math.max(0.05, getCon(conPtr, conCount, 10, 1.0));
    const kc = Math.max(0.0, getCon(conPtr, conCount, 11, 0.2));
    const kd = Math.max(0.0, getCon(conPtr, conCount, 12, 0.38));
    const e1 = getCon(conPtr, conCount, 13, 3.1);
    const se1 = getCon(conPtr, conCount, 14, 0.03);
    const e2 = getCon(conPtr, conCount, 15, 4.18);
    const se2 = getCon(conPtr, conCount, 16, 0.1);

    const vf = kf * ve - xWash;
    const vErr = vref0 - vtSense + vsPss - vf;
    setDState(slotPtr, 1, 0.0);
    setDState(slotPtr, 2, nonWindupLagDeriv(vrReg, vErr, ka, ta, vrMin, vrMax));
    const sat = evalQuadraticSat(ve, e1, se1, e2, se2);
    const ifdPos = Math.max(0.0, ifdIn);
    const dVe = (vrReg - (ke + sat) * ve - kd * ifdPos) / te;
    setDState(slotPtr, 3, dVe);
    setDState(slotPtr, 4, (kf * ve - xWash) / tf);
    setDState(slotPtr, 5, 0.0);
    const inVal = (kc * ifdPos) / Math.max(0.1, ve);
    const efdOut = ve * evalFex(inVal);
    setIo(slotPtr, 2, clamp(efdOut, vrMin, vrMax));
    return;
  }

  if (archetypeId == 14) {
    // IEEE ST (EXST1 / ESST1A): lead-lag + high-gain AVR + voltage-proportional ceiling (Vt * VRMAX - Kc * Ifd)
    const tc = getCon(conPtr, conCount, 3, 0.0);
    const tb = getCon(conPtr, conCount, 4, 0.0);
    const ka = Math.max(1.0, getCon(conPtr, conCount, 5, 200.0));
    const ta = Math.max(0.01, getCon(conPtr, conCount, 6, 0.04));
    const vrMax = Math.max(efd0 + 0.5, getCon(conPtr, conCount, 7, 5.0));
    const vrMin = Math.min(efd0 - 0.5, getCon(conPtr, conCount, 8, -4.0));
    const kc = Math.max(0.0, getCon(conPtr, conCount, 9, 0.05));
    const vErr = vref0 - vtSense + vsPss;
    setDState(slotPtr, 1, firstOrderLagDeriv(xLl, vErr, 1.0, tb));
    const llOut = leadLagOutput(vErr, xLl, tc, tb);
    const hiCeil = Math.max(efd0 + 0.2, eterm * vrMax - kc * Math.max(0.0, ifdIn));
    const loCeil = Math.min(efd0 - 0.2, eterm * vrMin);
    setDState(slotPtr, 2, nonWindupLagDeriv(vrReg, llOut, ka, ta, loCeil, hiCeil));
    setDState(slotPtr, 3, 0.0);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 2, clamp(vrReg, loCeil, hiCeil));
    return;
  }

  // Archetypes 15 (ST4B PI) & 16 (PID)
  const kp = Math.max(0.5, getCon(conPtr, conCount, 3, 10.0));
  const ki = Math.max(0.1, getCon(conPtr, conCount, 4, 5.0));
  const vrMax = Math.max(efd0 + 0.5, getCon(conPtr, conCount, 5, 5.0));
  const vrMin = Math.min(efd0 - 0.5, getCon(conPtr, conCount, 6, -4.0));
  const vErr = vref0 - vtSense + vsPss;
  setDState(slotPtr, 1, 0.0);
  setDState(slotPtr, 5, nonWindupIntDeriv(xPi, ki * vErr, 1.0, vrMin, vrMax));
  const target = clamp(kp * vErr + xPi, vrMin, vrMax);
  setDState(slotPtr, 2, nonWindupLagDeriv(vrReg, target, 1.0, 0.02, vrMin, vrMax));
  setDState(slotPtr, 3, 0.0);
  setDState(slotPtr, 4, 0.0);
  setIo(slotPtr, 2, clamp(vrReg, vrMin, vrMax));
}
