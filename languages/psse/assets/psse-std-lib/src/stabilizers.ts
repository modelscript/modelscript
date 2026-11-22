// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  OFF_CON,
  clamp,
  firstOrderLagDeriv,
  getCon,
  getIo,
  getState,
  leadLagOutput,
  setDState,
  setIo,
  setSlotMeta,
  setState,
} from "./blocks";

/**
 * Initializes Power System Stabilizer archetypes (`30..32`) in exact flat-start equilibrium (`Vs = 0`).
 *
 * State layout:
 *   0: x_w1 (washout 1 state)
 *   1: x_w2 (washout 2 / ramp-tracking state)
 *   2: x_ll1 (lead-lag stage 1 state)
 *   3: x_ll2 (lead-lag stage 2 state)
 *   4: x_lf (PSS4B low-frequency band filter)
 *   5: x_if (PSS4B intermediate-frequency band filter)
 *   6: x_hf (PSS4B high-frequency band filter)
 *   24: Pe0 (steady-state electrical power for dual-input PSS2A/2B)
 */
export function initStabilizer(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  const pe0 = getIo(slotPtr, 7) != 0.0 ? getIo(slotPtr, 7) : getIo(slotPtr, 3);
  for (let i: i32 = 0; i < 7; i++) {
    setState(slotPtr, i, 0.0);
  }
  setState(slotPtr, 1, pe0); // initialize Pe washout state to Pe0 so Pe_wash = 0 at t=0
  setState(slotPtr, 24, pe0);
  const nStates: i32 = archetypeId == 32 ? 7 : 4;
  setSlotMeta(slotPtr, nStates, 0.03);
  setIo(slotPtr, 6, 0.0);
  return nStates;
}

/**
 * Evaluates derivatives and outputs for PSS archetypes (`30..32`).
 */
export function evalStabilizerDerivs(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const conPtr = slotPtr + OFF_CON;
  const speedDev = getIo(slotPtr, 1);
  const peIn = getIo(slotPtr, 7) != 0.0 ? getIo(slotPtr, 7) : getIo(slotPtr, 3);

  const xw1 = getState(slotPtr, 0);
  const xw2 = getState(slotPtr, 1);
  const xll1 = getState(slotPtr, 2);
  const xll2 = getState(slotPtr, 3);

  // Archetype 32: pss_multiband_4b (IEEE PSS4B 3-band LF/IF/HF parallel filter bank)
  if (archetypeId == 32) {
    const kL = getCon(conPtr, conCount, 2, 5.0);
    const kI = getCon(conPtr, conCount, 3, 25.0);
    const kH = getCon(conPtr, conCount, 4, 15.0);
    const vsMax = Math.max(0.02, getCon(conPtr, conCount, 12, 0.1));
    const vsMin = Math.min(-0.02, getCon(conPtr, conCount, 13, -0.1));
    const xLf = getState(slotPtr, 4);
    const xIf = getState(slotPtr, 5);
    const xHf = getState(slotPtr, 6);

    // 3 band-pass washout-lag filters (LF ~0.05 Hz, IF ~0.8 Hz, HF ~10 Hz)
    setDState(slotPtr, 4, firstOrderLagDeriv(xLf, speedDev, 1.0, 3.0));
    setDState(slotPtr, 5, firstOrderLagDeriv(xIf, speedDev, 1.0, 0.2));
    setDState(slotPtr, 6, firstOrderLagDeriv(xHf, speedDev, 1.0, 0.02));
    const yL = clamp(kL * (speedDev - xLf), -0.075, 0.075);
    const yI = clamp(kI * (speedDev - xIf), -0.15, 0.15);
    const yH = clamp(kH * (speedDev - xHf), -0.15, 0.15);
    const vs = clamp(yL + yI + yH, vsMin, vsMax);
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, 0.0);
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    setIo(slotPtr, 6, vs);
    return;
  }

  // Archetype 30 (IEEEST / STAB1) & Archetype 31 (PSS2A / PSS2B dual-input ramp-tracking)
  const tw1 = Math.max(0.1, getCon(conPtr, conCount, 0, 5.0));
  const tw2 = Math.max(0.1, getCon(conPtr, conCount, 1, 5.0));
  const t1 = Math.max(0.0, getCon(conPtr, conCount, 4, 0.25));
  const t2 = Math.max(0.01, getCon(conPtr, conCount, 5, 0.04));
  const t3 = Math.max(0.0, getCon(conPtr, conCount, 6, 0.15));
  const t4 = Math.max(0.01, getCon(conPtr, conCount, 7, 0.03));
  const ks = getCon(conPtr, conCount, archetypeId == 30 ? 8 : 10, 10.0);
  const vsMax = Math.max(0.02, getCon(conPtr, conCount, 14, 0.1));
  const vsMin = Math.min(-0.02, getCon(conPtr, conCount, 15, -0.1));

  // Washout 1 on rotor speed deviation
  setDState(slotPtr, 0, (speedDev - xw1) / tw1);
  let sig = speedDev - xw1;

  if (archetypeId == 31) {
    // Dual-input PSS2A/2B: combine speed deviation with washed-out electrical power
    setDState(slotPtr, 1, (peIn - xw2) / tw2);
    const peWash = peIn - xw2;
    sig = sig - 0.1 * peWash;
  } else {
    setDState(slotPtr, 1, 0.0);
  }

  const u1 = ks * sig;
  setDState(slotPtr, 2, firstOrderLagDeriv(xll1, u1, 1.0, t2));
  const y1 = leadLagOutput(u1, xll1, t1, t2);
  setDState(slotPtr, 3, firstOrderLagDeriv(xll2, y1, 1.0, t4));
  const y2 = leadLagOutput(y1, xll2, t3, t4);

  setIo(slotPtr, 6, clamp(y2, vsMin, vsMax));
}
