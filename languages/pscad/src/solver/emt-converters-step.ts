// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Power-Electronic Converters & IBR Time-Stepping
 *
 * Implements:
 * - IBR / FMU converter injection updates (`fmi-ls-emt` companion doStep & LVRT reactive support)
 * - 6-arm 3-phase Detailed Equivalent Model (DEM) MMC initialization & NLM/CCSC stepping
 * - 6-pulse LCC (commutation overlap/extinction) & 2-level switched VSC PWM converter bridges
 */

import type { EmtNetlist } from "../types.js";
import type {
  BusInfo,
  ConverterBridgeRuntimeState,
  FmuState,
  MmcRuntimeState,
  SourceInfo,
} from "./emt-solver-types.js";

/**
 * Initializes Detailed Equivalent Model (DEM) MMC arm submodule capacitor states,
 * registers MMC control signal trajectories, and registers arm Norton source conductances.
 */
export function initMmcRuntimeStates(
  netlist: EmtNetlist,
  busIdxMap: ReadonlyMap<string, number>,
  busSources: Map<number, SourceInfo[]>,
  controlSignals: Map<string, Float64Array>,
  nSteps: number,
  omega: number,
  mmcSourcesRegistered: boolean,
): { mmcRuntimeStates: MmcRuntimeState[]; mmcSourcesRegistered: boolean } {
  const mmcBridges = (netlist.converterBridges ?? []).filter(
    (c) => c.kind === "mmc_thevenin" || c.kind === "mmc_valve_gpu",
  );
  const mmcRuntimeStates: MmcRuntimeState[] = mmcBridges.map((mmc) => {
    const nSm = Math.max(4, mmc.numSubmodulesPerArm || 16);
    const vDcKv = mmc.vDcNominalKv || 400.0;
    const vSmNomKv = vDcKv / nSm;
    const makeArms = () =>
      [0, 1, 2].map((p) => {
        const arr = new Float64Array(nSm);
        for (let i = 0; i < nSm; i++) {
          arr[i] = vSmNomKv * (1.0 + 0.01 * (((i + p) % 3) - 1));
        }
        return arr;
      }) as [Float64Array, Float64Array, Float64Array];
    const vCapUpper = makeArms();
    const vCapLower = makeArms();
    const upperSumTraj = new Float64Array(nSteps);
    const lowerSumTraj = new Float64Array(nSteps);
    const spreadPctTraj = new Float64Array(nSteps);
    const iCircATraj = new Float64Array(nSteps);
    controlSignals.set(`${mmc.id}_vCapUpperSum`, upperSumTraj);
    controlSignals.set(`${mmc.id}_vCapLowerSum`, lowerSumTraj);
    controlSignals.set(`${mmc.id}_spreadPct`, spreadPctTraj);
    controlSignals.set(`${mmc.id}_iCircA`, iCircATraj);
    const busIdx = busIdxMap.get(mmc.acBus);
    const zBase = (mmc.ratedKvLL * mmc.ratedKvLL) / Math.max(1.0, mmc.ratedMva);
    const gArm = 1.0 / Math.max(0.5, 0.15 * zBase);
    if (busIdx !== undefined && !mmcSourcesRegistered) {
      const list = busSources.get(busIdx) ?? [];
      list.push({ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gArm });
      busSources.set(busIdx, list);
    }
    return {
      mmc,
      busIdx,
      gArm,
      lArmH: Math.max(1e-3, mmc.armInductanceH ?? (0.15 * zBase) / omega),
      vAcA: 0.0,
      vAcB: 0.0,
      vAcC: 0.0,
      iCirc: [0.0, 0.0, 0.0] as [number, number, number],
      nSm,
      vDcKv,
      cSmFarad: Math.max(1e-4, mmc.submoduleCapacitanceF || 0.01),
      vCapUpper,
      vCapLower,
      upperSumTraj,
      lowerSumTraj,
      spreadPctTraj,
      iCircATraj,
    };
  });
  return {
    mmcRuntimeStates,
    mmcSourcesRegistered: mmcSourcesRegistered || mmcBridges.length > 0,
  };
}

/**
 * Updates IBR / FMU converter injection currents and LVRT reactive current support state.
 */
