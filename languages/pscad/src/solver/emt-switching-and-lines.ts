// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Switching Interpolation, CDA Half-Step & Companion/Line History Updates
 *
 * Implements:
 * - Circuit breaker / diode switching toggle detection & current-zero crossing interpolation
 * - True `dt/2` Critical Damping Adjustment (CDA) Backward Euler half-step
 * - Sub-step switching rollback double-interpolation at `t_sw = tPrev + alpha * dt`
 * - Dommel companion branch currents & trapezoidal / CDA / interpolated history updates
 * - Bergeron, ULM, and N-conductor ULM distributed line ring buffer updates
 * - Per-phase switch current recording
 */

import { computeLineHistoryCurrents } from "./emt-line-history.js";
import {
  assembleDynamicInjections,
  computeCompanionDrop,
  solveFromLU3Phase,
  solveWithCachedLu,
  type EmtNetworkStampContext,
} from "./emt-network-stamp.js";
import type { EmtSolveLoopState, MmcRuntimeState, SwitchState } from "./emt-solver-types.js";
import { stepNConductorUlm, stepUlmLine } from "./universal-line-model.js";

export interface EmtSwitchingContext {
  readonly nBuses: number;
  readonly timeStepSec: number;
  readonly enableCda: boolean;
  readonly enableSwitchingInterpolation: boolean;
  readonly time: Float64Array;
  readonly vaStep: Float64Array;
  readonly vbStep: Float64Array;
  readonly vcStep: Float64Array;
  readonly switchStates: readonly SwitchState[];
  readonly csmfBreakerOverrides: ReadonlyMap<string, boolean>;
  readonly branchPhaseCurrents: ReadonlyMap<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly stampCtx: EmtNetworkStampContext;
}

export interface SwitchToggleMetrics {
  cdaCounter: number;
  switchingEvents: number;
  interpolatedZeroCrossings: number;
}

/**
 * Detects switch / diode state toggles at step `k` and computes sub-step zero-crossing
 * interpolation factors `alpha` into `switchedBusInterpolation`.
 */
