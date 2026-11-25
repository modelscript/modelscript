// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Nonlinear EMT Network Elements
 *
 * Implements:
 * - Multi-port Metal Oxide Surge Arrester (MOV) Thévenin response precomputation
 *   and coupled Newton-Raphson compensation
 * - Saturable transformer magnetic core updates (piecewise-linear & Jiles-Atherton hysteresis)
 * - Automatic On-Load Tap Changer (OLTC) voltage regulation stepping
 */

import { solveSmallDenseSystem } from "./emt-linear-algebra.js";
import type {
  CompanionBranch,
  EmtSolveLoopState,
  OltcState,
  SatXfmrRuntimeState,
  SurgeArresterState,
} from "./emt-solver-types.js";

/**
 * Precomputes Thévenin driving-point impedances `zTh`, response vectors `xTh = G3^-1 * e_uv`,
 * and coupled multi-port `Z_ports` matrix for all registered Metal Oxide Surge Arresters (MOVs).
 */
export function updateSurgeArresterTheveninVectors(
  surgeArresters: readonly SurgeArresterState[],
  nPhaseNodes: number,
  solveLinear: (rhs: Float64Array, out: Float64Array) => void,
  zArresterPorts: Float64Array,
): Float64Array {
  const nArr = surgeArresters.length;
  if (nArr === 0) return zArresterPorts;
  const e = new Float64Array(nPhaseNodes);

  for (const arr of surgeArresters) {
    for (let p = 0; p < 3; p++) {
      const u = arr.fromIdx >= 0 ? 3 * arr.fromIdx + p : -1;
      const v = arr.toIdx >= 0 ? 3 * arr.toIdx + p : -1;
      if (u < 0 && v < 0) continue;

      e.fill(0);
      if (u >= 0) e[u] = 1.0;
      if (v >= 0) e[v] = -1.0;

      const x = arr.xThPhase[p]!;
      solveLinear(e, x);

      const zTh = (u >= 0 ? x[u]! : 0.0) - (v >= 0 ? x[v]! : 0.0);
      arr.zThPhase[p] = Math.max(1e-4, zTh);
    }
  }

  const M = nArr * 3;
  const ports = zArresterPorts.length === M * M ? zArresterPorts : new Float64Array(M * M);
  for (let a = 0; a < nArr; a++) {
    const arrA = surgeArresters[a]!;
    for (let pA = 0; pA < 3; pA++) {
      const row = a * 3 + pA;
      const uA = arrA.fromIdx >= 0 ? 3 * arrA.fromIdx + pA : -1;
      const vA = arrA.toIdx >= 0 ? 3 * arrA.toIdx + pA : -1;
      for (let b = 0; b < nArr; b++) {
        const arrB = surgeArresters[b]!;
        for (let pB = 0; pB < 3; pB++) {
          const col = b * 3 + pB;
          const xB = arrB.xThPhase[pB]!;
          const zAb = (uA >= 0 ? xB[uA]! : 0.0) - (vA >= 0 ? xB[vA]! : 0.0);
          ports[row * M + col] = zAb;
        }
      }
    }
  }
  return ports;
}

/**
 * Applies coupled multi-port nonlinear Thévenin Newton-Raphson compensation for Surge Arresters (MOVs)
 * directly to `v3Step` in-place, returning the number of Newton iterations executed.
 */