export function stepIbrFmuConverters(
  fmuStates: readonly FmuState[],
  busList: readonly BusInfo[],
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  omega: number,
  timeStepSec: number,
  t: number,
  k: number,
  anyFaultActive: boolean,
): void {
  const tauLvrt = 0.008;
  const alphaLvrt = 1.0 - Math.exp(-timeStepSec / tauLvrt);
  for (const fmuState of fmuStates) {
    const { busIdx, iRatedPeak, ia, ib, ic } = fmuState;
    const vaInst = vaStep[busIdx]!;
    const vbInst = vbStep[busIdx]!;
    const vcInst = vcStep[busIdx]!;
    if (fmuState.companion) {
      fmuState.companion.doStep(t, timeStepSec, [vaInst, vbInst, vcInst]);
      const g = fmuState.lastGEq!;
      const ih = fmuState.lastIHist!;
      ia[k] = ih[0]! - (g[0]! * vaInst + g[1]! * vbInst + g[2]! * vcInst);
      ib[k] = ih[1]! - (g[3]! * vaInst + g[4]! * vbInst + g[5]! * vcInst);
      ic[k] = ih[2]! - (g[6]! * vaInst + g[7]! * vbInst + g[8]! * vcInst);
      continue;
    }
    const vNomPeak = busList[busIdx]!.vPeak;
    const vEnv = Math.sqrt((2.0 / 3.0) * (vaInst * vaInst + vbInst * vbInst + vcInst * vcInst));
    const vPu = vNomPeak > 0 ? vEnv / vNomPeak : 1.0;

    const isVoltageDip = anyFaultActive || vPu < 0.9;
    const iqTarget = isVoltageDip ? 0.85 * iRatedPeak : 0.0;
    fmuState.iqState = isVoltageDip ? fmuState.iqState + alphaLvrt * (iqTarget - fmuState.iqState) : 0.0;
    const id = isVoltageDip ? 0.35 * iRatedPeak : 0.7 * iRatedPeak;
    const iq = fmuState.iqState;

    ia[k] = id * Math.sin(omega * t) - iq * Math.cos(omega * t);
    ib[k] = id * Math.sin(omega * t - (2 * Math.PI) / 3) - iq * Math.cos(omega * t - (2 * Math.PI) / 3);
    ic[k] = id * Math.sin(omega * t + (2 * Math.PI) / 3) - iq * Math.cos(omega * t + (2 * Math.PI) / 3);
  }
}

/**
 * Steps 6-arm 3-phase Detailed Equivalent Model (DEM) MMCs with Nearest Level Modulation (NLM)
 * capacitor sorting and Circulating Current Suppressing Control (CCSC).
 */