export function evaluateSwitchToggles(
  ctx: EmtSwitchingContext,
  t: number,
  k: number,
  switchedBusInterpolation: Map<number, number>,
  cdaCounterIn: number,
): SwitchToggleMetrics {
  switchedBusInterpolation.clear();
  let cdaCounter = cdaCounterIn;
  let switchingEvents = 0;
  let interpolatedZeroCrossings = 0;
  const {
    switchStates,
    time,
    timeStepSec,
    enableCda,
    enableSwitchingInterpolation,
    csmfBreakerOverrides,
    vaStep,
    vbStep,
    vcStep,
  } = ctx;

  for (const swState of switchStates) {
    const initClosed = Boolean(swState.sw.initialClosed);
    const poleTimes = swState.sw.poleActionTimesSec;
    const phaseCurBufs = [swState.ia, swState.ib, swState.ic];
    const evaluateZeroCrossOpening = (p: number): { canOpen: boolean; alpha: number } => {
      if (!swState.sw.waitForCurrentZero || k === 0) {
        return { canOpen: true, alpha: 0.5 };
      }
      const iCurr = phaseCurBufs[p]![k - 1] ?? 0;
      const iPrev = k >= 2 ? (phaseCurBufs[p]![k - 2] ?? iCurr) : iCurr;
      if (Math.abs(iCurr) <= 1e-6 || iPrev * iCurr <= 0) {
        const denom = Math.abs(iPrev) + Math.abs(iCurr);
        const rawA = denom > 1e-12 ? Math.abs(iPrev) / denom : 0.5;
        return { canOpen: true, alpha: Math.max(0.01, Math.min(0.99, rawA)) };
      }
      return { canOpen: false, alpha: 0.5 };
    };

    if (swState.sw.diode) {
      const vStepArr = [vaStep, vbStep, vcStep];
      for (let p = 0; p < 3; p++) {
        const vFrom = swState.fromIdx >= 0 ? (vStepArr[p]![swState.fromIdx] ?? 0) : 0;
        const vTo = swState.toIdx >= 0 ? (vStepArr[p]![swState.toIdx] ?? 0) : 0;
        const vDiff = vFrom - vTo;
        const iPrev = k > 0 ? (phaseCurBufs[p]![k - 1] ?? 0) : 0;
        const nextClosed = swState.phaseClosed[p] ? iPrev > 1e-6 || vDiff > 0.7 : vDiff > 0.7;
        if (nextClosed !== swState.phaseClosed[p]) {
          swState.phaseClosed[p] = nextClosed;
          switchingEvents++;
          if (enableCda) cdaCounter = 2;
        }
      }
      swState.currentClosed = swState.phaseClosed[0] || swState.phaseClosed[1] || swState.phaseClosed[2];
    } else if (poleTimes) {
      for (let p = 0; p < 3; p++) {
        const actionT = poleTimes[p]!;
        const desiredClosed = t >= actionT ? !initClosed : initClosed;
        let nextClosed = desiredClosed;
        let zeroCrossAlpha: number | undefined;
        if (swState.phaseClosed[p] && !desiredClosed) {
          const zc = evaluateZeroCrossOpening(p);
          if (!zc.canOpen) {
            nextClosed = true;
          } else if (swState.sw.waitForCurrentZero) {
            zeroCrossAlpha = zc.alpha;
          }
        }
        if (nextClosed !== swState.phaseClosed[p]) {
          swState.phaseClosed[p] = nextClosed;
          switchingEvents++;
          if (enableCda) {
            cdaCounter = 2; // Trigger 2 steps of CDA damping
          }
          if (enableSwitchingInterpolation) {
            const tPrev = k > 0 ? time[k - 1]! : t - timeStepSec;
            const rawAlpha = zeroCrossAlpha ?? (actionT - tPrev) / timeStepSec;
            const alpha = rawAlpha > 0.01 && rawAlpha < 0.99 ? rawAlpha : 0.5;
            interpolatedZeroCrossings++;
            if (swState.fromIdx >= 0) switchedBusInterpolation.set(swState.fromIdx, alpha);
            if (swState.toIdx >= 0) switchedBusInterpolation.set(swState.toIdx, alpha);
          }
        }
      }
      swState.currentClosed = swState.phaseClosed[0] || swState.phaseClosed[1] || swState.phaseClosed[2];
    } else {
      const overrideClosed = csmfBreakerOverrides.get(swState.sw.id);
      const actionT = swState.sw.actionTimeSec;
      const desiredClosed = overrideClosed !== undefined ? overrideClosed : t >= actionT ? !initClosed : initClosed;
      let anyToggled = false;
      let toggledZeroAlpha: number | undefined;
      for (let p = 0; p < 3; p++) {
        let nextClosed = desiredClosed;
        if (swState.phaseClosed[p] && !desiredClosed) {
          const zc = evaluateZeroCrossOpening(p);
          if (!zc.canOpen) {
            nextClosed = true;
          } else if (swState.sw.waitForCurrentZero) {
            toggledZeroAlpha = zc.alpha;
          }
        }
        if (nextClosed !== swState.phaseClosed[p]) {
          swState.phaseClosed[p] = nextClosed;
          anyToggled = true;
        }
      }
      if (anyToggled) {
        switchingEvents++;
        if (enableCda) {
          cdaCounter = 2;
        }
        if (enableSwitchingInterpolation) {
          const tPrev = k > 0 ? time[k - 1]! : t - timeStepSec;
          const rawAlpha = toggledZeroAlpha ?? (actionT - tPrev) / timeStepSec;
          const alpha = rawAlpha > 0.01 && rawAlpha < 0.99 ? rawAlpha : 0.5;
          interpolatedZeroCrossings++;
          if (swState.fromIdx >= 0) switchedBusInterpolation.set(swState.fromIdx, alpha);
          if (swState.toIdx >= 0) switchedBusInterpolation.set(swState.toIdx, alpha);
        }
      }
      swState.currentClosed = swState.phaseClosed[0] || swState.phaseClosed[1] || swState.phaseClosed[2];
    }
  }

  return { cdaCounter, switchingEvents, interpolatedZeroCrossings };
}

/**
 * Executes a true `dt/2` CDA half-step (Backward Euler at `t - 0.5 * dt`) to resynchronize
 * companion branch histories onto the main grid without numerical chatter.
 */
