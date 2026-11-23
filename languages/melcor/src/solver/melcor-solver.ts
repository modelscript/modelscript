// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Coupled Severe-Accident Transient Solver.
 *
 * Integrates:
 *   1. Compressible control-volume mass & internal energy conservation (CVH) + flow paths (FL)
 *   2. Heat structure lumped thermal balances (HS)
 *   3. Core decay-heat heatup (COR)
 *   4. Zircaloy-steam parabolic oxidation & H2 generation kinetics (Urbanic-Heidrick / Cathcart-Pawel)
 */

import type { MelcorDeck, OxidationKineticsModel } from "../types.js";

export const MOLAR_MASS_ZR = 91.224; // g/mol
export const MOLAR_MASS_H2 = 2.01588; // g/mol
export const H2_PER_KG_ZR = (2.0 * MOLAR_MASS_H2) / MOLAR_MASS_ZR; // ~0.04419626 kg H2 / kg Zr
export const DELTA_H_ZR_OXIDATION = 6.45e6; // J / kg Zr oxidized

export interface MelcorSolverOptions {
  tStart?: number | undefined;
  tEnd?: number | undefined;
  dt?: number | undefined;
  rGas?: number | undefined;
  cvGas?: number | undefined;
  cdOrifice?: number | undefined;
  /** When true, holds core temperature constant (useful for isothermal oxidation validation). */
  isothermalCore?: boolean | undefined;
  /** When false, disables exothermic oxidation heat feedback into core temperature. Default true. */
  oxidationHeating?: boolean | undefined;
  /** Maximum number of recorded output samples (uniformly decimated if needed). */
  maxSamples?: number | undefined;
}

export interface MelcorCvSnapshot {
  massKg: number;
  energyJ: number;
  pressurePa: number;
  temperatureK: number;
}

export interface MelcorTimePoint {
  time: number;
  cv: Record<number, MelcorCvSnapshot>;
  flowKgS: Record<number, number>;
  hsTempK: Record<number, number>;
  coreTempK: number;
  zrOxidizedKg: number;
  h2GeneratedKg: number;
  oxidationPowerW: number;
  totalCvMassKg: number;
  totalCvEnergyJ: number;
}

export interface MelcorTransientResult {
  title: string;
  tStart: number;
  tEnd: number;
  dt: number;
  steps: number;
  trajectory: MelcorTimePoint[];
  finalState: MelcorTimePoint;
  massConservationRelErr: number;
  energyConservationRelErr: number;
}

/**
 * Evaluates parabolic Zircaloy-steam oxidation rate constant K(T) in [kg_Zr^2 / (m^4 * s)]
 * such that d(w^2)/dt = K(T), where w is oxidized Zr mass per unit cladding surface area.
 */
export function evalParabolicOxidationRateK(
  temperatureK: number,
  model: OxidationKineticsModel = "URBANIC_HEIDRICK",
): number {
  const T = Math.max(300.0, temperatureK);
  if (model === "CATHCART_PAWEL") {
    return 294.0 * Math.exp(-20100.0 / T);
  }
  // Urbanic-Heidrick (1978) — MELCOR standard default correlation
  if (T < 1853.0) {
    return 29.6 * Math.exp(-16820.0 / T);
  }
  return 87.9 * Math.exp(-16610.0 / T);
}

/**
 * Computes analytical isothermal oxidized Zr mass [kg] and H2 mass [kg] at time t [s].
 */
export function analyticalIsothermalOxidation(
  temperatureK: number,
  cladAreaM2: number,
  timeS: number,
  model: OxidationKineticsModel = "URBANIC_HEIDRICK",
  maxZrMassKg = Number.POSITIVE_INFINITY,
): { zrOxidizedKg: number; h2GeneratedKg: number; kPar: number } {
  const kPar = evalParabolicOxidationRateK(temperatureK, model);
  const w = Math.sqrt(Math.max(0.0, kPar * Math.max(0.0, timeS)));
  const zrOxidizedKg = Math.min(maxZrMassKg, cladAreaM2 * w);
  return {
    zrOxidizedKg,
    h2GeneratedKg: zrOxidizedKg * H2_PER_KG_ZR,
    kPar,
  };
}