export function applySurgeArresterCompensation(
  surgeArresters: readonly SurgeArresterState[],
  zArresterPorts: Float64Array,
  nPhaseNodes: number,
  timeStepSec: number,
  v3Step: Float64Array,
  loopState: EmtSolveLoopState,
): number {
  const { nArr, arrM, v0Step, arrV0, arrCurr, arrRes, arrDelta, arrJac } = loopState;
  if (arrM <= 0 || !v0Step || !arrV0 || !arrCurr || !arrRes || !arrDelta || !arrJac) {
    return 0;
  }

  let anyConducting = false;
  for (let a = 0; a < nArr; a++) {
    const arr = surgeArresters[a]!;
    for (let p = 0; p < 3; p++) {
      const row = a * 3 + p;
      const u = arr.fromIdx >= 0 ? 3 * arr.fromIdx + p : -1;
      const v = arr.toIdx >= 0 ? 3 * arr.toIdx + p : -1;
      const vOpen = (u >= 0 ? v3Step[u]! : 0.0) - (v >= 0 ? v3Step[v]! : 0.0);
      arrV0[row] = vOpen;
      if (Math.abs(vOpen) > arr.vRefVolts) {
        anyConducting = true;
        arrCurr[row] = Math.sign(vOpen) * ((Math.abs(vOpen) - arr.vRefVolts) / (arr.zThPhase[p]! + arr.rClampOhm));
      } else {
        arrCurr[row] = 0.0;
      }
    }
  }

  if (!anyConducting) return 0;

  let iterations = 0;
  v0Step.set(v3Step);
  const Z = zArresterPorts;
  for (let iter = 0; iter < 12; iter++) {
    let maxRes = 0.0;
    for (let row = 0; row < arrM; row++) {
      const arr = surgeArresters[Math.floor(row / 3)]!;
      let zI = 0.0;
      const zRowOff = row * arrM;
      for (let col = 0; col < arrM; col++) {
        zI += Z[zRowOff + col]! * arrCurr[col]!;
      }
      const vPort = arrV0[row]! - zI;
      const vAbs = Math.abs(vPort);
      let iTarget = 0.0;
      let gSlope = 0.0;
      if (vAbs > 0.5 * arr.vRefVolts) {
        const ratio = Math.min(vAbs / Math.max(1.0, arr.vRefVolts), 2.0);
        const q = 22.0;
        const iRefA = 500.0;
        const iPow = iRefA * Math.pow(ratio, q);
        const gPow = (q * iPow) / Math.max(1.0, vAbs);
        const excessV = Math.max(0.0, vAbs - arr.vRefVolts);
        const gLin = excessV > 0 ? 1.0 / arr.rClampOhm : 0.0;
        gSlope = gPow + gLin;
        iTarget = Math.sign(vPort) * (iPow + excessV * gLin);
      }
      const rVal = arrCurr[row]! - iTarget;
      arrRes[row] = -rVal;
      if (Math.abs(rVal) > maxRes) maxRes = Math.abs(rVal);
      for (let col = 0; col < arrM; col++) {
        arrJac[zRowOff + col] = (row === col ? 1.0 : 0.0) + gSlope * Z[zRowOff + col]!;
      }
    }
    if (maxRes < 1e-4) break;
    iterations++;
    if (!solveSmallDenseSystem(arrJac, arrRes, arrDelta, arrM)) break;
    for (let row = 0; row < arrM; row++) {
      arrCurr[row] = arrCurr[row]! + arrDelta[row]!;
    }
  }

  for (let a = 0; a < nArr; a++) {
    const arr = surgeArresters[a]!;
    for (let p = 0; p < 3; p++) {
      const row = a * 3 + p;
      const iCorr = arrCurr[row]!;
      if (Math.abs(iCorr) <= 1e-12) continue;
      const xTh = arr.xThPhase[p]!;
      for (let j = 0; j < nPhaseNodes; j++) {
        v3Step[j] = v3Step[j]! - xTh[j]! * iCorr;
      }
      let zI = 0.0;
      const zRowOff = row * arrM;
      for (let col = 0; col < arrM; col++) zI += Z[zRowOff + col]! * arrCurr[col]!;
      const vClamped = arrV0[row]! - zI;
      arr.energyJoules += Math.abs(vClamped * iCorr) * timeStepSec;
    }
  }

  return iterations;
}

/**
 * Steps OLTC automatic transformer tap changers and returns the number of tap switching events
 * (nonzero indicates LU invalidation is required).
 */
export function stepOltcTapChangers(
  oltcStates: readonly OltcState[],
  companionBranches: readonly CompanionBranch[],
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  timeStepSec: number,
  k: number,
): number {
  let tapSwitchingEvents = 0;
  for (const oltc of oltcStates) {
    if (oltc.targetBusIdx >= 0 && oltc.vRefVoltsPeak > 0) {
      const va = vaStep[oltc.targetBusIdx] ?? 0;
      const vb = vbStep[oltc.targetBusIdx] ?? 0;
      const vc = vcStep[oltc.targetBusIdx] ?? 0;
      const vMag = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
      const errPu = (oltc.vRefVoltsPeak - vMag) / oltc.vRefVoltsPeak;
      if (Math.abs(errPu) > oltc.deadbandPu) {
        oltc.timerSec += timeStepSec;
        if (oltc.timerSec >= oltc.delaySec) {
          const dir = errPu > 0 ? 1 : -1;
          const nextTap = Math.max(oltc.tapMin, Math.min(oltc.tapMax, oltc.tapPu + dir * oltc.tapStepPu));
          if (Math.abs(nextTap - oltc.tapPu) > 1e-6) {
            oltc.tapPu = nextTap;
            const br = companionBranches[oltc.branchIdx];
            if (br) {
              br.tapRatio = oltc.baseTapRatio * oltc.tapPu;
              tapSwitchingEvents++;
            }
          }
          oltc.timerSec = 0;
        }
      } else {
        oltc.timerSec = 0;
      }
    }
    oltc.tapTraj[k] = oltc.tapPu;
  }
  return tapSwitchingEvents;
}

