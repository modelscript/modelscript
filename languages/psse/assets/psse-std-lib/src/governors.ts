// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  OFF_CON,
  clamp,
  deadband,
  firstOrderLagDeriv,
  getCon,
  getIo,
  getState,
  nonWindupIntDeriv,
  nonWindupLagDeriv,
  rateLimitedServoDeriv,
  setDState,
  setIo,
  setSlotMeta,
  setState,
} from "./blocks";

/**
 * Initializes governor, turbine, and wind mechanical/pitch archetypes (`20..29`)
 * in exact flat-start equilibrium.
 *
 * State layout:
 *   0: valve / gate position
 *   1: x_hp / steam chest / combustor / water flow q
 *   2: x_rh / reheat / exhaust temp / pitch angle
 *   3: Pm (mechanical power output)
 *   4: x_int (PI / LCFB / PID integral state)
 *   5: theta_tw (2-mass wind shaft twist angle)
 *   24: Pref0 (steady-state power reference)
 */
export function initGovernor(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const conPtr = slotPtr + OFF_CON;
  const pmech0 = getIo(slotPtr, 3);
  const t1 = Math.max(0.02, getCon(conPtr, conCount, 1, 0.3));

  setState(slotPtr, 0, pmech0); // valve / gate
  setState(slotPtr, 1, pmech0); // chest / q / combustor
  setState(slotPtr, 2, pmech0); // reheat / pitch
  setState(slotPtr, 3, pmech0); // Pm
  setState(slotPtr, 4, pmech0); // PI / LCFB integral state
  setState(slotPtr, 5, 0.0);    // 2-mass twist angle
  setState(slotPtr, 24, pmech0);

  setSlotMeta(slotPtr, 6, Math.min(t1, 0.08));
  setIo(slotPtr, 3, pmech0);
  return 6;
}

/**
 * Evaluates derivatives and outputs for governor & wind mechanical archetypes (`20..29`).
 */
