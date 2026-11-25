// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Rotating Machine Time-Stepping (Synchronous & Induction Machines)
 *
 * Implements:
 * - Park dq0 synchronous generator 6th-order flux ODEs, closed-loop CSMF EF/TM port coupling,
 *   single-mass rotor swing equation, and coupled N-mass spring-mass torsional shaft dynamics
 * - Induction machine stator current and rotor slip integration
 */

import type { CsmfControlEvaluator } from "./csmf-evaluator.js";
import type { IndMachineRuntimeState, SyncGenState } from "./emt-solver-types.js";

/**
 * Steps all Park dq0 synchronous generators (stator companion history, 6th-order transient/subtransient
 * rotor flux ODEs, closed-loop CSMF EF/TM control signals, and single- or multi-mass shaft mechanics).
 */
export function stepSynchronousGenerators(
  syncGenerators: readonly SyncGenState[],
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  csmfEvaluator: CsmfControlEvaluator | null,
  timeStepSec: number,
  t: number,
  k: number,
): void {
  for (const sg of syncGenerators) {
    const thetaE = sg.omega0 * t + sg.deltaRad;
    const ea = sg.vPeak * (sg.eqSubPu * Math.sin(thetaE) + sg.edSubPu * Math.cos(thetaE));
    const eb =
      sg.vPeak *
      (sg.eqSubPu * Math.sin(thetaE - (2 * Math.PI) / 3) + sg.edSubPu * Math.cos(thetaE - (2 * Math.PI) / 3));
    const ec =
      sg.vPeak *
      (sg.eqSubPu * Math.sin(thetaE + (2 * Math.PI) / 3) + sg.edSubPu * Math.cos(thetaE + (2 * Math.PI) / 3));

    const va = vaStep[sg.busIdx]!;
    const vb = vbStep[sg.busIdx]!;
    const vc = vcStep[sg.busIdx]!;

    const diffA = ea - va;
    const diffB = eb - vb;
    const diffC = ec - vc;
    const ia = sg.gGen * diffA + sg.iHistA;
    const ib = sg.gGen * diffB + sg.iHistB;
    const ic = sg.gGen * diffC + sg.iHistC;
    sg.iHistA = sg.alphaGen * ia + sg.gGen * diffA;
    sg.iHistB = sg.alphaGen * ib + sg.gGen * diffB;
    sg.iHistC = sg.alphaGen * ic + sg.gGen * diffC;
    sg.ia[k] = ia;
    sg.ib[k] = ib;
    sg.ic[k] = ic;

    // Park dq0 transform aligned with rotor angle thetaE
    const sinA = Math.sin(thetaE);
    const sinB = Math.sin(thetaE - (2 * Math.PI) / 3);
    const sinC = Math.sin(thetaE + (2 * Math.PI) / 3);
    const cosA = Math.cos(thetaE);
    const cosB = Math.cos(thetaE - (2 * Math.PI) / 3);
    const cosC = Math.cos(thetaE + (2 * Math.PI) / 3);

    const vd = ((2.0 / 3.0) * (va * sinA + vb * sinB + vc * sinC)) / sg.vPeak;
    const vq = ((2.0 / 3.0) * (va * cosA + vb * cosB + vc * cosC)) / sg.vPeak;
    const id = ((2.0 / 3.0) * (ia * sinA + ib * sinB + ic * sinC)) / sg.iBasePeak;
    const iq = ((2.0 / 3.0) * (ia * cosA + ib * cosB + ic * cosC)) / sg.iBasePeak;

    const sBase3Ph = 1.5 * sg.vPeak * sg.iBasePeak;
    const pePu = sBase3Ph > 0 ? (va * ia + vb * ib + vc * ic) / sBase3Ph : 0.0;

    sg.deltaTraj[k] = sg.deltaRad;
    sg.omegaTraj[k] = sg.omegaRadSec;
    sg.speedPuTraj[k] = sg.omegaRadSec / sg.omega0;
    sg.peTraj[k] = pePu;
    sg.vdTraj[k] = vd;
    sg.vqTraj[k] = vq;
    sg.idTraj[k] = id;
    sg.iqTraj[k] = iq;

    // 6th-order dq0 rotor flux ODEs (transient & subtransient time constants)
    const td0p = 5.0;
    const td0pp = 0.035;
    const tq0p = 0.8;
    const tq0pp = 0.045;
    const dEqPrime = (sg.efPu - sg.eqPrimePu - (sg.xdPu - sg.xdPrimePu) * id) / td0p;
    const dEdPrime = (-sg.edPrimePu + (sg.xqPu - sg.xqPrimePu) * iq) / tq0p;
    sg.eqPrimePu += timeStepSec * dEqPrime;
    sg.edPrimePu += timeStepSec * dEdPrime;
    const dEqSub = (sg.eqPrimePu - sg.eqSubPu - (sg.xdPrimePu - sg.xdSubPu) * id) / td0pp;
    const dEdSub = (sg.edPrimePu - sg.edSubPu + (sg.xqPrimePu - sg.xqSubPu) * iq) / tq0pp;
    sg.eqSubPu += timeStepSec * dEqSub;
    sg.edSubPu += timeStepSec * dEdSub;

    // Wire closed-loop CSMF EF / TM ports & export w/delta/Pe signals if csmfEvaluator is active
    if (csmfEvaluator) {
      if (sg.efSignal) {
        sg.efPu = Math.max(0.05, Math.min(6.0, csmfEvaluator.getSignal(sg.efSignal)));
      }
      if (sg.tmSignal) {
        sg.pmPu = Math.max(-1.5, Math.min(2.0, csmfEvaluator.getSignal(sg.tmSignal)));
      }
      csmfEvaluator.setSignal(`${sg.id}_w`, sg.omegaRadSec / sg.omega0);
      csmfEvaluator.setSignal(`${sg.id}_delta`, sg.deltaRad);
      csmfEvaluator.setSignal(`${sg.id}_Pe`, pePu);
    }

    const speedPu = sg.omegaRadSec / sg.omega0;
    const tePu = pePu / Math.max(0.2, speedPu);

    if (sg.torsionalMasses && sg.torsionalMasses.length >= 2) {
      // Coupled N-mass spring-mass torsional shaft (mass N-1 is generator rotor)
      const masses = sg.torsionalMasses;
      const mCount = masses.length;
      const dt = timeStepSec;
      for (let j = 0; j < mCount; j++) {
        const m = masses[j]!;
        const prev = j > 0 ? masses[j - 1]! : undefined;
        const next = j < mCount - 1 ? masses[j + 1]! : undefined;
        const tmStage = j === mCount - 1 ? 0.0 : sg.pmPu * m.torqueFraction;
        const teStage = j === mCount - 1 ? tePu : 0.0;
        const springLeft = prev ? prev.kShaftPuPerRad * (m.deltaRad - prev.deltaRad) : 0.0;
        const springRight = next ? m.kShaftPuPerRad * (next.deltaRad - m.deltaRad) : 0.0;
        const dampLeft = prev ? prev.dampingMutualPu * ((m.omegaRadSec - prev.omegaRadSec) / sg.omega0) : 0.0;
        const dampRight = next ? m.dampingMutualPu * ((next.omegaRadSec - m.omegaRadSec) / sg.omega0) : 0.0;
        const selfDamp = m.dampingPu * ((m.omegaRadSec - sg.omega0) / sg.omega0);
        const netTorque = tmStage - teStage - selfDamp - springLeft + springRight - dampLeft + dampRight;
        const dOmega = (sg.omega0 / (2.0 * m.hInertiaSec)) * netTorque;
        const omegaNext = m.omegaRadSec + dt * dOmega;
        m.deltaRad += dt * 0.5 * (m.omegaRadSec - sg.omega0 + (omegaNext - sg.omega0));
        m.omegaRadSec = omegaNext;
        m.torqueTraj[k] = springRight + springLeft;
        m.speedTraj[k] = m.omegaRadSec / sg.omega0;
      }
      const genMass = masses[mCount - 1]!;
      sg.deltaRad = genMass.deltaRad;
      sg.omegaRadSec = genMass.omegaRadSec;
    } else {
      // Single-mass swing equation:
      // d(delta)/dt = omega - omega0
      // 2H * d(omega/omega0)/dt = Pm - Pe - D * (omega - omega0) / omega0
      const slipPu = (sg.omegaRadSec - sg.omega0) / sg.omega0;
      const dOmegaDt = (sg.omega0 / (2.0 * sg.hSec)) * (sg.pmPu - tePu - sg.dampingPu * slipPu);
      const omegaNext = sg.omegaRadSec + timeStepSec * dOmegaDt;
      sg.deltaRad += timeStepSec * 0.5 * (sg.omegaRadSec - sg.omega0 + (omegaNext - sg.omega0));
      sg.omegaRadSec = omegaNext;
    }
  }
}

