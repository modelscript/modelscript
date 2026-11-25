// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EmtdcHostBridge, EmtdcRegisteredUdm } from "../script/emtdc-abi-bridge.js";
import { computeLineHistoryCurrents } from "./emt-line-history.js";
import type {
  BergeronLineState,
  CompanionBranch,
  SourceInfo,
  SurgeArresterState,
  SwitchState,
  SyncGenState,
} from "./emt-solver-types.js";
import {
  stepNConductorUlm,
  stepUlmLine,
  type NConductorUlmData,
  type UniversalLineModelData,
} from "./universal-line-model.js";

export interface EmtSteadyStateContext {
  readonly nBuses: number;
  readonly nPhaseNodes: number;
  readonly omega: number;
  readonly timeStepSec: number;
  readonly G3: Float64Array;
  readonly J3: Float64Array;
  readonly LU3: Float64Array;
  readonly piv3: Int32Array;
  readonly v3Step: Float64Array;
  readonly vaStep: Float64Array;
  readonly vbStep: Float64Array;
  readonly vcStep: Float64Array;
  readonly busSources: ReadonlyMap<number, readonly SourceInfo[]>;
  readonly syncGenerators: readonly SyncGenState[];
  readonly companionBranches: readonly CompanionBranch[];
  readonly bergeronLines: readonly BergeronLineState[];
  readonly ulmLines: readonly UniversalLineModelData[];
  readonly nUlmLines: ReadonlyArray<{
    fromIdx: number;
    toIdx: number;
    model: NConductorUlmData;
    vK: Float64Array;
    vM: Float64Array;
  }>;
  readonly switchStates: readonly SwitchState[];
  readonly surgeArresters: readonly SurgeArresterState[];
  readonly emtdcHostBridge: EmtdcHostBridge | null;
  readonly customBlockStates: ReadonlyArray<{
    udm: EmtdcRegisteredUdm;
    busIdx: number;
  }>;
  resetConductanceMatrix(): void;
  stampDiagonal(pNode: number, g: number): void;
  stampEntry(r: number, c: number, g: number): void;
  stamp3PhaseBranch(
    fromIdx: number,
    toIdx: number,
    gSelf: number,
    gMut: number,
    tapRatio: number,
    windingConnection?: CompanionBranch["windingConnection"],
  ): void;
  stampUlmModel(ulm: UniversalLineModelData): void;
  stampNUlmModel(nu: { fromIdx: number; toIdx: number; model: NConductorUlmData }): void;
  factorize3Phase(A: Float64Array, LU: Float64Array, piv: Int32Array): boolean;
  solveFromLU3Phase(LU: Float64Array, piv: Int32Array, b: Float64Array, x: Float64Array): void;
  updateSurgeArresterTheveninVectors(): void;
  computeTopologyKey(t: number): string;
  saveTopologyToCache(key: string): void;
  injectCompanionHistory(br: CompanionBranch): void;
  computeCompanionDrop(br: CompanionBranch, useV3Step?: boolean): [number, number, number];
  onSteadyStateFactorized(activeTopoKey: string): void;
}

/**
 * Pre-solves the fundamental-frequency AC steady-state over two full cycles prior to t = 0
 * (`t in [-2 * T0, -dt]`) so that all companion branch histories, Bergeron/ULM traveling-wave
 * delay buffers, and synchronous generator states start in sinusoidal steady state at t = 0
 * with zero initialization transient.
 */