export function executeCdaHalfStep(
  ctx: EmtSwitchingContext,
  t: number,
  k: number,
  anyFaultActive: boolean,
  mmcRuntimeStates: readonly MmcRuntimeState[],
): void {
  const { stampCtx, timeStepSec, vaStep, vbStep, vcStep } = ctx;
  const { mat, companionBranches } = stampCtx;
  const tHalf = t - 0.5 * timeStepSec;
  assembleDynamicInjections(stampCtx, tHalf, k, false, anyFaultActive, mmcRuntimeStates);
  solveFromLU3Phase(mat, mat.LU3, mat.piv3, mat.J3, mat.v3Step);
  for (const br of companionBranches) {
    const [dvA, dvB, dvC] = computeCompanionDrop(br, mat.v3Step, vaStep, vbStep, vcStep, true);
    const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
    const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
    const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
    br.iHistA = br.vCoeffHist < 0 ? -br.gEq * (dvA - br.rOhm * curA) : br.alphaBe * curA;
    br.iHistB = br.vCoeffHist < 0 ? -br.gEq * (dvB - br.rOhm * curB) : br.alphaBe * curB;
    br.iHistC = br.vCoeffHist < 0 ? -br.gEq * (dvC - br.rOhm * curC) : br.alphaBe * curC;
  }
}

/**
 * Executes switching rollback double-interpolation when topology toggled sub-step at `t_sw = tPrev + alpha * dt`.
 * Returns `true` if a pre-switch solution was computed into `loopState.vPreStep3`.
 */
export function executeSwitchingRollbackInterpolation(
  ctx: EmtSwitchingContext,
  t: number,
  k: number,
  prevTopoKey: string,
  topoKey: string,
  anyFaultActive: boolean,
  mmcRuntimeStates: readonly MmcRuntimeState[],
  switchedBusInterpolation: ReadonlyMap<number, number>,
  loopState: EmtSolveLoopState,
): boolean {
  const { nBuses, timeStepSec, enableSwitchingInterpolation, stampCtx, vaStep, vbStep, vcStep } = ctx;
  const { mat, companionBranches } = stampCtx;
  if (
    k <= 0 ||
    switchedBusInterpolation.size === 0 ||
    !enableSwitchingInterpolation ||
    prevTopoKey === "" ||
    prevTopoKey === topoKey
  ) {
    return false;
  }

  const prevEntry = mat.luCache.get(prevTopoKey);
  if (!prevEntry) return false;

  const { vaPrevStep, vbPrevStep, vcPrevStep, vPreStep3 } = loopState;
  assembleDynamicInjections(stampCtx, t, k, false, anyFaultActive, mmcRuntimeStates);
  solveWithCachedLu(prevEntry, mat.J3, vPreStep3, mat.nPhaseNodes);

  // Average sub-step switching fraction alpha across active switching events on step k
  let alphaSum = 0.0;
  let alphaCnt = 0;
  for (const a of switchedBusInterpolation.values()) {
    alphaSum += a;
    alphaCnt++;
  }
  const alphaSw = alphaCnt > 0 ? alphaSum / alphaCnt : 0.5;
  const tSw = t - (1.0 - alphaSw) * timeStepSec;

  // Interpolate network node voltages at t_sw = (1 - alpha)*t_{k-1} + alpha*t_k
  for (let i = 0; i < nBuses; i++) {
    mat.v3Step[3 * i + 0] = (1.0 - alphaSw) * vaPrevStep[i]! + alphaSw * vPreStep3[3 * i + 0]!;
    mat.v3Step[3 * i + 1] = (1.0 - alphaSw) * vbPrevStep[i]! + alphaSw * vPreStep3[3 * i + 1]!;
    mat.v3Step[3 * i + 2] = (1.0 - alphaSw) * vcPrevStep[i]! + alphaSw * vPreStep3[3 * i + 2]!;
  }

  // Roll companion branch histories smoothly to the switching instant t_sw
  for (const br of companionBranches) {
    const [dvA, dvB, dvC] = computeCompanionDrop(br, mat.v3Step, vaStep, vbStep, vcStep, true);
    const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
    const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
    const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
    const iHistSwA =
      br.alphaHist * curA + br.alphaMutHist * (curB + curC) + br.vCoeffHist * (br.gEq * dvA + br.gMut * (dvB + dvC));
    const iHistSwB =
      br.alphaHist * curB + br.alphaMutHist * (curA + curC) + br.vCoeffHist * (br.gEq * dvB + br.gMut * (dvA + dvC));
    const iHistSwC =
      br.alphaHist * curC + br.alphaMutHist * (curA + curB) + br.vCoeffHist * (br.gEq * dvC + br.gMut * (dvA + dvB));
    br.iHistA = (1.0 - alphaSw) * br.iHistA + alphaSw * iHistSwA;
    br.iHistB = (1.0 - alphaSw) * br.iHistB + alphaSw * iHistSwB;
    br.iHistC = (1.0 - alphaSw) * br.iHistC + alphaSw * iHistSwC;
  }

  // Half-step resynchronization injection at t_sw -> t_k
  assembleDynamicInjections(stampCtx, tSw, k, false, anyFaultActive, mmcRuntimeStates);
  return true;
}

