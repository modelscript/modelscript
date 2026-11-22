// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  OFF_CON,
  clamp,
  deadband,
  firstOrderLagDeriv,
  getCon,
  getIcon,
  getIo,
  getState,
  nonWindupIntDeriv,
  setDState,
  setIo,
  setSlotMeta,
  setState,
} from "./blocks";

/**
 * Initializes WECC / IEC Inverter-Based Resource (IBR) archetypes (`35..40`)
 * in exact flat-start equilibrium.
 *
 * State layout:
 *   0: Ip (active current injection pu)
 *   1: Iq (reactive current injection pu)
 *   2: x_qpi (REEC / REPC reactive/voltage PI integral state)
 *   3: x_ppi (REPC / DER_A active power PI integral state)
 *   4: delta_gfm (REGFM_A1 virtual synchronous machine internal angle rad)
 *   5: omega_gfm (REGFM_A1 virtual rotor speed deviation pu)
 *   24: Vref0 (initial terminal voltage magnitude pu)
 *   25: P0 (initial active power pu)
 *   26: Ip0 (initial active current pu)
 */
export function initIbr(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.1, getIo(slotPtr, 0));
  const p0 = getIo(slotPtr, 3);
  const vr = getIo(slotPtr, 4);
  const vi = getIo(slotPtr, 5);
  const ip0 = clamp(p0 / eterm, -1.3, 1.3);
  const tg = Math.max(0.01, getCon(conPtr, conCount, 0, 0.02));

  setState(slotPtr, 0, ip0);
  setState(slotPtr, 1, 0.0);
  setState(slotPtr, 2, 0.0);
  setState(slotPtr, 3, p0);
  setState(slotPtr, 4, Math.atan2(vi, vr));
  setState(slotPtr, 5, 0.0);
  setState(slotPtr, 24, eterm);
  setState(slotPtr, 25, p0);
  setState(slotPtr, 26, ip0);

  setSlotMeta(slotPtr, 6, tg);
  const cosT = vr / eterm;
  const sinT = vi / eterm;
  setIo(slotPtr, 9, ip0 * cosT);
  setIo(slotPtr, 10, ip0 * sinT);
  return 6;
}

/**
 * Evaluates derivatives and network current injections for IBR archetypes (`35..40`).
 * Implements WECC LVPL low-voltage power logic, `pqflag` active/reactive current priority
 * limiting, and Grid-Forming (GFM) Virtual Synchronous Machine swing dynamics.
 */