export function initializeEmtSteadyState(ctx: EmtSteadyStateContext): void {
  if (ctx.nBuses === 0) return;
  const periodSec = (2 * Math.PI) / Math.max(1.0, ctx.omega);
  const stepsPerCycle = Math.max(16, Math.round(periodSec / ctx.timeStepSec));
  const preSteps = Math.min(2000, 2 * stepsPerCycle);
  const n = ctx.nBuses;

  // Assemble pre-fault steady-state conductance matrix G3
  ctx.resetConductanceMatrix();
  for (const [bIdx, srcs] of ctx.busSources.entries()) {
    for (const s of srcs) {
      for (let p = 0; p < 3; p++) {
        ctx.stampDiagonal(3 * bIdx + p, s.gSrc);
      }
    }
  }
  for (const sg of ctx.syncGenerators) {
    const sinDelta = Math.max(-0.9, Math.min(0.9, (sg.pmPu * sg.xdSubPu) / Math.max(0.1, sg.efPu)));
    sg.deltaRad = Math.asin(sinDelta);
    for (let p = 0; p < 3; p++) {
      ctx.stampDiagonal(3 * sg.busIdx + p, sg.gGen);
    }
  }
  for (const br of ctx.companionBranches) {
    const gTotal = br.gEq + 0.5 * br.shuntG;
    ctx.stamp3PhaseBranch(br.fromIdx, br.toIdx, gTotal, br.gMut, br.tapRatio ?? 1.0, br.windingConnection);
  }
  for (const bl of ctx.bergeronLines) {
    if (bl.hasModal) {
      for (let p = 0; p < 3; p++) {
        if (bl.fromIdx >= 0) {
          ctx.stampDiagonal(3 * bl.fromIdx + p, bl.gSelf);
          for (let q = 0; q < 3; q++) {
            if (p !== q) ctx.stampEntry(3 * bl.fromIdx + p, 3 * bl.fromIdx + q, bl.gMutual);
          }
        }
        if (bl.toIdx >= 0) {
          ctx.stampDiagonal(3 * bl.toIdx + p, bl.gSelf);
          for (let q = 0; q < 3; q++) {
            if (p !== q) ctx.stampEntry(3 * bl.toIdx + p, 3 * bl.toIdx + q, bl.gMutual);
          }
        }
      }
    } else {
      for (let p = 0; p < 3; p++) {
        if (bl.fromIdx >= 0) {
          ctx.stampDiagonal(3 * bl.fromIdx + p, bl.gBerg);
        }
        if (bl.toIdx >= 0) {
          ctx.stampDiagonal(3 * bl.toIdx + p, bl.gBerg);
        }
      }
    }
  }
  for (const ulm of ctx.ulmLines) {
    ctx.stampUlmModel(ulm);
  }
  for (const nu of ctx.nUlmLines) {
    ctx.stampNUlmModel(nu);
  }
  for (const swState of ctx.switchStates) {
    const initClosed = Boolean(swState.sw.initialClosed);
    swState.currentClosed = initClosed;
    swState.phaseClosed = [initClosed, initClosed, initClosed];
    for (let p = 0; p < 3; p++) {
      const rSw = initClosed
        ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4)
        : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
      const gSw = 1.0 / rSw;
      const u = swState.fromIdx >= 0 ? 3 * swState.fromIdx + p : -1;
      const v = swState.toIdx >= 0 ? 3 * swState.toIdx + p : -1;
      if (u >= 0) ctx.stampDiagonal(u, gSw);
      if (v >= 0) ctx.stampDiagonal(v, gSw);
      if (u >= 0 && v >= 0) {
        ctx.stampEntry(u, v, -gSw);
        ctx.stampEntry(v, u, -gSw);
      }
    }
  }

  ctx.factorize3Phase(ctx.G3, ctx.LU3, ctx.piv3);
  ctx.updateSurgeArresterTheveninVectors();
  const activeTopoKey = ctx.computeTopologyKey(0);
  ctx.onSteadyStateFactorized(activeTopoKey);
  if (activeTopoKey) {
    ctx.saveTopologyToCache(activeTopoKey);
  }

  for (let step = -preSteps; step < 0; step++) {
    const t = step * ctx.timeStepSec;
    ctx.J3.fill(0);

    for (const [bIdx, srcs] of ctx.busSources.entries()) {
      for (const s of srcs) {
        const ea = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad);
        const eb = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad - (2 * Math.PI) / 3);
        const ec = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad + (2 * Math.PI) / 3);
        ctx.J3[3 * bIdx + 0] = ctx.J3[3 * bIdx + 0]! + s.gSrc * ea;
        ctx.J3[3 * bIdx + 1] = ctx.J3[3 * bIdx + 1]! + s.gSrc * eb;
        ctx.J3[3 * bIdx + 2] = ctx.J3[3 * bIdx + 2]! + s.gSrc * ec;
      }
    }
    for (const sg of ctx.syncGenerators) {
      const thetaE = sg.omega0 * t + sg.deltaRad;
      const ePeak = sg.efPu * sg.vPeak;
      ctx.J3[3 * sg.busIdx + 0] = ctx.J3[3 * sg.busIdx + 0]! + sg.gGen * ePeak * Math.sin(thetaE) + sg.iHistA;
      ctx.J3[3 * sg.busIdx + 1] =
        ctx.J3[3 * sg.busIdx + 1]! + sg.gGen * ePeak * Math.sin(thetaE - (2 * Math.PI) / 3) + sg.iHistB;
      ctx.J3[3 * sg.busIdx + 2] =
        ctx.J3[3 * sg.busIdx + 2]! + sg.gGen * ePeak * Math.sin(thetaE + (2 * Math.PI) / 3) + sg.iHistC;
    }
    for (const br of ctx.companionBranches) {
      ctx.injectCompanionHistory(br);
    }
    for (const nu of ctx.nUlmLines) {
      const { iHistK, iHistM } = stepNConductorUlm(nu.model, nu.vK, nu.vM, false);
      const pMax = Math.min(3, nu.model.nCond);
      if (nu.fromIdx >= 0) {
        for (let p = 0; p < pMax; p++) ctx.J3[3 * nu.fromIdx + p] = ctx.J3[3 * nu.fromIdx + p]! - iHistK[p]!;
      }
      if (nu.toIdx >= 0) {
        for (let p = 0; p < pMax; p++) ctx.J3[3 * nu.toIdx + p] = ctx.J3[3 * nu.toIdx + p]! - iHistM[p]!;
      }
    }
    for (const bl of ctx.bergeronLines) {
      const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = computeLineHistoryCurrents(bl, false);
      if (bl.fromIdx >= 0) {
        ctx.J3[3 * bl.fromIdx + 0] = ctx.J3[3 * bl.fromIdx + 0]! - iHistKmA;
        ctx.J3[3 * bl.fromIdx + 1] = ctx.J3[3 * bl.fromIdx + 1]! - iHistKmB;
        ctx.J3[3 * bl.fromIdx + 2] = ctx.J3[3 * bl.fromIdx + 2]! - iHistKmC;
      }
      if (bl.toIdx >= 0) {
        ctx.J3[3 * bl.toIdx + 0] = ctx.J3[3 * bl.toIdx + 0]! - iHistMkA;
        ctx.J3[3 * bl.toIdx + 1] = ctx.J3[3 * bl.toIdx + 1]! - iHistMkB;
        ctx.J3[3 * bl.toIdx + 2] = ctx.J3[3 * bl.toIdx + 2]! - iHistMkC;
      }
    }
    for (const ulm of ctx.ulmLines) {
      const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = stepUlmLine(ulm, 0, 0, 0, 0, 0, 0, false);
      if (ulm.fromIdx >= 0) {
        ctx.J3[3 * ulm.fromIdx + 0] = ctx.J3[3 * ulm.fromIdx + 0]! - iHistKmA;
        ctx.J3[3 * ulm.fromIdx + 1] = ctx.J3[3 * ulm.fromIdx + 1]! - iHistKmB;
        ctx.J3[3 * ulm.fromIdx + 2] = ctx.J3[3 * ulm.fromIdx + 2]! - iHistKmC;
      }
      if (ulm.toIdx >= 0) {
        ctx.J3[3 * ulm.toIdx + 0] = ctx.J3[3 * ulm.toIdx + 0]! - iHistMkA;
        ctx.J3[3 * ulm.toIdx + 1] = ctx.J3[3 * ulm.toIdx + 1]! - iHistMkB;
        ctx.J3[3 * ulm.toIdx + 2] = ctx.J3[3 * ulm.toIdx + 2]! - iHistMkC;
      }
    }
    for (const nu of ctx.nUlmLines) {
      const { iHistK, iHistM } = stepNConductorUlm(nu.model, nu.vK, nu.vM, false);
      const pMax = Math.min(3, nu.model.nCond);
      if (nu.fromIdx >= 0) {
        for (let p = 0; p < pMax; p++) ctx.J3[3 * nu.fromIdx + p] = ctx.J3[3 * nu.fromIdx + p]! - iHistK[p]!;
      }
      if (nu.toIdx >= 0) {
        for (let p = 0; p < pMax; p++) ctx.J3[3 * nu.toIdx + p] = ctx.J3[3 * nu.toIdx + p]! - iHistM[p]!;
      }
    }

    // EMTDC Fortran / Binary UDM DSDYN pre-network steady-state step
    if (ctx.emtdcHostBridge && ctx.customBlockStates.length > 0) {
      for (const cbs of ctx.customBlockStates) {
        if (cbs.busIdx >= 0) {
          const va = ctx.vaStep[cbs.busIdx] ?? 0.0;
          const vb = ctx.vbStep[cbs.busIdx] ?? 0.0;
          const vc = ctx.vcStep[cbs.busIdx] ?? 0.0;
          cbs.udm.ports["VA"] = va;
          cbs.udm.ports["VB"] = vb;
          cbs.udm.ports["VC"] = vc;
          cbs.udm.ports["va"] = va;
          cbs.udm.ports["vb"] = vb;
          cbs.udm.ports["vc"] = vc;
          ctx.emtdcHostBridge.state.VDC[cbs.busIdx + 1] = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
        }
      }
      ctx.emtdcHostBridge.stepDsdyn(t, step === -preSteps, false);
      for (const cbs of ctx.customBlockStates) {
        if (cbs.busIdx >= 0) {
          const iaInj = cbs.udm.ports["IA_INJ"] ?? cbs.udm.ports["IA"] ?? cbs.udm.ports["ia"] ?? 0.0;
          const ibInj = cbs.udm.ports["IB_INJ"] ?? cbs.udm.ports["IB"] ?? cbs.udm.ports["ib"] ?? 0.0;
          const icInj = cbs.udm.ports["IC_INJ"] ?? cbs.udm.ports["IC"] ?? cbs.udm.ports["ic"] ?? 0.0;
          const ccin = ctx.emtdcHostBridge.state.CCIN[cbs.busIdx + 1] ?? 0.0;
          ctx.J3[3 * cbs.busIdx + 0] = ctx.J3[3 * cbs.busIdx + 0]! + iaInj + ccin;
          ctx.J3[3 * cbs.busIdx + 1] = ctx.J3[3 * cbs.busIdx + 1]! + ibInj;
          ctx.J3[3 * cbs.busIdx + 2] = ctx.J3[3 * cbs.busIdx + 2]! + icInj;
        }
      }
    }

    ctx.solveFromLU3Phase(ctx.LU3, ctx.piv3, ctx.J3, ctx.v3Step);

    // Apply Thévenin compensation for surge arresters during steady-state pre-solve
    for (const arr of ctx.surgeArresters) {
      for (let p = 0; p < 3; p++) {
        const u = arr.fromIdx >= 0 ? 3 * arr.fromIdx + p : -1;
        const v = arr.toIdx >= 0 ? 3 * arr.toIdx + p : -1;
        const vOpen = (u >= 0 ? ctx.v3Step[u]! : 0.0) - (v >= 0 ? ctx.v3Step[v]! : 0.0);
        const vMag = Math.abs(vOpen);
        if (vMag > arr.vRefVolts) {
          const zTh = arr.zThPhase[p]!;
          const iCorr = Math.sign(vOpen) * ((vMag - arr.vRefVolts) / (zTh + arr.rClampOhm));
          const xTh = arr.xThPhase[p]!;
          for (let j = 0; j < ctx.nPhaseNodes; j++) {
            ctx.v3Step[j] = ctx.v3Step[j]! - xTh[j]! * iCorr;
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      ctx.vaStep[i] = ctx.v3Step[3 * i + 0]!;
      ctx.vbStep[i] = ctx.v3Step[3 * i + 1]!;
      ctx.vcStep[i] = ctx.v3Step[3 * i + 2]!;
    }

    // EMTDC Fortran / Binary UDM DSOUT post-network steady-state step
    if (ctx.emtdcHostBridge && ctx.customBlockStates.length > 0) {
      for (const cbs of ctx.customBlockStates) {
        if (cbs.busIdx >= 0) {
          const va = ctx.vaStep[cbs.busIdx]!;
          const vb = ctx.vbStep[cbs.busIdx]!;
          const vc = ctx.vcStep[cbs.busIdx]!;
          cbs.udm.ports["VA"] = va;
          cbs.udm.ports["VB"] = vb;
          cbs.udm.ports["VC"] = vc;
          cbs.udm.ports["va"] = va;
          cbs.udm.ports["vb"] = vb;
          cbs.udm.ports["vc"] = vc;
          ctx.emtdcHostBridge.state.VDC[cbs.busIdx + 1] = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
        }
      }
      ctx.emtdcHostBridge.stepDsout();
    }

    for (const br of ctx.companionBranches) {
      const [dvA, dvB, dvC] = ctx.computeCompanionDrop(br);
      const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
      const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
      const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
      br.iHistA =
        br.alphaHist * curA + br.alphaMutHist * (curB + curC) + br.vCoeffHist * (br.gEq * dvA + br.gMut * (dvB + dvC));
      br.iHistB =
        br.alphaHist * curB + br.alphaMutHist * (curA + curC) + br.vCoeffHist * (br.gEq * dvB + br.gMut * (dvA + dvC));
      br.iHistC =
        br.alphaHist * curC + br.alphaMutHist * (curA + curB) + br.vCoeffHist * (br.gEq * dvC + br.gMut * (dvA + dvB));
    }

    for (const sg of ctx.syncGenerators) {
      const thetaE = sg.omega0 * t + sg.deltaRad;
      const ePeak = sg.efPu * sg.vPeak;
      const ea = ePeak * Math.sin(thetaE);
      const eb = ePeak * Math.sin(thetaE - (2 * Math.PI) / 3);
      const ec = ePeak * Math.sin(thetaE + (2 * Math.PI) / 3);
      const diffA = ea - ctx.vaStep[sg.busIdx]!;
      const diffB = eb - ctx.vbStep[sg.busIdx]!;
      const diffC = ec - ctx.vcStep[sg.busIdx]!;
      const ia = sg.gGen * diffA + sg.iHistA;
      const ib = sg.gGen * diffB + sg.iHistB;
      const ic = sg.gGen * diffC + sg.iHistC;
      sg.iHistA = sg.alphaGen * ia + sg.gGen * diffA;
      sg.iHistB = sg.alphaGen * ib + sg.gGen * diffB;
      sg.iHistC = sg.alphaGen * ic + sg.gGen * diffC;
    }

    for (const bl of ctx.bergeronLines) {
      const { ptr, bufLen, gBerg } = bl;
      const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = computeLineHistoryCurrents(bl, true);
      const vkA = bl.fromIdx >= 0 ? ctx.vaStep[bl.fromIdx]! : 0.0;
      const vkB = bl.fromIdx >= 0 ? ctx.vbStep[bl.fromIdx]! : 0.0;
      const vkC = bl.fromIdx >= 0 ? ctx.vcStep[bl.fromIdx]! : 0.0;
      const vmA = bl.toIdx >= 0 ? ctx.vaStep[bl.toIdx]! : 0.0;
      const vmB = bl.toIdx >= 0 ? ctx.vbStep[bl.toIdx]! : 0.0;
      const vmC = bl.toIdx >= 0 ? ctx.vcStep[bl.toIdx]! : 0.0;

      if (bl.hasModal) {
        const ONE_OVER_3 = 1.0 / 3.0;
        const ONE_OVER_SQRT3 = 1.0 / Math.sqrt(3.0);
        const ikmA = bl.gSelf * vkA + bl.gMutual * (vkB + vkC) + iHistKmA;
        const ikmB = bl.gSelf * vkB + bl.gMutual * (vkA + vkC) + iHistKmB;
        const ikmC = bl.gSelf * vkC + bl.gMutual * (vkA + vkB) + iHistKmC;

        const imkA = bl.gSelf * vmA + bl.gMutual * (vmB + vmC) + iHistMkA;
        const imkB = bl.gSelf * vmB + bl.gMutual * (vmA + vmC) + iHistMkB;
        const imkC = bl.gSelf * vmC + bl.gMutual * (vmA + vmB) + iHistMkC;

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
        bl.vkBufA[ptr] = vkA;
        bl.vkBufB[ptr] = vkB;
        bl.vkBufC[ptr] = vkC;
        bl.vmBufA[ptr] = vmA;
        bl.vmBufB[ptr] = vmB;
        bl.vmBufC[ptr] = vmC;
        bl.ikmBufA[ptr] = gBerg * vkA + iHistKmA;
        bl.ikmBufB[ptr] = gBerg * vkB + iHistKmB;
        bl.ikmBufC[ptr] = gBerg * vkC + iHistKmC;
        bl.imkBufA[ptr] = gBerg * vmA + iHistMkA;
        bl.imkBufB[ptr] = gBerg * vmB + iHistMkB;
        bl.imkBufC[ptr] = gBerg * vmC + iHistMkC;
      }
      bl.ptr = (ptr + 1) % bufLen;
    }

    for (const ulm of ctx.ulmLines) {
      const vkA = ulm.fromIdx >= 0 ? ctx.vaStep[ulm.fromIdx]! : 0.0;
      const vkB = ulm.fromIdx >= 0 ? ctx.vbStep[ulm.fromIdx]! : 0.0;
      const vkC = ulm.fromIdx >= 0 ? ctx.vcStep[ulm.fromIdx]! : 0.0;
      const vmA = ulm.toIdx >= 0 ? ctx.vaStep[ulm.toIdx]! : 0.0;
      const vmB = ulm.toIdx >= 0 ? ctx.vbStep[ulm.toIdx]! : 0.0;
      const vmC = ulm.toIdx >= 0 ? ctx.vcStep[ulm.toIdx]! : 0.0;
      stepUlmLine(ulm, vkA, vkB, vkC, vmA, vmB, vmC, true);
    }

    for (const nu of ctx.nUlmLines) {
      nu.vK.fill(0);
      nu.vM.fill(0);
      if (nu.fromIdx >= 0) {
        nu.vK[0] = ctx.vaStep[nu.fromIdx]!;
        if (nu.model.nCond > 1) nu.vK[1] = ctx.vbStep[nu.fromIdx]!;
        if (nu.model.nCond > 2) nu.vK[2] = ctx.vcStep[nu.fromIdx]!;
      }
      if (nu.toIdx >= 0) {
        nu.vM[0] = ctx.vaStep[nu.toIdx]!;
        if (nu.model.nCond > 1) nu.vM[1] = ctx.vbStep[nu.toIdx]!;
        if (nu.model.nCond > 2) nu.vM[2] = ctx.vcStep[nu.toIdx]!;
      }
      stepNConductorUlm(nu.model, nu.vK, nu.vM, true);
    }
  }
}
