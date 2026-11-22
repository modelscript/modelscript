// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  OFF_CON,
  clamp,
  evalQuadraticSat,
  getCon,
  getIo,
  getState,
  setDState,
  setIo,
  setSlotMeta,
  setState,
} from "./blocks";

/**
 * Initializes generator & rotating machine archetypes (`0..7`) in exact flat-start equilibrium.
 *
 * State layout:
 *   0: delta (rotor angle rad)
 *   1: dOmega (rotor speed deviation rad/s)
 *   2: eqp (E'q transient EMF pu)
 *   3: psikd (subtransient d-axis flux linkage pu)
 *   4: edp (E'd transient EMF pu)
 *   5: psikq / slip (subtransient q-axis flux linkage or induction slip)
 *   24: cached Efd0 steady-state offset for flat-start saturation balance
 *   25: cached Pe0 steady-state electrical power
 */
export function initGenerator(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.1, getIo(slotPtr, 0));
  const efd0 = getIo(slotPtr, 2);
  const pmech0 = getIo(slotPtr, 3);
  const vr = getIo(slotPtr, 4);
  const vi = getIo(slotPtr, 5);
  const theta0 = Math.atan2(vi, vr);

  const xdp = Math.max(0.05, getCon(conPtr, conCount, archetypeId == 0 ? 1 : 8, 0.3));
  const td0p = Math.max(0.05, getCon(conPtr, conCount, 0, 6.0));
  const td0pp = Math.max(0.015, getCon(conPtr, conCount, 1, 0.035));
  const tq0p = Math.max(0.02, getCon(conPtr, conCount, 2, 1.0));
  const tq0pp = Math.max(0.015, getCon(conPtr, conCount, 3, 0.05));

  // Compute exact equilibrium internal angle delta0 so Pe(delta0, eqp0) == pmech0
  const eqp0 = Math.max(0.2, efd0 > 0.1 ? efd0 : eterm);
  const sinArg = clamp((pmech0 * xdp) / Math.max(1e-4, eqp0 * eterm), -0.95, 0.95);
  const delta0 = theta0 + Math.asin(sinArg);

  setState(slotPtr, 0, delta0);
  setState(slotPtr, 1, 0.0);
  setState(slotPtr, 2, eqp0);
  setState(slotPtr, 3, eqp0);
  setState(slotPtr, 4, 0.0);
  setState(slotPtr, 5, archetypeId >= 5 && archetypeId <= 7 ? 0.015 : 0.0);
  setState(slotPtr, 24, efd0);
  setState(slotPtr, 25, pmech0);
  setState(slotPtr, 26, eterm);

  const nStates: i32 = archetypeId == 0 ? 2 : archetypeId == 1 ? 3 : 6;
  const tMin = archetypeId >= 2 && archetypeId <= 4 ? Math.min(td0pp, tq0pp) : Math.min(td0p, tq0p);
  setSlotMeta(slotPtr, nStates, tMin);
  setIo(slotPtr, 7, pmech0);
  setIo(slotPtr, 8, efd0);
  const er0 = eqp0 * Math.cos(delta0);
  const ei0 = eqp0 * Math.sin(delta0);
  setIo(slotPtr, 9, ei0 / xdp);
  setIo(slotPtr, 10, -er0 / xdp);
  return nStates;
}

/**
 * Evaluates derivatives for generator & induction machine archetypes (`0..7`).
 * Includes IEEE quadratic saturation (`S10`, `S12`), `GENTPJ` current saturation (`Kis`),
 * and Park d/q Norton current injections (`IO[9]` = `Ir`, `IO[10]` = `Ii`).
 */