export function stepMmcConverters(
  mmcRuntimeStates: readonly MmcRuntimeState[],
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  omega: number,
  timeStepSec: number,
  t: number,
  k: number,
): void {
  for (const ms of mmcRuntimeStates) {
    const { nSm, vDcKv, cSmFarad, vCapUpper, vCapLower, lArmH, iCirc } = ms;
    const dt = timeStepSec;
    const mMod: [number, number, number] = [
      0.85 * Math.sin(omega * t),
      0.85 * Math.sin(omega * t - (2 * Math.PI) / 3),
      0.85 * Math.sin(omega * t + (2 * Math.PI) / 3),
    ];
    const vBusPh: [number, number, number] =
      ms.busIdx !== undefined ? [vaStep[ms.busIdx] ?? 0, vbStep[ms.busIdx] ?? 0, vcStep[ms.busIdx] ?? 0] : [0, 0, 0];
    const vAcPrev: [number, number, number] = [ms.vAcA, ms.vAcB, ms.vAcC];
    const vAcOut: [number, number, number] = [0, 0, 0];

    let sumUpperA = 0.0;
    let sumLowerA = 0.0;
    let vMin = Infinity;
    let vMax = -Infinity;

    for (let p = 0; p < 3; p++) {
      const capUp = vCapUpper[p]!;
      const capLo = vCapLower[p]!;
      // CCSC (Circulating Current Suppressing Control): damp 2nd-harmonic common-mode arm current
      const vDiffCcsc = -0.25 * ms.lArmH * omega * iCirc[p]!;
      const mCcsc = vDcKv > 0 ? Math.max(-0.08, Math.min(0.08, vDiffCcsc / (0.5 * vDcKv * 1e3))) : 0;
      const nUpper = Math.max(0, Math.min(nSm, Math.round(0.5 * nSm * (1.0 - mMod[p]! - mCcsc))));
      const nLower = Math.max(0, Math.min(nSm, Math.round(0.5 * nSm * (1.0 + mMod[p]! - mCcsc))));

      const iPhaseAc =
        ms.busIdx !== undefined
          ? ms.gArm * (vAcPrev[p]! - vBusPh[p]!)
          : 400.0 * Math.sin(omega * t - (p * 2 * Math.PI) / 3 - 0.15);
      const iUpperAmp = 0.5 * iPhaseAc + iCirc[p]!;
      const iLowerAmp = -0.5 * iPhaseAc + iCirc[p]!;

      const upperIdx = Array.from({ length: nSm }, (_, i) => i).sort((a, b) =>
        iUpperAmp >= 0 ? capUp[a]! - capUp[b]! : capUp[b]! - capUp[a]!,
      );
      const lowerIdx = Array.from({ length: nSm }, (_, i) => i).sort((a, b) =>
        iLowerAmp >= 0 ? capLo[a]! - capLo[b]! : capLo[b]! - capLo[a]!,
      );

      const dvUpKv = ((iUpperAmp * dt) / cSmFarad) * 1e-3;
      const dvLoKv = ((iLowerAmp * dt) / cSmFarad) * 1e-3;
      let insertedUpperKv = 0;
      let insertedLowerKv = 0;
      for (let m = 0; m < nUpper; m++) {
        const idx = upperIdx[m]!;
        capUp[idx] = Math.max(0.1, capUp[idx]! + dvUpKv);
        insertedUpperKv += capUp[idx]!;
      }
      for (let m = 0; m < nLower; m++) {
        const idx = lowerIdx[m]!;
        capLo[idx] = Math.max(0.1, capLo[idx]! + dvLoKv);
        insertedLowerKv += capLo[idx]!;
      }
      vAcOut[p] = 0.5 * (insertedLowerKv - insertedUpperKv) * 1e3;

      // Common-mode circulating current ODE: L_arm * d(i_circ)/dt = 0.5*(V_dc - V_up - V_lo) - R_arm*i_circ
      const vCircDrive = 0.5 * (vDcKv - insertedUpperKv - insertedLowerKv) * 1e3;
      const rArm = Math.max(0.02, 0.05 * lArmH * omega);
      iCirc[p] = (iCirc[p]! + (dt / lArmH) * vCircDrive) / (1.0 + (rArm * dt) / lArmH);

      if (p === 0) {
        for (let i = 0; i < nSm; i++) {
          const vu = capUp[i]!;
          const vl = capLo[i]!;
          sumUpperA += vu;
          sumLowerA += vl;
          if (vu < vMin) vMin = vu;
          if (vu > vMax) vMax = vu;
        }
      }
    }

    ms.vAcA = vAcOut[0];
    ms.vAcB = vAcOut[1];
    ms.vAcC = vAcOut[2];
    ms.upperSumTraj[k] = sumUpperA;
    ms.lowerSumTraj[k] = sumLowerA;
    ms.spreadPctTraj[k] = vDcKv > 0 ? ((vMax - vMin) / (vDcKv / nSm)) * 100.0 : 0.0;
    ms.iCircATraj[k] = iCirc[0];
  }
}

/**
 * Steps switched 2-level VSC PWM and 6-pulse LCC converter bridges
 * (with commutation overlap/extinction angles and DC-link capacitor power balance).
 */