export function evalIbrDerivs(archetypeId: i32, slotPtr: usize, iconCount: i32, conCount: i32): void {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.05, getIo(slotPtr, 0));
  const speedDev = getIo(slotPtr, 1);
  const vr = getIo(slotPtr, 4);
  const vi = getIo(slotPtr, 5);

  const ip = getState(slotPtr, 0);
  const iq = getState(slotPtr, 1);
  const xQpi = getState(slotPtr, 2);
  const xPpi = getState(slotPtr, 3);
  const deltaGfm = getState(slotPtr, 4);
  const omegaGfm = getState(slotPtr, 5);
  const vref0 = getState(slotPtr, 24);
  const p0 = getState(slotPtr, 25);

  const tg = Math.max(0.01, getCon(conPtr, conCount, 0, 0.02));
  const iMax = Math.max(0.5, getCon(conPtr, conCount, 12, 1.2));

  // Archetype 39: ibr_regfm_vsm (Grid-Forming Virtual Synchronous Machine — P-f droop + virtual inertia)
  if (archetypeId == 39) {
    const mp = Math.max(0.005, getCon(conPtr, conCount, 0, 0.05));
    const hVirt = Math.max(0.5, getCon(conPtr, conCount, 1, 3.0));
    const dVirt = Math.max(0.5, getCon(conPtr, conCount, 2, 5.0));
    const xVirt = Math.max(0.05, getCon(conPtr, conCount, 3, 0.15));
    const thetaGrid = Math.atan2(vi, vr);
    const eVirt = clamp(vref0 + 0.1 * (vref0 - eterm), 0.7, 1.2);
    const pMeas = p0 + (eVirt * eterm * Math.sin(deltaGfm - thetaGrid)) / xVirt;
    const dOmegaVirt = (p0 - pMeas - (1.0 / mp + dVirt) * omegaGfm) / (2.0 * hVirt);
    setDState(slotPtr, 4, 2.0 * Math.PI * 60.0 * omegaGfm);
    setDState(slotPtr, 5, dOmegaVirt);
    const ipTarget = clamp(pMeas / Math.max(0.2, eterm), -iMax, iMax);
    const iqTarget = clamp(2.0 * (vref0 - eterm), -iMax, iMax);
    setDState(slotPtr, 0, firstOrderLagDeriv(ip, ipTarget, 1.0, tg));
    setDState(slotPtr, 1, firstOrderLagDeriv(iq, iqTarget, 1.0, tg));
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    const cosG = Math.cos(deltaGfm);
    const sinG = Math.sin(deltaGfm);
    setIo(slotPtr, 9, ip * cosG + iq * sinG);
    setIo(slotPtr, 10, ip * sinG - iq * cosG);
    return;
  }

  // Archetypes 35 (REGC), 36 (REEC), 37 (REPC), 38 (DER_A), 40 (IEC generic)
  // Voltage deadband + proportional-integral reactive current support (LVRT)
  const dbv = Math.abs(getCon(conPtr, conCount, 4, 0.05));
  const kqv = Math.max(0.0, getCon(conPtr, conCount, 6, 2.0));
  const vErr = deadband(vref0 - eterm, -dbv, dbv);

  // Plant-level P-f droop for REPC / DER_A
  const droop = Math.max(0.01, getCon(conPtr, conCount, 0, 0.05));
  const pTarget = archetypeId == 37 || archetypeId == 38
    ? clamp(p0 - speedDev / droop, 0.0, 1.2)
    : p0;

  // Low-Voltage Power Logic (LVPL) active current ramp-down during deep faults (V < 0.5 pu)
  const lvplScale = eterm < 0.5 ? clamp((eterm - 0.1) / 0.4, 0.0, 1.0) : 1.0;

  let ipCmd = (pTarget / Math.max(0.25, eterm)) * lvplScale;
  let iqCmd = kqv * vErr + xQpi;

  // Enforce circular current limit `sqrt(Ip^2 + Iq^2) <= Imax` with `pqflag` (ICON[4]: 0=Q-priority, 1=P-priority)
  const pqFlag = getIcon(slotPtr, iconCount, 4, 0);
  if (pqFlag == 1) {
    // P-priority
    ipCmd = clamp(ipCmd, -iMax, iMax);
    const iqMax = Math.sqrt(Math.max(0.0, iMax * iMax - ipCmd * ipCmd));
    iqCmd = clamp(iqCmd, -iqMax, iqMax);
  } else {
    // Q-priority (default for grid-code LVRT)
    iqCmd = clamp(iqCmd, -iMax, iMax);
    const ipMax = Math.sqrt(Math.max(0.0, iMax * iMax - iqCmd * iqCmd));
    ipCmd = clamp(ipCmd, -ipMax, ipMax);
  }

  setDState(slotPtr, 0, firstOrderLagDeriv(ip, ipCmd, 1.0, tg));
  setDState(slotPtr, 1, firstOrderLagDeriv(iq, iqCmd, 1.0, tg));
  setDState(slotPtr, 2, nonWindupIntDeriv(xQpi, 0.5 * vErr, 1.0, -0.5, 0.5));
  setDState(slotPtr, 3, firstOrderLagDeriv(xPpi, pTarget, 1.0, 0.25));
  setDState(slotPtr, 4, 0.0);
  setDState(slotPtr, 5, 0.0);

  const cosT = vr / eterm;
  const sinT = vi / eterm;
  setIo(slotPtr, 9, ip * cosT + iq * sinT);
  setIo(slotPtr, 10, ip * sinT - iq * cosT);
}