export function solveMelcorTransient(deck: MelcorDeck, options?: MelcorSolverOptions): MelcorTransientResult {
  const tStart = options?.tStart ?? deck.exec.tStart ?? 0.0;
  const tEnd = options?.tEnd ?? (deck.exec.tEnd > tStart ? deck.exec.tEnd : 10.0);
  const rGas = options?.rGas ?? 461.52;
  const cvGas = options?.cvGas ?? 1500.0;
  const cpGas = cvGas + rGas;
  const cd = options?.cdOrifice ?? 0.85;
  const isothermalCore = options?.isothermalCore ?? false;
  const oxidationHeating = options?.oxidationHeating ?? true;
  const maxSamples = options?.maxSamples ?? 500;

  const duration = Math.max(0.0, tEnd - tStart);
  const defaultDt = deck.exec.dtInit > 0 ? Math.min(deck.exec.dtInit, deck.exec.dtMax || 1.0) : 0.01;
  const dt = Math.max(1e-6, options?.dt ?? Math.min(defaultDt, duration > 0 ? duration / 100 : 0.01));
  const steps = duration > 0 ? Math.max(1, Math.round(duration / dt)) : 0;
  const h = steps > 0 ? duration / steps : 0.0;
  const sampleStride = Math.max(1, Math.floor(steps / maxSamples));

  const cvList = Array.from(deck.controlVolumes.values());
  const flList = Array.from(deck.flowPaths.values());
  const hsList = Array.from(deck.heatStructures.values());
  const cvIndex = new Map<number, number>();
  cvList.forEach((cv, i) => cvIndex.set(cv.id, i));

  const nCv = cvList.length;
  const nHs = hsList.length;
  const hasCore = Boolean(deck.core?.present);
  const oxEnabled = Boolean(deck.core?.oxidationEnabled);

  // State layout:
  // [0 .. nCv-1]               : CV mass M_i
  // [nCv .. 2*nCv-1]           : CV internal energy U_i
  // [2*nCv .. 2*nCv+nHs-1]     : HS temperature T_hs_k
  // [2*nCv+nHs]                : Core temperature T_cor (if hasCore)
  // [2*nCv+nHs+1]              : Parabolic oxidation w^2 (if hasCore)
  const offU = nCv;
  const offHs = 2 * nCv;
  const idxCorT = offHs + nHs;
  const idxOxW2 = idxCorT + 1;
  const stateSize = hasCore ? idxOxW2 + 1 : offHs + nHs;

  const y = new Float64Array(stateSize);
  for (let i = 0; i < nCv; i++) {
    const cv = cvList[i]!;
    const vol = Math.max(1e-4, cv.volume);
    const m0 = (cv.pressure * vol) / (rGas * cv.temperature);
    const u0 = m0 * cvGas * cv.temperature;
    y[i] = m0;
    y[offU + i] = u0;
  }
  for (let k = 0; k < nHs; k++) {
    y[offHs + k] = hsList[k]!.initialTemperature;
  }
  if (hasCore && deck.core) {
    y[idxCorT] = deck.core.initialTemperatureK;
    y[idxOxW2] = 0.0;
  }

  const computeFlows = (state: Float64Array, outFlows: Float64Array): void => {
    for (let j = 0; j < flList.length; j++) {
      const fl = flList[j]!;
      const iFrom = cvIndex.get(fl.fromCv);
      const iTo = cvIndex.get(fl.toCv);
      if (iFrom === undefined || iTo === undefined) {
        outFlows[j] = 0.0;
        continue;
      }
      const cvFrom = cvList[iFrom]!;
      const cvTo = cvList[iTo]!;
      const mFrom = Math.max(1e-12, state[iFrom]!);
      const uFrom = Math.max(1e-12, state[offU + iFrom]!);
      const tFrom = cvFrom.cvType === "TIME_INDEPENDENT" ? cvFrom.temperature : uFrom / (mFrom * cvGas);
      const pFrom =
        cvFrom.cvType === "TIME_INDEPENDENT" ? cvFrom.pressure : (mFrom * rGas * tFrom) / Math.max(1e-4, cvFrom.volume);
      const rhoFrom = mFrom / Math.max(1e-4, cvFrom.volume);

      const mTo = Math.max(1e-12, state[iTo]!);
      const uTo = Math.max(1e-12, state[offU + iTo]!);
      const tTo = cvTo.cvType === "TIME_INDEPENDENT" ? cvTo.temperature : uTo / (mTo * cvGas);
      const pTo = cvTo.cvType === "TIME_INDEPENDENT" ? cvTo.pressure : (mTo * rGas * tTo) / Math.max(1e-4, cvTo.volume);
      const rhoTo = mTo / Math.max(1e-4, cvTo.volume);

      const dp = pFrom - pTo;
      const sign = dp >= 0 ? 1.0 : -1.0;
      const rhoUp = dp >= 0 ? rhoFrom : rhoTo;
      const kLoss = dp >= 0 ? Math.max(0.0, fl.forwardLoss) : Math.max(0.0, fl.reverseLoss);
      const aEff = Math.max(0.0, fl.area * Math.max(0.0, fl.openFraction));
      outFlows[j] = sign * ((cd * aEff) / Math.sqrt(1.0 + kLoss)) * Math.sqrt(2.0 * rhoUp * Math.abs(dp));
    }
  };

  const flowsTmp = new Float64Array(flList.length);

  const evalRhs = (state: Float64Array, dydt: Float64Array): { qOxW: number } => {
    dydt.fill(0.0);
    computeFlows(state, flowsTmp);

    // 1. Flow path advection between CVs (exact mass & energy conservation)
    for (let j = 0; j < flList.length; j++) {
      const fl = flList[j]!;
      const mdot = flowsTmp[j]!;
      const iFrom = cvIndex.get(fl.fromCv);
      const iTo = cvIndex.get(fl.toCv);
      if (iFrom === undefined || iTo === undefined) continue;

      const cvFrom = cvList[iFrom]!;
      const cvTo = cvList[iTo]!;
      const tFrom =
        cvFrom.cvType === "TIME_INDEPENDENT"
          ? cvFrom.temperature
          : state[offU + iFrom]! / (Math.max(1e-12, state[iFrom]!) * cvGas);
      const tTo =
        cvTo.cvType === "TIME_INDEPENDENT"
          ? cvTo.temperature
          : state[offU + iTo]! / (Math.max(1e-12, state[iTo]!) * cvGas);
      const tUp = mdot >= 0 ? tFrom : tTo;
      const hFlux = mdot * cpGas * tUp;

      if (cvFrom.cvType !== "TIME_INDEPENDENT") {
        dydt[iFrom] = dydt[iFrom]! - mdot;
        dydt[offU + iFrom] = dydt[offU + iFrom]! - hFlux;
      }
      if (cvTo.cvType !== "TIME_INDEPENDENT") {
        dydt[iTo] = dydt[iTo]! + mdot;
        dydt[offU + iTo] = dydt[offU + iTo]! + hFlux;
      }
    }

    // 2. Heat structures
    for (let k = 0; k < nHs; k++) {
      const hs = hsList[k]!;
      const tHs = state[offHs + k]!;
      let qNet = hs.heatSourceW;
      if (hs.leftBoundaryCv !== undefined) {
        const iL = cvIndex.get(hs.leftBoundaryCv);
        if (iL !== undefined) {
          const cvL = cvList[iL]!;
          const tL =
            cvL.cvType === "TIME_INDEPENDENT"
              ? cvL.temperature
              : state[offU + iL]! / (Math.max(1e-12, state[iL]!) * cvGas);
          const qL = hs.leftHtc * hs.surfaceArea * (tHs - tL);
          qNet -= qL;
          if (cvL.cvType !== "TIME_INDEPENDENT") {
            dydt[offU + iL] = dydt[offU + iL]! + qL;
          }
        }
      }
      if (hs.rightBoundaryCv !== undefined) {
        const iR = cvIndex.get(hs.rightBoundaryCv);
        if (iR !== undefined) {
          const cvR = cvList[iR]!;
          const tR =
            cvR.cvType === "TIME_INDEPENDENT"
              ? cvR.temperature
              : state[offU + iR]! / (Math.max(1e-12, state[iR]!) * cvGas);
          const qR = hs.rightHtc * hs.surfaceArea * (tHs - tR);
          qNet -= qR;
          if (cvR.cvType !== "TIME_INDEPENDENT") {
            dydt[offU + iR] = dydt[offU + iR]! + qR;
          }
        }
      }
      dydt[offHs + k] = qNet / Math.max(1.0, hs.mass * hs.specificHeat);
    }

    // 3. Core decay heat & Zircaloy-steam oxidation
    let qOxW = 0.0;
    if (hasCore && deck.core) {
      const tCor = state[idxCorT]!;
      const wSq = Math.max(0.0, state[idxOxW2]!);
      const area = Math.max(0.0, deck.core.cladAreaM2);
      const maxW = area > 0 ? deck.core.cladZrMassKg / area : 0.0;

      if (oxEnabled && area > 0 && wSq < maxW * maxW) {
        const kPar = evalParabolicOxidationRateK(tCor, deck.core.oxidationModel);
        dydt[idxOxW2] = kPar;
        const wEff = Math.max(1e-6, Math.sqrt(wSq));
        const dwDt = kPar / (2.0 * wEff);
        qOxW = area * dwDt * DELTA_H_ZR_OXIDATION;
      }

      if (!isothermalCore) {
        const cCore = Math.max(1.0, deck.core.coreMassKg * deck.core.coreSpecificHeatJkgK);
        const qTotal = deck.core.decayHeatW + (oxidationHeating ? qOxW : 0.0);
        dydt[idxCorT] = qTotal / cCore;
      }
    }

    return { qOxW };
  };

  const makeSnapshot = (time: number, state: Float64Array, qOxW: number): MelcorTimePoint => {
    computeFlows(state, flowsTmp);
    const cvSnap: Record<number, MelcorCvSnapshot> = {};
    let totalCvMassKg = 0.0;
    let totalCvEnergyJ = 0.0;
    for (let i = 0; i < nCv; i++) {
      const cv = cvList[i]!;
      const m = state[i]!;
      const u = state[offU + i]!;
      const tK = cv.cvType === "TIME_INDEPENDENT" ? cv.temperature : u / (Math.max(1e-12, m) * cvGas);
      const pPa = cv.cvType === "TIME_INDEPENDENT" ? cv.pressure : (m * rGas * tK) / Math.max(1e-4, cv.volume);
      cvSnap[cv.id] = { massKg: m, energyJ: u, pressurePa: pPa, temperatureK: tK };
      totalCvMassKg += m;
      totalCvEnergyJ += u;
    }

    const flowKgS: Record<number, number> = {};
    for (let j = 0; j < flList.length; j++) {
      flowKgS[flList[j]!.id] = flowsTmp[j]!;
    }

    const hsTempK: Record<number, number> = {};
    for (let k = 0; k < nHs; k++) {
      hsTempK[hsList[k]!.id] = state[offHs + k]!;
    }

    let coreTempK = 0.0;
    let zrOxidizedKg = 0.0;
    let h2GeneratedKg = 0.0;
    if (hasCore && deck.core) {
      coreTempK = state[idxCorT]!;
      const wSq = Math.max(0.0, state[idxOxW2]!);
      zrOxidizedKg = Math.min(deck.core.cladZrMassKg, deck.core.cladAreaM2 * Math.sqrt(wSq));
      h2GeneratedKg = zrOxidizedKg * H2_PER_KG_ZR;
    }

    return {
      time,
      cv: cvSnap,
      flowKgS,
      hsTempK,
      coreTempK,
      zrOxidizedKg,
      h2GeneratedKg,
      oxidationPowerW: qOxW,
      totalCvMassKg,
      totalCvEnergyJ,
    };
  };

  const k1 = new Float64Array(stateSize);
  const k2 = new Float64Array(stateSize);
  const k3 = new Float64Array(stateSize);
  const k4 = new Float64Array(stateSize);
  const yTmp = new Float64Array(stateSize);

  const initEval = evalRhs(y, k1);
  const initialSnapshot = makeSnapshot(tStart, y, initEval.qOxW);
  const trajectory: MelcorTimePoint[] = [initialSnapshot];

  let t = tStart;
  let lastQOxW = initEval.qOxW;

  for (let step = 1; step <= steps; step++) {
    evalRhs(y, k1);

    for (let i = 0; i < stateSize; i++) yTmp[i] = y[i]! + 0.5 * h * k1[i]!;
    evalRhs(yTmp, k2);

    for (let i = 0; i < stateSize; i++) yTmp[i] = y[i]! + 0.5 * h * k2[i]!;
    evalRhs(yTmp, k3);

    for (let i = 0; i < stateSize; i++) yTmp[i] = y[i]! + h * k3[i]!;
    const endEval = evalRhs(yTmp, k4);
    lastQOxW = endEval.qOxW;

    for (let i = 0; i < stateSize; i++) {
      y[i] = y[i]! + (h / 6.0) * (k1[i]! + 2.0 * k2[i]! + 2.0 * k3[i]! + k4[i]!);
    }

    // Clamp parabolic oxidation state to available Zr inventory
    if (hasCore && deck.core && oxEnabled && deck.core.cladAreaM2 > 0) {
      const maxW = deck.core.cladZrMassKg / deck.core.cladAreaM2;
      if (y[idxOxW2]! > maxW * maxW) y[idxOxW2] = maxW * maxW;
    }

    t = tStart + step * h;

    if (step % sampleStride === 0 || step === steps) {
      trajectory.push(makeSnapshot(t, y, lastQOxW));
    }
  }

  const finalState = trajectory[trajectory.length - 1] ?? initialSnapshot;
  const massConservationRelErr =
    initialSnapshot.totalCvMassKg > 0
      ? Math.abs(finalState.totalCvMassKg - initialSnapshot.totalCvMassKg) / initialSnapshot.totalCvMassKg
      : 0.0;
  const energyConservationRelErr =
    initialSnapshot.totalCvEnergyJ > 0
      ? Math.abs(finalState.totalCvEnergyJ - initialSnapshot.totalCvEnergyJ) / initialSnapshot.totalCvEnergyJ
      : 0.0;

  return {
    title: deck.title,
    tStart,
    tEnd,
    dt: h,
    steps,
    trajectory,
    finalState,
    massConservationRelErr,
    energyConservationRelErr,
  };
}
