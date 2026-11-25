// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Closed-Loop Protection Relays & Saturable CT Modeling
 *
 * Implements:
 * - Nonlinear saturable CT flux integration (backward Euler + guarded Newton-bisection)
 * - Sliding DFT fundamental & 2nd-harmonic phasor extraction
 * - Memory-polarized voltage & frequency/ROCOF estimation
 * - ANSI 21 (Mho/Quadrilateral), 50, 51, 67 (directional), 87T/87L (2nd-harmonic restraint),
 *   27, 59, and 81U/81O/81R protection elements with closed-loop breaker trip actuation
 */

import type { EmtNetlist } from "../types.js";
import type { BusInfo, RelayRuntimeState, SwitchState, SyncGenState } from "./emt-solver-types.js";

export interface EmtProtectionRelayContext {
  readonly omega: number;
  readonly timeStepSec: number;
  readonly busList: readonly BusInfo[];
  readonly busIdxMap: ReadonlyMap<string, number>;
  readonly branchPhaseCurrents: ReadonlyMap<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly vaStep: Float64Array;
  readonly vbStep: Float64Array;
  readonly vcStep: Float64Array;
  readonly syncGenerators: readonly SyncGenState[];
  readonly switchStates: readonly SwitchState[];
}

/**
 * Initializes closed-loop protection relay runtime states and control signal trajectory buffers.
 */
export function initProtectionRelayStates(
  netlist: EmtNetlist,
  busList: readonly BusInfo[],
  busIdxMap: ReadonlyMap<string, number>,
  controlSignals: Map<string, Float64Array>,
  nSteps: number,
  omega: number,
  timeStepSec: number,
): RelayRuntimeState[] {
  const relayFreqHz = omega / (2 * Math.PI);
  const relayNCyc = Math.max(8, Math.round(1.0 / (Math.max(1.0, relayFreqHz) * Math.max(1e-7, timeStepSec))));
  return (netlist.protectionRelays ?? []).map((relay) => {
    const tripTraj = new Float64Array(nSteps);
    const zAppTraj = new Float64Array(nSteps);
    controlSignals.set(`${relay.id}_trip`, tripTraj);
    controlSignals.set(`${relay.id}_zAppOhm`, zAppTraj);
    return {
      relay,
      timerSec: 0.0,
      tripped: false,
      tripTraj,
      zAppTraj,
      nCyc: relayNCyc,
      dftIdx: 0,
      sampleCount: 0,
      vaBuf: new Float64Array(relayNCyc),
      iaBuf: new Float64Array(relayNCyc),
      secIaBuf: new Float64Array(relayNCyc),
      cos1Buf: new Float64Array(relayNCyc),
      sin1Buf: new Float64Array(relayNCyc),
      cos2Buf: new Float64Array(relayNCyc),
      sin2Buf: new Float64Array(relayNCyc),
      prevVa: 0.0,
      prevIa: 0.0,
      prevSecIa: 0.0,
      vMemRe: busList[busIdxMap.get(relay.monitoredBus) ?? 0]?.vPeak ?? 0.0,
      vMemIm: 0.0,
      ctFluxVs: 0.0,
      prevZAngleRad: 0.0,
      freqEstHz: relayFreqHz,
      smoothRocofHzPerSec: 0.0,
    };
  });
}

/**
 * Evaluates all closed-loop protection relays at step `k` and commands target circuit breakers to open on trip.
 */