/**
 * Updates Dommel companion branch currents & histories, plus Bergeron, ULM, and N-conductor ULM
 * distributed transmission line ring buffers and terminal currents.
 */
export function updateCompanionBranchesAndLines(
  ctx: EmtSwitchingContext,
  k: number,
  isCdaActive: boolean,
  switchedBusInterpolation: ReadonlyMap<number, number>,
): void {
  const { enableSwitchingInterpolation, vaStep, vbStep, vcStep, branchPhaseCurrents, stampCtx } = ctx;
  const { mat, companionBranches, bergeronLines, ulmLines, nUlmLines } = stampCtx;

  for (const br of companionBranches) {
    const [dvA, dvB, dvC] = computeCompanionDrop(br, mat.v3Step, vaStep, vbStep, vcStep, false);

    const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
    const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
    const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
    br.ia[k] = curA;
    br.ib[k] = curB;
    br.ic[k] = curC;

    const interpAlpha = switchedBusInterpolation.get(br.fromIdx) ?? switchedBusInterpolation.get(br.toIdx);
    const iHistBeA = br.vCoeffHist < 0 ? -br.gEq * (dvA - br.rOhm * curA) : br.alphaBe * curA;
    const iHistBeB = br.vCoeffHist < 0 ? -br.gEq * (dvB - br.rOhm * curB) : br.alphaBe * curB;
    const iHistBeC = br.vCoeffHist < 0 ? -br.gEq * (dvC - br.rOhm * curC) : br.alphaBe * curC;

    const iHistTrapA =
      br.alphaHist * curA + br.alphaMutHist * (curB + curC) + br.vCoeffHist * (br.gEq * dvA + br.gMut * (dvB + dvC));
    const iHistTrapB =
      br.alphaHist * curB + br.alphaMutHist * (curA + curC) + br.vCoeffHist * (br.gEq * dvB + br.gMut * (dvA + dvC));
    const iHistTrapC =
      br.alphaHist * curC + br.alphaMutHist * (curA + curB) + br.vCoeffHist * (br.gEq * dvC + br.gMut * (dvA + dvB));

    if (interpAlpha !== undefined && enableSwitchingInterpolation) {
      br.iHistA = (1.0 - interpAlpha) * iHistBeA + interpAlpha * iHistTrapA;
      br.iHistB = (1.0 - interpAlpha) * iHistBeB + interpAlpha * iHistTrapB;
      br.iHistC = (1.0 - interpAlpha) * iHistBeC + interpAlpha * iHistTrapC;
    } else if (isCdaActive) {
      br.iHistA = iHistBeA;
      br.iHistB = iHistBeB;
      br.iHistC = iHistBeC;
    } else {
      br.iHistA = iHistTrapA;
      br.iHistB = iHistTrapB;
      br.iHistC = iHistTrapC;
    }
  }

  // Update Bergeron / FDPM distributed line ring buffers and terminal currents
  for (const bl of bergeronLines) {
    const { ptr, bufLen, gBerg } = bl;
    const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = computeLineHistoryCurrents(bl, true);

    const vkA = bl.fromIdx >= 0 ? vaStep[bl.fromIdx]! : 0.0;
    const vkB = bl.fromIdx >= 0 ? vbStep[bl.fromIdx]! : 0.0;
    const vkC = bl.fromIdx >= 0 ? vcStep[bl.fromIdx]! : 0.0;

    const vmA = bl.toIdx >= 0 ? vaStep[bl.toIdx]! : 0.0;
    const vmB = bl.toIdx >= 0 ? vbStep[bl.toIdx]! : 0.0;
    const vmC = bl.toIdx >= 0 ? vcStep[bl.toIdx]! : 0.0;

    let ikmA: number;
    let ikmB: number;
    let ikmC: number;
    let imkA: number;
    let imkB: number;
    let imkC: number;

    if (bl.hasModal) {
      const ONE_OVER_3 = 1.0 / 3.0;
      const ONE_OVER_SQRT3 = 1.0 / Math.sqrt(3.0);

      ikmA = bl.gSelf * vkA + bl.gMutual * (vkB + vkC) + iHistKmA;
      ikmB = bl.gSelf * vkB + bl.gMutual * (vkA + vkC) + iHistKmB;
      ikmC = bl.gSelf * vkC + bl.gMutual * (vkA + vkB) + iHistKmC;

      imkA = bl.gSelf * vmA + bl.gMutual * (vmB + vmC) + iHistMkA;
      imkB = bl.gSelf * vmB + bl.gMutual * (vmA + vmC) + iHistMkB;
      imkC = bl.gSelf * vmC + bl.gMutual * (vmA + vmB) + iHistMkC;

      bl.vkBufA[ptr] = ONE_OVER_3 * (vkA + vkB + vkC);
      bl.vkBufB[ptr] = ONE_OVER_3 * (2.0 * vkA - vkB - vkC);
      bl.vkBufC[ptr] = ONE_OVER_SQRT3 * (vkB - vkC);

      bl.vmBufA[ptr] = ONE_OVER_3 * (vmA + vmB + vmC);
      bl.vmBufB[ptr] = ONE_OVER_3 * (2.0 * vmA - vmB - vmC);
      bl.vmBufC[ptr] = ONE_OVER_SQRT3 * (vmB - vmC);

      bl.ikmBufA[ptr] = ONE_OVER_3 * (ikmA + ikmB + ikmC);
      bl.ikmBufB[ptr] = ONE_OVER_3 * (2.0 * ikmA - ikmB - ikmC);
      bl.ikmBufC[ptr] = ONE_OVER_SQRT3 * (ikmB - ikmC);

      bl.imkBufA[ptr] = ONE_OVER_3 * (imkA + imkB + imkC);
      bl.imkBufB[ptr] = ONE_OVER_3 * (2.0 * imkA - imkB - imkC);
      bl.imkBufC[ptr] = ONE_OVER_SQRT3 * (imkB - imkC);
    } else {
      ikmA = gBerg * vkA + iHistKmA;
      ikmB = gBerg * vkB + iHistKmB;
      ikmC = gBerg * vkC + iHistKmC;

      imkA = gBerg * vmA + iHistMkA;
      imkB = gBerg * vmB + iHistMkB;
      imkC = gBerg * vmC + iHistMkC;

      bl.vkBufA[ptr] = vkA;
      bl.vkBufB[ptr] = vkB;
      bl.vkBufC[ptr] = vkC;
      bl.vmBufA[ptr] = vmA;
      bl.vmBufB[ptr] = vmB;
      bl.vmBufC[ptr] = vmC;

      bl.ikmBufA[ptr] = ikmA;
      bl.ikmBufB[ptr] = ikmB;
      bl.ikmBufC[ptr] = ikmC;
      bl.imkBufA[ptr] = imkA;
      bl.imkBufB[ptr] = imkB;
      bl.imkBufC[ptr] = imkC;
    }

    bl.ia[k] = ikmA;
    bl.ib[k] = ikmB;
    bl.ic[k] = ikmC;
    bl.ptr = (ptr + 1) % bufLen;
  }

  // Update Universal Line Model (ULM) distributed line ring buffers and terminal currents
  for (const ulm of ulmLines) {
    const vkA = ulm.fromIdx >= 0 ? vaStep[ulm.fromIdx]! : 0.0;
    const vkB = ulm.fromIdx >= 0 ? vbStep[ulm.fromIdx]! : 0.0;
    const vkC = ulm.fromIdx >= 0 ? vcStep[ulm.fromIdx]! : 0.0;
    const vmA = ulm.toIdx >= 0 ? vaStep[ulm.toIdx]! : 0.0;
    const vmB = ulm.toIdx >= 0 ? vbStep[ulm.toIdx]! : 0.0;
    const vmC = ulm.toIdx >= 0 ? vcStep[ulm.toIdx]! : 0.0;

    const curA = ulm.gEq[0]! * vkA + ulm.gEq[1]! * vkB + ulm.gEq[2]! * vkC + ulm.iHistK[0]!;
    const curB = ulm.gEq[3]! * vkA + ulm.gEq[4]! * vkB + ulm.gEq[5]! * vkC + ulm.iHistK[1]!;
    const curC = ulm.gEq[6]! * vkA + ulm.gEq[7]! * vkB + ulm.gEq[8]! * vkC + ulm.iHistK[2]!;

    const curBufs = branchPhaseCurrents.get(ulm.id);
    if (curBufs) {
      curBufs.a[k] = curA;
      curBufs.b[k] = curB;
      curBufs.c[k] = curC;
    }

    stepUlmLine(ulm, vkA, vkB, vkC, vmA, vmB, vmC, true);
  }

  for (const nu of nUlmLines) {
    nu.vK.fill(0);
    nu.vM.fill(0);
    if (nu.fromIdx >= 0) {
      nu.vK[0] = vaStep[nu.fromIdx]!;
      if (nu.model.nCond > 1) nu.vK[1] = vbStep[nu.fromIdx]!;
      if (nu.model.nCond > 2) nu.vK[2] = vcStep[nu.fromIdx]!;
    }
    if (nu.toIdx >= 0) {
      nu.vM[0] = vaStep[nu.toIdx]!;
      if (nu.model.nCond > 1) nu.vM[1] = vbStep[nu.toIdx]!;
      if (nu.model.nCond > 2) nu.vM[2] = vcStep[nu.toIdx]!;
    }
    const nCond = nu.model.nCond;
    let curA = nu.model.iHistK[0] ?? 0;
    let curB = nCond > 1 ? (nu.model.iHistK[1] ?? 0) : 0;
    let curC = nCond > 2 ? (nu.model.iHistK[2] ?? 0) : 0;
    for (let c = 0; c < nCond; c++) {
      curA += (nu.model.gEq[0 * nCond + c] ?? 0) * nu.vK[c]!;
      if (nCond > 1) curB += (nu.model.gEq[1 * nCond + c] ?? 0) * nu.vK[c]!;
      if (nCond > 2) curC += (nu.model.gEq[2 * nCond + c] ?? 0) * nu.vK[c]!;
    }
    const curBufs = branchPhaseCurrents.get(nu.id);
    if (curBufs) {
      curBufs.a[k] = curA;
      curBufs.b[k] = curB;
      curBufs.c[k] = curC;
    }
    stepNConductorUlm(nu.model, nu.vK, nu.vM, true);
  }
}

/**
 * Records per-phase currents through all switch / breaker elements at step `k`.
 */
export function updateSwitchCurrents(
  switchStates: readonly SwitchState[],
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  k: number,
): void {
  for (const swState of switchStates) {
    const { fromIdx, toIdx, ia, ib, ic } = swState;
    const currentArrays = [ia, ib, ic];
    for (let p = 0; p < 3; p++) {
      const isClosed = swState.phaseClosed[p];
      const rSw = isClosed ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4) : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
      const gSw = 1.0 / rSw;
      const vFrom = fromIdx >= 0 ? (p === 0 ? vaStep[fromIdx]! : p === 1 ? vbStep[fromIdx]! : vcStep[fromIdx]!) : 0;
      const vTo = toIdx >= 0 ? (p === 0 ? vaStep[toIdx]! : p === 1 ? vbStep[toIdx]! : vcStep[toIdx]!) : 0;
      currentArrays[p]![k] = gSw * (vFrom - vTo);
    }
  }
}