export function evalGeneratorDerivs(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.05, getIo(slotPtr, 0));
  const speedDev = getIo(slotPtr, 1);
  const efdIn = getIo(slotPtr, 2);
  const pmechIn = getIo(slotPtr, 3);
  const vr = getIo(slotPtr, 4);
  const vi = getIo(slotPtr, 5);
  const theta = Math.atan2(vi, vr);

  const H = Math.max(0.2, getCon(conPtr, conCount, archetypeId == 0 ? 0 : 4, 4.0));
  const D = Math.max(0.0, getCon(conPtr, conCount, archetypeId == 0 ? 1 : 5, 1.0));
  const xd = Math.max(0.2, getCon(conPtr, conCount, 6, 1.8));
  const xq = Math.max(0.2, getCon(conPtr, conCount, 7, 1.7));
  const xdp = Math.max(0.05, getCon(conPtr, conCount, archetypeId == 0 ? 1 : 8, 0.3));
  const xqp = Math.max(0.05, getCon(conPtr, conCount, 9, 0.55));
  const td0p = Math.max(0.05, getCon(conPtr, conCount, 0, 6.0));
  const td0pp = Math.max(0.015, getCon(conPtr, conCount, 1, 0.035));
  const tq0p = Math.max(0.02, getCon(conPtr, conCount, 2, 1.0));
  const tq0pp = Math.max(0.015, getCon(conPtr, conCount, 3, 0.05));
  const s10 = Math.max(0.0, getCon(conPtr, conCount, 12, 0.0));
  const s12 = Math.max(0.0, getCon(conPtr, conCount, 13, 0.0));

  const delta = getState(slotPtr, 0);
  const dOmega = getState(slotPtr, 1);
  const eqp = getState(slotPtr, 2);
  const psikd = getState(slotPtr, 3);
  const edp = getState(slotPtr, 4);
  const psikqOrSlip = getState(slotPtr, 5);

  const pe = (eqp * eterm * Math.sin(delta - theta)) / xdp;
  const omegaBase: f64 = 2.0 * Math.PI * 60.0;

  setDState(slotPtr, 0, dOmega);
  setDState(slotPtr, 1, (omegaBase / (2.0 * H)) * (pmechIn - pe - D * speedDev));

  const sinD = Math.sin(delta);
  const cosD = Math.cos(delta);
  const er = eqp * cosD + edp * sinD;
  const ei = eqp * sinD - edp * cosD;

  if (archetypeId == 0) {
    // sync_classical_2o: constant internal EMF behind X'd
    setDState(slotPtr, 2, 0.0);
    setDState(slotPtr, 3, 0.0);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
    setIo(slotPtr, 7, pe);
    setIo(slotPtr, 8, eqp);
    setIo(slotPtr, 9, ei / xdp);
    setIo(slotPtr, 10, -er / xdp);
    return;
  }

  if (archetypeId >= 5 && archetypeId <= 7) {
    // induction_machine_4o / wind_ind_gen_4o / wind_type3_dfag
    const pe0 = getState(slotPtr, 25);
    const v0 = Math.max(0.1, getState(slotPtr, 26));
    const vNorm = eterm / v0;
    const slipEq: f64 = 0.015;
    const slip = clamp(psikqOrSlip, -0.5, 0.95);
    const teInd = pe0 * (slip / slipEq) * (vNorm * vNorm);
    const dSlip = (pmechIn - teInd) / (2.0 * H);
    setDState(slotPtr, 2, (getState(slotPtr, 24) - eqp) / td0p);
    setDState(slotPtr, 3, 0.0);
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, dSlip);
    setIo(slotPtr, 7, teInd);
    setIo(slotPtr, 8, eqp);
    const iMag = teInd / Math.max(0.1, eterm);
    setIo(slotPtr, 9, (iMag * vr) / eterm);
    setIo(slotPtr, 10, (iMag * vi) / eterm);
    return;
  }

  // Transient 3rd-order (1), subtransient round 6th-order (2), salient 5th-order (3), GENTPJ 6th-order (4)
  const efd0 = getState(slotPtr, 24);
  const satCur = evalQuadraticSat(eqp, 1.0, s10, 1.2, s12);
  const sat0 = evalQuadraticSat(efd0, 1.0, s10, 1.2, s12);
  const kis = archetypeId == 4 ? Math.max(0.0, getCon(conPtr, conCount, 14, 0.05)) : 0.0;
  const iMagDev = Math.abs((eqp - efd0) / xdp);
  const satDelta = (satCur - sat0) * (xd - xdp) + kis * iMagDev;

  const ifd = eqp + satDelta;
  setDState(slotPtr, 2, (efdIn - ifd) / td0p);

  if (archetypeId >= 2) {
    setDState(slotPtr, 3, (eqp - psikd) / td0pp);
  } else {
    setDState(slotPtr, 3, 0.0);
  }

  if (archetypeId == 2 || archetypeId == 4) {
    // Round-rotor q-axis transient & subtransient damper dynamics
    const xqRatio = Math.max(0.0, xq - xqp);
    setDState(slotPtr, 4, (-edp - xqRatio * 0.0) / tq0p);
    setDState(slotPtr, 5, (edp - psikqOrSlip) / tq0pp);
  } else if (archetypeId == 3) {
    // Salient-pole (GENSAL/GENSAE): no E'd state, q-axis subtransient damper only
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, (-psikqOrSlip) / tq0pp);
  } else {
    setDState(slotPtr, 4, 0.0);
    setDState(slotPtr, 5, 0.0);
  }

  setIo(slotPtr, 7, pe);
  setIo(slotPtr, 8, ifd);
  setIo(slotPtr, 9, ei / xdp);
  setIo(slotPtr, 10, -er / xdp);
}