/**
 * Updates saturable transformer flux linkages and nonlinear magnetizing currents
 * (piecewise-linear saturation curve or Jiles-Atherton ferromagnetic hysteresis core).
 */
export function stepSaturableTransformers(
  satXfmrStates: readonly SatXfmrRuntimeState[],
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  timeStepSec: number,
): void {
  for (const xf of satXfmrStates) {
    const va = vaStep[xf.primIdx] ?? 0;
    const vb = vbStep[xf.primIdx] ?? 0;
    const vc = vcStep[xf.primIdx] ?? 0;
    xf.fluxA += 0.5 * (va + xf.vPrevA) * timeStepSec;
    xf.fluxB += 0.5 * (vb + xf.vPrevB) * timeStepSec;
    xf.fluxC += 0.5 * (vc + xf.vPrevC) * timeStepSec;
    xf.vPrevA = va;
    xf.vPrevB = vb;
    xf.vPrevC = vc;
    if (xf.coreModel === "JILES_ATHERTON") {
      const stepJa = (flux: number, mPrev: number, hPrev: number): { iMag: number; mNext: number; hNext: number } => {
        const fluxNorm = flux / Math.max(1e-6, xf.lambdaKnee);
        const hNext = fluxNorm * xf.jaA * 2.5;
        const dH = hNext - hPrev;
        const hEff = hNext + xf.jaAlpha * mPrev;
        const x = hEff / Math.max(1e-3, xf.jaA);
        const mAn = Math.abs(x) < 1e-4 ? (xf.jaMs * x) / 3.0 : xf.jaMs * (1 / Math.tanh(x) - 1 / x);
        const delta = dH >= 0 ? 1 : -1;
        const denom = delta * xf.jaK - xf.jaAlpha * (mAn - mPrev);
        const dmIrrev = Math.abs(denom) > 1e-6 ? ((mAn - mPrev) * dH) / denom : 0;
        const dManDh =
          Math.abs(x) < 1e-4 ? xf.jaMs / (3 * xf.jaA) : (xf.jaMs / xf.jaA) * (1 / (x * x) - 1 / Math.sinh(x) ** 2);
        const dmTotal = Math.max(
          -0.5 * xf.jaMs,
          Math.min(0.5 * xf.jaMs, (dmIrrev + xf.jaC * dManDh * dH) / (1 + xf.jaC)),
        );
        const mNext = Math.max(-xf.jaMs, Math.min(xf.jaMs, mPrev + dmTotal));
        const absF = Math.abs(flux);
        const iSat = absF > xf.lambdaKnee ? (Math.sign(flux) * (absF - xf.lambdaKnee)) / xf.lSatH : 0;
        const iHyst =
          0.02 *
          (xf.lambdaKnee / Math.max(1e-4, xf.lSatH)) *
          ((hNext / Math.max(1, xf.jaA)) * 0.1 - mNext / Math.max(1, xf.jaMs));
        return { iMag: iSat + iHyst, mNext, hNext };
      };
      const rA = stepJa(xf.fluxA, xf.mA, xf.hPrevA);
      xf.iMagA = rA.iMag;
      xf.mA = rA.mNext;
      xf.hPrevA = rA.hNext;
      const rB = stepJa(xf.fluxB, xf.mB, xf.hPrevB);
      xf.iMagB = rB.iMag;
      xf.mB = rB.mNext;
      xf.hPrevB = rB.hNext;
      const rC = stepJa(xf.fluxC, xf.mC, xf.hPrevC);
      xf.iMagC = rC.iMag;
      xf.mC = rC.mNext;
      xf.hPrevC = rC.hNext;
    } else {
      const satCurrent = (flux: number): number => {
        const absF = Math.abs(flux);
        if (absF <= xf.lambdaKnee) return 0;
        return (Math.sign(flux) * (absF - xf.lambdaKnee)) / xf.lSatH;
      };
      xf.iMagA = satCurrent(xf.fluxA);
      xf.iMagB = satCurrent(xf.fluxB);
      xf.iMagC = satCurrent(xf.fluxC);
    }
  }
}