export function stepConverterBridges(
  bridgeRuntimeStates: readonly ConverterBridgeRuntimeState[],
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  omega: number,
  timeStepSec: number,
  t: number,
  k: number,
): void {
  const SQRT3 = Math.sqrt(3.0);
  for (const br of bridgeRuntimeStates) {
    const dt = timeStepSec;
    const va = vaStep[br.acBusIdx] ?? 0;
    const vb = vbStep[br.acBusIdx] ?? 0;
    const vc = vcStep[br.acBusIdx] ?? 0;
    const vAlpha = (2.0 * va - vb - vc) / 3.0;
    const vBeta = (vb - vc) / SQRT3;
    const vMag = Math.hypot(vAlpha, vBeta);
    const phase = vMag > 1e-3 ? Math.atan2(vBeta, vAlpha) : omega * t;
    br.thetaPll = phase;

    if (br.conv.kind === "lcc_6pulse") {
      const alphaRad = ((br.conv.firingAngleDeg ?? 15.0) * Math.PI) / 180.0;
      const vLlRms = vMag > 1e-3 ? (vMag * Math.SQRT2 > 0 ? (vMag * SQRT3) / Math.SQRT2 : 0) : br.conv.ratedKvLL * 1e3;
      const vAcBase = Math.max(10.0, vLlRms);
      const xCommOhm = 0.08 * ((br.conv.ratedKvLL * br.conv.ratedKvLL) / Math.max(1.0, br.conv.ratedMva));
      const vNoLoadDc = ((3.0 * Math.SQRT2) / Math.PI) * vAcBase * Math.cos(alphaRad);
      const vDropComm = ((3.0 * xCommOhm) / Math.PI) * br.iDcAmp;
      const vDcRect = Math.max(0.0, vNoLoadDc - vDropComm);
      const cosAlphaMinusOverlap = Math.max(
        -0.99,
        Math.min(1.0, Math.cos(alphaRad) - (2.0 * xCommOhm * br.iDcAmp) / (Math.SQRT2 * vAcBase)),
      );
      br.muRad = Math.max(0.01, Math.acos(cosAlphaMinusOverlap) - alphaRad);
      br.gammaRad = Math.max(0.0, Math.PI - alphaRad - br.muRad);

      const lDcSmooth = 0.05;
      br.iDcAmp = Math.max(0.0, (br.iDcAmp + (dt / lDcSmooth) * vDcRect) / (1.0 + (br.rDcLoadOhm * dt) / lDcSmooth));
      br.vDcVolts = vDcRect;
      br.vDcTraj[k] = vDcRect * 1e-3;
      if (br.iDcTraj) br.iDcTraj[k] = br.iDcAmp;
      if (br.muDegTraj) br.muDegTraj[k] = (br.muRad * 180.0) / Math.PI;
      if (br.gammaDegTraj) br.gammaDegTraj[k] = (br.gammaRad * 180.0) / Math.PI;

      // Record actual 6-pulse line currents
      const ia = br.iDcAmp * Math.cos(phase - alphaRad);
      const ib = br.iDcAmp * Math.cos(phase - alphaRad - (2 * Math.PI) / 3);
      const ic = br.iDcAmp * Math.cos(phase - alphaRad + (2 * Math.PI) / 3);
      br.ia[k] = ia;
      br.ib[k] = ib;
      br.ic[k] = ic;
    } else {
      const vDcHalf = 0.5 * Math.max(100.0, br.vDcVolts);
      const vRefD = br.vPeakNom;
      const pRefW = (br.conv.pRefMw ?? br.conv.ratedMva * 0.8) * 1e6;
      const qRefVar = (br.conv.qRefMvar ?? 0.0) * 1e6;
      const idRef = Math.max(-br.iRatedPeak, Math.min(br.iRatedPeak, pRefW / Math.max(1.0, 1.5 * vRefD)));
      const vErrQ = br.vPeakNom > 0 ? (br.vPeakNom - vMag) / br.vPeakNom : 0;
      const iqRef =
        br.conv.controlMode === "pq"
          ? Math.max(-br.iRatedPeak, Math.min(br.iRatedPeak, -qRefVar / Math.max(1.0, 1.5 * vRefD)))
          : Math.max(-0.5 * br.iRatedPeak, Math.min(0.5 * br.iRatedPeak, 2.0 * br.iRatedPeak * vErrQ));

      const sinP = Math.sin(phase);
      const cosP = Math.cos(phase);
      const diffA = br.vPoleA - va;
      const diffB = br.vPoleB - vb;
      const diffC = br.vPoleC - vc;
      const ia = br.gChoke * diffA + br.iHistChokeA;
      const ib = br.gChoke * diffB + br.iHistChokeB;
      const ic = br.gChoke * diffC + br.iHistChokeC;
      br.iHistChokeA = br.alphaChoke * ia + br.gChoke * diffA;
      br.iHistChokeB = br.alphaChoke * ib + br.gChoke * diffB;
      br.iHistChokeC = br.alphaChoke * ic + br.gChoke * diffC;
      br.ia[k] = ia;
      br.ib[k] = ib;
      br.ic[k] = ic;

      const idMeas =
        (2.0 / 3.0) * (ia * cosP + ib * Math.cos(phase - (2 * Math.PI) / 3) + ic * Math.cos(phase + (2 * Math.PI) / 3));
      const iqMeas =
        -(2.0 / 3.0) *
        (ia * sinP + ib * Math.sin(phase - (2 * Math.PI) / 3) + ic * Math.sin(phase + (2 * Math.PI) / 3));
      const errD = idRef - idMeas;
      const errQ = iqRef - iqMeas;
      const zAcScale = br.vPeakNom / Math.max(1.0, br.iRatedPeak);
      br.intErrD = Math.max(
        -0.35 * br.vPeakNom,
        Math.min(0.35 * br.vPeakNom, br.intErrD + errD * zAcScale * dt * 25.0),
      );
      br.intErrQ = Math.max(
        -0.35 * br.vPeakNom,
        Math.min(0.35 * br.vPeakNom, br.intErrQ + errQ * zAcScale * dt * 25.0),
      );
      const kp = 0.12 * zAcScale;
      const vdMod = Math.max(-vDcHalf, Math.min(vDcHalf, vMag + kp * errD + br.intErrD));
      const vqMod = Math.max(-vDcHalf, Math.min(vDcHalf, kp * errQ + br.intErrQ));

      const mA = Math.max(-0.98, Math.min(0.98, (vdMod * cosP - vqMod * sinP) / vDcHalf));
      const mB = Math.max(
        -0.98,
        Math.min(
          0.98,
          (vdMod * Math.cos(phase - (2 * Math.PI) / 3) - vqMod * Math.sin(phase - (2 * Math.PI) / 3)) / vDcHalf,
        ),
      );
      const mC = Math.max(
        -0.98,
        Math.min(
          0.98,
          (vdMod * Math.cos(phase + (2 * Math.PI) / 3) - vqMod * Math.sin(phase + (2 * Math.PI) / 3)) / vDcHalf,
        ),
      );

      const fSw = Math.max(200.0, br.conv.carrierFreqHz ?? 2000.0);
      if (fSw * dt <= 0.15) {
        // Discrete switched 2-level carrier comparison when carrier is resolved by dt
        const tri = 4.0 * Math.abs(((t * fSw) % 1.0) - 0.5) - 1.0;
        br.vPoleA = (mA >= tri ? 1.0 : -1.0) * vDcHalf;
        br.vPoleB = (mB >= tri ? 1.0 : -1.0) * vDcHalf;
        br.vPoleC = (mC >= tri ? 1.0 : -1.0) * vDcHalf;
      } else {
        // Sub-step averaged PWM pole voltage
        br.vPoleA = mA * vDcHalf;
        br.vPoleB = mB * vDcHalf;
        br.vPoleC = mC * vDcHalf;
      }

      // DC link capacitor power balance
      const pAcW = va * ia + vb * ib + vc * ic;
      const iDcAc = pAcW / Math.max(100.0, br.vDcVolts);
      const iDcSrc =
        pRefW >= 0
          ? Math.max(
              0.0,
              (br.vDcRefVolts - br.vDcVolts) / Math.max(1.0, 0.05 * br.rDcLoadOhm) +
                pRefW / Math.max(100.0, br.vDcVolts),
            )
          : 0.0;
      const iDcSink = pRefW < 0 ? br.vDcVolts / br.rDcLoadOhm : 0.0;
      br.vDcVolts = Math.max(
        100.0,
        Math.min(2.0 * br.vDcRefVolts, br.vDcVolts + (dt / br.cDcFarad) * (iDcSrc - iDcAc - iDcSink)),
      );
      br.iDcAmp = pRefW >= 0 ? iDcAc : iDcSink;
      br.vDcTraj[k] = br.vDcVolts * 1e-3;
      if (br.pMwTraj) br.pMwTraj[k] = pAcW * 1e-6;
      if (br.qMvarTraj) {
        const vaP = (vb - vc) / SQRT3;
        const vbP = (vc - va) / SQRT3;
        const vcP = (va - vb) / SQRT3;
        br.qMvarTraj[k] = (vaP * ia + vbP * ib + vcP * ic) * 1e-6;
      }
      if (br.mIndexTraj) br.mIndexTraj[k] = Math.hypot(vdMod, vqMod) / vDcHalf;
    }
  }
}