export function evalGovernorDerivs(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const conPtr = slotPtr + OFF_CON;
  const speedDev = getIo(slotPtr, 1);
  const pRef0 = getState(slotPtr, 24);
  const valve = getState(slotPtr, 0);
  const x1 = getState(slotPtr, 1);
  const x2 = getState(slotPtr, 2);
  const pm = getState(slotPtr, 3);
  const xInt = getState(slotPtr, 4);
  const twist = getState(slotPtr, 5);

  const r = Math.max(0.005, getCon(conPtr, conCount, 0, 0.05));
  const t1 = Math.max(0.02, getCon(conPtr, conCount, 1, 0.3));
  const pMax = Math.max(pRef0 + 0.1, getCon(conPtr, conCount, 2, 1.1));
  const pMin = Math.min(pRef0 - 0.1, getCon(conPtr, conCount, 3, 0.0));

  // Archetype 20: gov_steam_simple (TGOV1)
  if (archetypeId == 20) {
    const t2 = Math.max(0.0, getCon(conPtr, conCount, 4, 0.5));
    const t3 = Math.max(0.02, getCon(conPtr, conCount, 5, 1.0));
    const dtDamp = Math.max(0.0, getCon(conPtr, conCount, 6, 0.0));
    const targetValve = clamp(pRef0 - speedDev / r, pMin, pMax);
    setDState(slotPtr, 0, nonWindupLagDeriv(valve, targetValve, 1.0, t1, pMin, pMax));
    setDState(slotPtr, 1, firstOrderLagDeriv(x1, valve, 1.0, t3));
    const pmOut = (t2 / t3) * valve + (1.0 - t2 / t3) * x1 - dtDamp * speedDev;
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, (pmOut - pm) / 0.05);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 3, clamp(pmOut, pMin, pMax));
    return;
  }

  // Archetype 21: gov_steam_reheat (IEEEG1 / IEESGO — rate-limited valve + HP/IP/LP reheat stages)
  if (archetypeId == 21) {
    const uo = Math.max(0.05, getCon(conPtr, conCount, 4, 0.2));
    const uc = -Math.max(0.05, Math.abs(getCon(conPtr, conCount, 5, -0.2)));
    const tChest = Math.max(0.05, getCon(conPtr, conCount, 6, 0.3));
    const tReheat = Math.max(0.5, getCon(conPtr, conCount, 7, 7.0));
    const fHp = clamp(getCon(conPtr, conCount, 8, 0.3), 0.1, 0.9);
    const targetValve = clamp(pRef0 - speedDev / r, pMin, pMax);
    setDState(slotPtr, 0, rateLimitedServoDeriv(valve, targetValve, t1, uc, uo, pMin, pMax));
    setDState(slotPtr, 1, firstOrderLagDeriv(x1, valve, 1.0, tChest));
    setDState(slotPtr, 2, firstOrderLagDeriv(x2, x1, 1.0, tReheat));
    const pmOut = fHp * x1 + (1.0 - fHp) * x2;
    setDState(slotPtr, 3, (pmOut - pm) / 0.05);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 3, clamp(pmOut, pMin, pMax));
    return;
  }

  // Archetype 22: gov_lcfb (Load Controller / Frequency Bias LCFB1)
  if (archetypeId == 22) {
    const db = Math.abs(getCon(conPtr, conCount, 1, 0.0006));
    const kp = Math.max(0.1, getCon(conPtr, conCount, 2, 1.0));
    const ki = Math.max(0.05, getCon(conPtr, conCount, 3, 0.2));
    const fErr = -deadband(speedDev, -db, db);
    setDState(slotPtr, 4, nonWindupIntDeriv(xInt, ki * fErr, 1.0, pMin, pMax));
    const pmTarget = clamp(xInt + kp * fErr, pMin, pMax);
    setDState(slotPtr, 0, firstOrderLagDeriv(valve, pmTarget, 1.0, 0.2));
    setDState(slotPtr, 1, 0.0);
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, (valve - pm) / 0.1);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 3, clamp(valve, pMin, pMax));
    return;
  }

  // Archetypes 23 (GAST) & 24 (GGOV1 — gas turbine with exhaust temp ceiling & load limiter)
  if (archetypeId == 23 || archetypeId == 24) {
    const tFuel = Math.max(0.05, getCon(conPtr, conCount, 2, 0.4));
    const tExh = Math.max(0.2, getCon(conPtr, conCount, 3, 3.0));
    const vMax = Math.max(pRef0 + 0.1, getCon(conPtr, conCount, 4, 1.05));
    const vMin = Math.min(pRef0 - 0.1, getCon(conPtr, conCount, 5, 0.0));
    const kt = Math.max(0.5, getCon(conPtr, conCount, 6, 2.0));
    const atLim = Math.max(pRef0 + 0.1, getCon(conPtr, conCount, 7, 1.0));
    const speedGov = clamp(pRef0 - speedDev / r, vMin, vMax);
    const tempLim = atLim + kt * (atLim - x2);
    const fuelCmd = Math.min(speedGov, tempLim);
    setDState(slotPtr, 0, nonWindupLagDeriv(valve, fuelCmd, 1.0, t1, vMin, vMax));
    setDState(slotPtr, 1, firstOrderLagDeriv(x1, valve, 1.0, tFuel));
    setDState(slotPtr, 2, firstOrderLagDeriv(x2, x1, 1.0, tExh));
    setDState(slotPtr, 3, (x1 - pm) / 0.05);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 3, clamp(x1, vMin, vMax));
    return;
  }

  // Archetypes 25 (HYGOV) & 26 (PIDGOV — nonlinear hydro penstock water-hammer dynamics)
  if (archetypeId == 25 || archetypeId == 26) {
    const tw = Math.max(0.1, getCon(conPtr, conCount, 7, 1.0));
    const gMax = Math.max(pRef0 + 0.1, getCon(conPtr, conCount, 5, 1.05));
    const gMin = Math.min(Math.max(0.02, pRef0 - 0.1), getCon(conPtr, conCount, 6, 0.02));
    const velm = Math.max(0.05, getCon(conPtr, conCount, 4, 0.2));
    const targetGate = clamp(pRef0 - speedDev / r, gMin, gMax);
    setDState(slotPtr, 0, rateLimitedServoDeriv(valve, targetGate, t1, -velm, velm, gMin, gMax));
    const gSafe = Math.max(0.05, valve);
    const q = Math.max(0.01, x1);
    const h = (q / gSafe) * (q / gSafe);
    // Exact nonlinear penstock ODE: Tw * dq/dt = 1 - H = 1 - (q/G)^2
    setDState(slotPtr, 1, (1.0 - h) / tw);
    const pmHydro = q * h;
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, (pmHydro - pm) / 0.05);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 3, clamp(pmHydro, 0.0, gMax * 1.2));
    return;
  }

  // Archetype 27: gov_degov (diesel engine governor with combustion delay)
  if (archetypeId == 27) {
    const tAct = Math.max(0.02, getCon(conPtr, conCount, 1, 0.05));
    const tComb = Math.max(0.02, getCon(conPtr, conCount, 2, 0.08));
    const target = clamp(pRef0 - speedDev / r, pMin, pMax);
    setDState(slotPtr, 0, nonWindupLagDeriv(valve, target, 1.0, tAct, pMin, pMax));
    setDState(slotPtr, 1, firstOrderLagDeriv(x1, valve, 1.0, tComb));
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, (x1 - pm) / 0.05);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 3, clamp(x1, pMin, pMax));
    return;
  }

  // Archetype 28: wind_drivetrain_2mass (WTDTA1 two-mass spring-damper shaft)
  if (archetypeId == 28) {
    const kShaft = Math.max(0.1, getCon(conPtr, conCount, 3, 1.5));
    const dShaft = Math.max(0.05, getCon(conPtr, conCount, 4, 1.0));
    setDState(slotPtr, 5, -speedDev);
    const pmShaft = clamp(pRef0 + kShaft * twist - dShaft * speedDev, 0.0, 1.5);
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, 0.0);
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, (pmShaft - pm) / 0.05);
    setDState(slotPtr, 4, 0.0);
    setIo(slotPtr, 3, pmShaft);
    return;
  }

  // Archetype 29: wind_pitch_torque (WTPTA1 / WTTQA1)
  const kpPitch = Math.max(1.0, getCon(conPtr, conCount, 1, 10.0));
  const tPitch = Math.max(0.05, getCon(conPtr, conCount, 4, 0.3));
  const targetPitch = clamp(pRef0 - kpPitch * speedDev, 0.0, 1.2);
  setDState(slotPtr, 0, nonWindupLagDeriv(valve, targetPitch, 1.0, tPitch, 0.0, 1.2));
  setDState(slotPtr, 1, 0.0);
  setDState(slotPtr, 2, 0.0);
  setDState(slotPtr, 3, (valve - pm) / 0.05);
  setDState(slotPtr, 4, 0.0);
  setDState(slotPtr, 5, 0.0);
  setIo(slotPtr, 3, clamp(valve, 0.0, 1.2));
}
