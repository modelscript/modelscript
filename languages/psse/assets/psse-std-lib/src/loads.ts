// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  OFF_CON,
  clamp,
  getCon,
  getIo,
  getState,
  nonWindupIntDeriv,
  setDState,
  setIo,
  setSlotMeta,
  setState,
} from "./blocks";

/**
 * Initializes dynamic and composite load archetypes (`42..46`) in exact flat-start equilibrium.
 *
 * State layout:
 *   0: slip_a (3-phase motor A slip)
 *   1: slip_b (3-phase motor B slip for CMPLDW/CLOD)
 *   2: stall_timer (1-phase A/C compressor FIDVR stall timer)
 *   3: stalled_flag (0.0 = running, 1.0 = stalled)
 *   24: V0 (initial bus voltage pu)
 *   25: slip0 (steady-state equilibrium slip)
 */
export function initLoad(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  const eterm = Math.max(0.2, getIo(slotPtr, 0));
  const slip0: f64 = 0.025;

  setState(slotPtr, 0, slip0);
  setState(slotPtr, 1, slip0);
  setState(slotPtr, 2, 0.0);
  setState(slotPtr, 3, 0.0);
  setState(slotPtr, 24, eterm);
  setState(slotPtr, 25, slip0);

  const nStates: i32 = archetypeId == 42 ? 1 : 4;
  setSlotMeta(slotPtr, nStates, 0.05);
  setIo(slotPtr, 11, 0.0);
  return nStates;
}

/**
 * Evaluates derivatives and reactive susceptance/power response for load archetypes (`42..46`).
 * Models polynomial ZIP+frequency (`42`), induction motor slip (`43`, `44`),
 * 1-phase A/C FIDVR stall (`45`), and WECC `CMPLDW` composite multi-motor + electronic load (`46`).
 */
export function evalLoadDerivs(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.05, getIo(slotPtr, 0));
  const speedDev = getIo(slotPtr, 1);
  const v0 = Math.max(0.2, getState(slotPtr, 24));
  const vNorm = eterm / v0;

  // Archetype 42: load_static_zipf (IEEL / LDFR — algebraic polynomial ZIP + frequency sensitivity)
  if (archetypeId == 42) {
    const a1 = getCon(conPtr, conCount, 0, 0.3);
    const a2 = getCon(conPtr, conCount, 1, 0.3);
    const a3 = getCon(conPtr, conCount, 2, 0.4);
    const ldp = getCon(conPtr, conCount, 3, 1.0);
    const zipMult = (a1 * vNorm * vNorm + a2 * vNorm + a3) * (1.0 + ldp * speedDev);
    setDState(slotPtr, 0, 0.0);
    setIo(slotPtr, 11, (zipMult - 1.0) * 0.25);
    return;
  }

  const slipA = clamp(getState(slotPtr, 0), 0.002, 0.99);
  const slipB = clamp(getState(slotPtr, 1), 0.002, 0.99);
  const stallTimer = getState(slotPtr, 2);
  const stalled = getState(slotPtr, 3);
  const slip0 = getState(slotPtr, 25);

  // Calibrated induction motor torque Te(V, s) such that Te(V0, slip0) == 1.0 exactly (flat-start!)
  const sBreak: f64 = 0.12;
  const normFactor = (1.0 + (slip0 / sBreak) * (slip0 / sBreak)) / (slip0 / sBreak);
  const teA = (vNorm * vNorm * normFactor * (slipA / sBreak)) / (1.0 + (slipA / sBreak) * (slipA / sBreak));
  const hA = archetypeId == 46 ? 0.6 : 1.2;
  setDState(slotPtr, 0, (1.0 - teA) / hA);

  let qDelta: f64 = -0.6 * Math.max(0.0, (slipA - slip0) / (1.0 - slip0)) * eterm * eterm;

  // Archetype 45 (LD1PAC) & Archetype 46 (CMPLDW): 1-phase A/C stall timer + FIDVR inductive draw
  if (archetypeId == 45 || archetypeId == 46) {
    const vStall = clamp(getCon(conPtr, conCount, 11, 0.6), 0.3, 0.85);
    const tStall = Math.max(0.02, getCon(conPtr, conCount, 12, 0.033));
    const teB = (vNorm * vNorm * normFactor * (slipB / sBreak)) / (1.0 + (slipB / sBreak) * (slipB / sBreak));
    setDState(slotPtr, 1, (1.0 - teB) / 1.5);

    if (stalled < 0.5) {
      const dTimer = eterm < vStall ? 1.0 : -0.5 * stallTimer;
      setDState(slotPtr, 2, nonWindupIntDeriv(stallTimer, dTimer, 1.0, 0.0, tStall * 2.0));
      if (stallTimer >= tStall) {
        setState(slotPtr, 3, 1.0);
      }
    } else {
      setDState(slotPtr, 2, 0.0);
      // Stalled compressor draws heavy reactive current (FIDVR)
      qDelta -= 1.8 * eterm * eterm;
    }
    setDState(slotPtr, 3, 0.0);
  } else {
    setDState(slotPtr, 1, 0.0);
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
  }

  setIo(slotPtr, 11, qDelta);
}