export function stepProtectionRelays(
  relayRuntimeStates: readonly RelayRuntimeState[],
  ctx: EmtProtectionRelayContext,
  t: number,
  k: number,
): void {
  const {
    omega,
    timeStepSec,
    busList,
    busIdxMap,
    branchPhaseCurrents,
    vaStep,
    vbStep,
    vcStep,
    syncGenerators,
    switchStates,
  } = ctx;
  const relayFreqHz = omega / (2 * Math.PI);

  for (const rs of relayRuntimeStates) {
    const { relay } = rs;
    const bIdx = busIdxMap.get(relay.monitoredBus) ?? 0;
    const va = vaStep[bIdx] ?? 0.0;
    const vb = vbStep[bIdx] ?? 0.0;
    const vc = vcStep[bIdx] ?? 0.0;
    const vPeakInst = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
    const vNomPeak = busList[bIdx]?.vPeak || 230e3;

    const brCur =
      (relay.monitoredBranch ? branchPhaseCurrents.get(relay.monitoredBranch) : undefined) ??
      (relay.tripBreakerId ? branchPhaseCurrents.get(relay.tripBreakerId) : undefined) ??
      branchPhaseCurrents.values().next().value;
    const iaBr = brCur ? brCur.a[k]! : 0.0;
    const ibBr = brCur ? brCur.b[k]! : 0.0;
    const icBr = brCur ? brCur.c[k]! : 0.0;

    // Optional saturable CT nonlinear core flux integration (backward Euler + guarded Newton-bisection)
    let iaMeas = iaBr;
    if (relay.ctKneeFluxVs !== undefined && relay.ctKneeFluxVs > 0.0) {
      const psiK = relay.ctKneeFluxVs;
      const rb = Math.max(0.2, relay.ctBurdenOhm ?? 2.0);
      const dtRb = Math.max(1e-9, timeStepSec * rb);
      const iKexc = Math.max(2.0, 0.01 * (relay.pickupCurrentA ?? 400.0));
      const psiOld = rs.ctFluxVs;
      const evalCtRes = (psi: number): number => {
        const u = psi / psiK;
        const u6 = u * u * u * u * u * u;
        const im = iKexc * (u + u * u6);
        return psi - psiOld - dtRb * (iaBr - im);
      };
      const evalCtDeriv = (psi: number): number => {
        const u = psi / psiK;
        const u6 = u * u * u * u * u * u;
        return 1.0 + ((dtRb * iKexc) / psiK) * (1.0 + 7.0 * u6);
      };
      const psiUnclamped = psiOld + dtRb * iaBr;
      let lo = Math.min(psiOld, psiUnclamped, -2.5 * psiK);
      let hi = Math.max(psiOld, psiUnclamped, 2.5 * psiK);
      for (let ex = 0; ex < 4 && evalCtRes(lo) > 0; ex++) lo *= 2.0;
      for (let ex = 0; ex < 4 && evalCtRes(hi) < 0; ex++) hi *= 2.0;
      let psi = Math.min(hi, Math.max(lo, psiOld));
      for (let it = 0; it < 8; it++) {
        const fVal = evalCtRes(psi);
        if (Math.abs(fVal) < 1e-11 * Math.max(1.0, psiK)) break;
        if (fVal < 0) lo = Math.max(lo, psi);
        else hi = Math.min(hi, psi);
        const cand = psi - fVal / evalCtDeriv(psi);
        psi = cand > lo && cand < hi ? cand : 0.5 * (lo + hi);
      }
      rs.ctFluxVs = psi;
      iaMeas = (psi - psiOld) / dtRb;
    }

    const secCur = relay.secondaryBranch ? branchPhaseCurrents.get(relay.secondaryBranch) : undefined;
    const secIa = secCur ? secCur.a[k]! : 0.0;

    // Sliding DFT ring buffer update
    const theta1 = omega * t;
    const cos1 = Math.cos(theta1);
    const sin1 = Math.sin(theta1);
    const cos2 = 2.0 * cos1 * cos1 - 1.0;
    const sin2 = 2.0 * sin1 * cos1;

    rs.vaBuf[rs.dftIdx] = va;
    rs.iaBuf[rs.dftIdx] = iaMeas;
    rs.secIaBuf[rs.dftIdx] = secIa;
    rs.cos1Buf[rs.dftIdx] = cos1;
    rs.sin1Buf[rs.dftIdx] = sin1;
    rs.cos2Buf[rs.dftIdx] = cos2;
    rs.sin2Buf[rs.dftIdx] = sin2;
    rs.dftIdx = (rs.dftIdx + 1) % rs.nCyc;
    rs.sampleCount++;

    const nHalf = Math.max(4, rs.nCyc >> 1);
    let v1Re = 0.0;
    let v1Im = 0.0;
    let i1Re = 0.0;
    let i1Im = 0.0;
    let i1H2Mag = 0.0;
    let i2Re = 0.0;
    let i2Im = 0.0;

    if (rs.sampleCount >= nHalf) {
      const winLen = rs.sampleCount >= rs.nCyc ? rs.nCyc : nHalf;
      let sumVRe = 0.0;
      let sumVIm = 0.0;
      let sumI1Re = 0.0;
      let sumI1Im = 0.0;
      let sumI1H2Re = 0.0;
      let sumI1H2Im = 0.0;
      let sumI2Re = 0.0;
      let sumI2Im = 0.0;
      for (let j = 0; j < winLen; j++) {
        const idx = (rs.dftIdx - 1 - j + rs.nCyc) % rs.nCyc;
        const c1 = rs.cos1Buf[idx]!;
        const s1 = rs.sin1Buf[idx]!;
        const vx = rs.vaBuf[idx]!;
        const ix = rs.iaBuf[idx]!;
        sumVRe += vx * c1;
        sumVIm -= vx * s1;
        sumI1Re += ix * c1;
        sumI1Im -= ix * s1;
        if (secCur) {
          const sx = rs.secIaBuf[idx]!;
          sumI2Re += sx * c1;
          sumI2Im -= sx * s1;
        }
        if (rs.sampleCount >= rs.nCyc) {
          const c2 = rs.cos2Buf[idx]!;
          const s2 = rs.sin2Buf[idx]!;
          sumI1H2Re += ix * c2;
          sumI1H2Im -= ix * s2;
        }
      }
      const scale = 2.0 / winLen;
      v1Re = sumVRe * scale;
      v1Im = sumVIm * scale;
      i1Re = sumI1Re * scale;
      i1Im = sumI1Im * scale;
      i2Re = sumI2Re * scale;
      i2Im = sumI2Im * scale;
      if (rs.sampleCount >= rs.nCyc) {
        i1H2Mag = Math.hypot(sumI1H2Re * scale, sumI1H2Im * scale);
      }
    } else {
      // Sub-half-cycle orthogonal derivative phasor estimate
      const invOmegaDt = 1.0 / Math.max(1e-9, omega * timeStepSec);
      const dv = k > 0 ? (va - rs.prevVa) * invOmegaDt : 0.0;
      const di = k > 0 ? (iaMeas - rs.prevIa) * invOmegaDt : 0.0;
      v1Re = va * cos1 - dv * sin1;
      v1Im = -va * sin1 - dv * cos1;
      i1Re = iaMeas * cos1 - di * sin1;
      i1Im = -iaMeas * sin1 - di * cos1;
      if (secCur) {
        const ds = k > 0 ? (secIa - rs.prevSecIa) * invOmegaDt : 0.0;
        i2Re = secIa * cos1 - ds * sin1;
        i2Im = -secIa * sin1 - ds * cos1;
      }
    }
    rs.prevVa = va;
    rs.prevIa = iaMeas;
    rs.prevSecIa = secIa;

    const v1Mag = Math.hypot(v1Re, v1Im);
    const i1Mag = Math.hypot(i1Re, i1Im);
    const iPeak3Ph = Math.sqrt((2.0 / 3.0) * (iaMeas * iaMeas + ibBr * ibBr + icBr * icBr));
    const effV = rs.sampleCount >= nHalf ? v1Mag : vPeakInst;
    const effI = rs.sampleCount >= nHalf ? i1Mag : Math.max(i1Mag, iPeak3Ph);

    // Update memory-polarized voltage phasor while healthy voltage exists
    if (v1Mag > 0.15 * vNomPeak) {
      const alphaMem = Math.min(0.25, timeStepSec / 0.08);
      rs.vMemRe += alphaMem * (v1Re - rs.vMemRe);
      rs.vMemIm += alphaMem * (v1Im - rs.vMemIm);
    }
    const vPolRe = 0.75 * v1Re + 0.25 * rs.vMemRe;
    const vPolIm = 0.75 * v1Im + 0.25 * rs.vMemIm;

    // Track DFT frequency and ROCOF from voltage phasor rotation
    if (v1Mag > 0.05 * vNomPeak && rs.sampleCount >= nHalf) {
      const vAng = Math.atan2(v1Im, v1Re);
      if (rs.sampleCount > nHalf) {
        let dAng = vAng - rs.prevZAngleRad;
        while (dAng > Math.PI) dAng -= 2.0 * Math.PI;
        while (dAng < -Math.PI) dAng += 2.0 * Math.PI;
        const instFreqHz = relayFreqHz + dAng / (2.0 * Math.PI * Math.max(1e-9, timeStepSec));
        const alphaF = Math.min(0.2, timeStepSec / 0.015);
        const prevSmoothF = rs.freqEstHz;
        rs.freqEstHz += alphaF * (instFreqHz - rs.freqEstHz);
        const instRocof = (rs.freqEstHz - prevSmoothF) / Math.max(1e-9, timeStepSec);
        const alphaR = Math.min(0.15, timeStepSec / 0.03);
        rs.smoothRocofHzPerSec += alphaR * (instRocof - rs.smoothRocofHzPerSec);
      }
      rs.prevZAngleRad = vAng;
    }

    // Apparent complex impedance Z_app = V1 / I1
    const iDenomSq = i1Re * i1Re + i1Im * i1Im;
    const zAppRe = iDenomSq > 1e-4 ? (v1Re * i1Re + v1Im * i1Im) / iDenomSq : 1e6;
    const zAppIm = iDenomSq > 1e-4 ? (v1Im * i1Re - v1Re * i1Im) / iDenomSq : 0.0;
    const zAppOhm = effV / Math.max(effI, 1e-3);
    rs.zAppTraj[k] = zAppOhm;

    if (!rs.tripped) {
      let pickup = false;
      let tripDelaySec = 0.0;
      if (relay.ansiCode === "21") {
        const z1 = relay.zone1ReachOhm ?? 15.0;
        const z2 = relay.zone2ReachOhm ?? 1.2 * z1;
        const z3 = relay.zone3ReachOhm ?? 1.8 * z1;
        const thetaRad = ((relay.lineAngleDeg ?? 75.0) * Math.PI) / 180.0;
        const cTh = Math.cos(thetaRad);
        const sTh = Math.sin(thetaRad);
        const inZone = (reach: number): boolean => {
          if (effI <= 5.0) return false;
          if (relay.characteristic === "quadrilateral") {
            return (
              zAppIm >= -0.05 * reach &&
              zAppIm <= reach * sTh &&
              zAppRe >= -0.1 * reach &&
              zAppRe <= reach * (Math.abs(cTh) + 0.5)
            );
          }
          // Memory-polarized Mho comparator: Re((Z_reach * I1 - V1) * conj(V_pol)) >= 0
          const zrRe = reach * cTh;
          const zrIm = reach * sTh;
          const opRe = zrRe * i1Re - zrIm * i1Im - v1Re;
          const opIm = zrRe * i1Im + zrIm * i1Re - v1Im;
          const vPolMagSq = vPolRe * vPolRe + vPolIm * vPolIm;
          if (vPolMagSq > 1.0 && rs.sampleCount >= nHalf) {
            return opRe * vPolRe + opIm * vPolIm >= 0.0;
          }
          return zAppOhm <= reach;
        };
        if (inZone(z1)) {
          pickup = true;
          tripDelaySec = 0.0;
        } else if (inZone(z2)) {
          pickup = true;
          tripDelaySec = 0.25;
        } else if (inZone(z3)) {
          pickup = true;
          tripDelaySec = 0.6;
        }
      } else if (relay.ansiCode === "50") {
        pickup = effI >= (relay.pickupCurrentA ?? 500.0);
        tripDelaySec = 0.0;
      } else if (relay.ansiCode === "51" || relay.ansiCode === "67") {
        const iPick = relay.pickupCurrentA ?? 200.0;
        let forwardOk = true;
        if (relay.ansiCode === "67" && rs.sampleCount >= nHalf) {
          const mtaRad = ((relay.mtaDeg ?? -(relay.lineAngleDeg ?? 60.0)) * Math.PI) / 180.0;
          const refRe = vPolRe * Math.cos(mtaRad) - vPolIm * Math.sin(mtaRad);
          const refIm = vPolRe * Math.sin(mtaRad) + vPolIm * Math.cos(mtaRad);
          forwardOk = i1Re * refRe + i1Im * refIm > 0.0;
        }
        if (forwardOk && effI >= iPick) {
          pickup = true;
          const mult = Math.max(1.05, effI / Math.max(1e-3, iPick));
          tripDelaySec = (0.14 * (relay.timeDialSetting ?? 0.5)) / (Math.pow(mult, 0.02) - 1.0);
        }
      } else if (relay.ansiCode === "87T" || relay.ansiCode === "87L") {
        const iPick = relay.pickupCurrentA ?? 100.0;
        const harm2PctLimit = relay.secondHarmonicBlockPercent ?? 15.0;
        const i2HarmRatioPct = rs.sampleCount >= rs.nCyc && i1Mag > 1e-3 ? (100.0 * i1H2Mag) / i1Mag : 0.0;
        const inrushBlocked = rs.sampleCount >= rs.nCyc && i2HarmRatioPct >= harm2PctLimit;
        if (!inrushBlocked) {
          if (secCur) {
            const iDiff = Math.hypot(i1Re - i2Re, i1Im - i2Im);
            const i2Mag = Math.hypot(i2Re, i2Im);
            const iRst = 0.5 * (i1Mag + i2Mag);
            const s1 = (relay.slope1Percent ?? 25.0) / 100.0;
            const s2 = (relay.slope2Percent ?? 50.0) / 100.0;
            const iKnee = 3.0 * iPick;
            const slopeThresh = iRst <= iKnee ? s1 * iRst : s1 * iKnee + s2 * (iRst - iKnee);
            pickup = iDiff >= Math.max(iPick, slopeThresh);
          } else {
            pickup = effI >= iPick;
          }
        }
        tripDelaySec = relay.ansiCode === "87T" ? 1.0 / Math.max(1.0, relayFreqHz) : 0.0;
      } else if (relay.ansiCode === "27") {
        pickup = effV < 0.8 * vNomPeak;
        tripDelaySec = 0.02;
      } else if (relay.ansiCode === "59") {
        pickup = effV > 1.2 * vNomPeak;
        tripDelaySec = 0.02;
      } else if (relay.ansiCode === "81U" || relay.ansiCode === "81O" || relay.ansiCode === "81R") {
        const gen0 = syncGenerators[0];
        const fHz = gen0 ? gen0.omegaRadSec / (2 * Math.PI) : rs.freqEstHz;
        if (relay.ansiCode === "81R") {
          pickup =
            (rs.sampleCount >= rs.nCyc && Math.abs(rs.smoothRocofHzPerSec) > 1.5) || Math.abs(fHz - relayFreqHz) > 0.5;
        } else if (relay.ansiCode === "81O") {
          pickup = fHz > relayFreqHz + 0.5;
        } else {
          pickup = fHz < relayFreqHz - 0.5;
        }
        tripDelaySec = 0.02;
      }

      if (pickup) {
        rs.timerSec += timeStepSec;
        if (rs.timerSec >= tripDelaySec) {
          rs.tripped = true;
          // Command target circuit breaker to open at next step
          const targetId = relay.tripBreakerId || relay.monitoredBranch;
          const targetSw =
            switchStates.find((s) => s.sw.id === targetId) ?? (relay.tripBreakerId ? undefined : switchStates[0]);
          if (targetSw && targetSw.currentClosed) {
            targetSw.sw.actionTimeSec = Math.min(targetSw.sw.actionTimeSec, t + timeStepSec);
          }
        }
      } else {
        rs.timerSec = Math.max(0.0, rs.timerSec - 0.5 * timeStepSec);
      }
    }
    rs.tripTraj[k] = rs.tripped ? 1.0 : 0.0;
  }
}