/**
 * Steps all induction machines (stator current recording and rotor slip/angle integration).
 */
export function stepInductionMachines(
  indMachineStates: readonly IndMachineRuntimeState[],
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  omega: number,
  timeStepSec: number,
  t: number,
  k: number,
): void {
  for (const im of indMachineStates) {
    const va = vaStep[im.busIdx] ?? 0;
    const vb = vbStep[im.busIdx] ?? 0;
    const vc = vcStep[im.busIdx] ?? 0;
    const theta = omega * t + im.thetaR;
    const ePeak = im.eInternalPu * im.vPeak;
    const ea = ePeak * Math.sin(theta);
    const eb = ePeak * Math.sin(theta - (2 * Math.PI) / 3);
    const ec = ePeak * Math.sin(theta + (2 * Math.PI) / 3);
    const curA = im.gStator * (ea - va);
    const curB = im.gStator * (eb - vb);
    const curC = im.gStator * (ec - vc);
    im.ia[k] = curA;
    im.ib[k] = curB;
    im.ic[k] = curC;
    const pElecW = va * curA + vb * curB + vc * curC;
    const tePu = pElecW / im.sBaseVa;
    const dSlip = ((im.tmPu - tePu) / (2.0 * im.hSec)) * timeStepSec;
    im.slip = Math.max(-0.5, Math.min(1.5, im.slip - dSlip));
    im.thetaR -= im.slip * omega * timeStepSec;
  }
}
