// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  OFF_CON,
  clamp,
  firstOrderLagDeriv,
  getCon,
  getIo,
  getState,
  nonWindupIntDeriv,
  nonWindupLagDeriv,
  setDState,
  setIo,
  setSlotMeta,
  setState,
} from "./blocks";

/**
 * Initializes FACTS, HVDC, Relay, and Measurement archetypes (`48..57`)
 * in exact flat-start equilibrium.
 */
export function initFactsHvdcRelay(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  const eterm = Math.max(0.1, getIo(slotPtr, 0));

  // FACTS / HVDC (48..52)
  if (archetypeId >= 48 && archetypeId <= 52) {
    setState(slotPtr, 0, 0.0); // Bsvc / Iq_stat / Xtcsc / Idc_dev
    setState(slotPtr, 1, 1.0); // Vdc (HVDC)
    setState(slotPtr, 2, eterm); // filtered Vterm
    setState(slotPtr, 24, eterm); // Vref0
    setSlotMeta(slotPtr, 3, 0.03);
    setIo(slotPtr, 11, 0.0);
    return 3;
  }

  // Relays & Measurements (54..57)
  setState(slotPtr, 0, 0.0);  // pickup timer
  setState(slotPtr, 1, 1.0);  // tripMult (1.0 = closed, 0.0 = tripped)
  setState(slotPtr, 2, 60.0); // filtered bus frequency Hz
  setState(slotPtr, 24, eterm);
  setSlotMeta(slotPtr, 3, 0.02);
  setIo(slotPtr, 12, 1.0);
  setIo(slotPtr, 14, 60.0);
  return 3;
}

/**
 * Evaluates derivatives and outputs for FACTS (`48..50`), HVDC (`51..52`),
 * Protection Relays (`54..56`), and Bus Frequency Measurement (`57`).
 */
export function evalFactsHvdcRelayDerivs(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.05, getIo(slotPtr, 0));
  const speedDev = getIo(slotPtr, 1);

  // FACTS: SVC (48), STATCOM (49), TCSC (50)
  if (archetypeId >= 48 && archetypeId <= 50) {
    const vref0 = getState(slotPtr, 24);
    const x1 = getState(slotPtr, 0);
    const vFilt = getState(slotPtr, 2);
    const k = Math.max(1.0, getCon(conPtr, conCount, 1, 20.0));
    const tReg = Math.max(0.02, getCon(conPtr, conCount, 2, 0.05));
    const bMax = Math.max(0.2, getCon(conPtr, conCount, 3, 1.5));
    const bMin = Math.min(-0.2, getCon(conPtr, conCount, 4, -1.0));
    setDState(slotPtr, 2, firstOrderLagDeriv(vFilt, eterm, 1.0, 0.02));
    const target = clamp(k * (vref0 - vFilt), bMin, bMax);
    setDState(slotPtr, 0, nonWindupLagDeriv(x1, target, 1.0, tReg, bMin, bMax));
    setDState(slotPtr, 1, 0.0);
    // STATCOM injects Q = Iq * V (linear in V); SVC injects Q = B * V^2 (quadratic in V)
    const qInj = archetypeId == 49 ? x1 * eterm : x1 * eterm * eterm;
    setIo(slotPtr, 11, qInj);
    return;
  }

  // HVDC: LCC 2-Terminal (51) with VDCOL & VSC 2-Terminal (52)
  if (archetypeId == 51 || archetypeId == 52) {
    const vref0 = getState(slotPtr, 24);
    const x1 = getState(slotPtr, 0);
    const vdc = getState(slotPtr, 1);
    const vFilt = getState(slotPtr, 2);
    setDState(slotPtr, 2, firstOrderLagDeriv(vFilt, eterm, 1.0, 0.02));
    // VDCOL (Voltage-Dependent Current Order Limiter) for LCC HVDC
    const vdcolScale = archetypeId == 51 && vFilt < 0.75 ? clamp((vFilt - 0.35) / 0.4, 0.1, 1.0) : 1.0;
    const k = Math.max(1.0, getCon(conPtr, conCount, 1, 10.0));
    const target = clamp(k * (vref0 - vFilt) * vdcolScale, -2.0, 2.0);
    setDState(slotPtr, 0, nonWindupLagDeriv(x1, target, 1.0, 0.03, -2.0, 2.0));
    setDState(slotPtr, 1, (1.0 - vdc) / 0.1);
    setIo(slotPtr, 11, x1 * eterm);
    return;
  }

  // Archetype 57: meas_bus_freq (BUSFRQ transducer)
  if (archetypeId == 57) {
    const tf = Math.max(0.01, getCon(conPtr, conCount, 0, 0.04));
    const fMeas = getState(slotPtr, 2);
    const fActual = 60.0 * (1.0 + speedDev);
    setDState(slotPtr, 0, 0.0);
    setDState(slotPtr, 1, 0.0);
    setDState(slotPtr, 2, (fActual - fMeas) / tf);
    setIo(slotPtr, 14, fMeas);
    setIo(slotPtr, 12, 1.0);
    return;
  }

  // Protection Relays: UFLS/UVLS (54), Generator Trip (55), Branch Distance Mho Relay (56)
  const timer = getState(slotPtr, 0);
  const tripMult = getState(slotPtr, 1);
  const fHz = 60.0 * (1.0 + speedDev);
  const tDelay = Math.max(0.02, getCon(conPtr, conCount, 2, 0.25));

  let pickup: bool = false;
  if (archetypeId == 54) {
    const rawF = getCon(conPtr, conCount, 0, 59.3);
    const rawV = getCon(conPtr, conCount, 1, 0.85);
    const fTrip = rawF > 30.0 && rawF < 59.95 ? rawF : 59.3;
    const vTrip = rawV > 0.1 && rawV < 0.95 ? rawV : 0.85;
    pickup = fHz < fTrip || eterm < vTrip;
  } else if (archetypeId == 55) {
    const rawLo = getCon(conPtr, conCount, 0, 57.5);
    const rawHi = getCon(conPtr, conCount, 1, 61.5);
    const fLo = rawLo > 30.0 && rawLo < 59.9 ? rawLo : 57.5;
    const fHi = rawHi > 60.1 && rawHi < 70.0 ? rawHi : 61.5;
    pickup = fHz < fLo || fHz > fHi || eterm < 0.7;
  } else {
    // Archetype 56: relay_branch_dist (ANSI 21 Mho distance circle: |Z_app| < Z_reach)
    const zReach = Math.max(0.05, getCon(conPtr, conCount, 0, 0.5));
    const pFlow = Math.max(0.1, Math.abs(getIo(slotPtr, 3)));
    const zApp = (eterm * eterm) / pFlow;
    pickup = zApp < zReach && eterm < 0.75;
  }

  const dTimer = pickup ? 1.0 : -0.5 * timer;
  setDState(slotPtr, 0, nonWindupIntDeriv(timer, dTimer, 1.0, 0.0, tDelay * 2.0));
  setDState(slotPtr, 1, 0.0);
  setDState(slotPtr, 2, (fHz - getState(slotPtr, 2)) / 0.04);

  if (timer >= tDelay && tripMult > 0.5) {
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 12, 0.0);
  } else {
    setIo(slotPtr, 12, tripMult);
  }
  setIo(slotPtr, 14, getState(slotPtr, 2));
}
