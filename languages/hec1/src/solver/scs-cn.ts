// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * USACE HEC-1 Rainfall Loss Models:
 *   - SCS Curve Number (`LS` card): Q = (P - Ia)^2 / (P - Ia + S)
 *   - Initial & Constant / Uniform Loss (`LU` card)
 *   - Exponential Loss (`LE` card)
 */

import type { Hec1LossParams, Hec1UnitSystem } from "../types.js";

/**
 * Computes SCS potential maximum retention S from Curve Number CN.
 *   - English (in):  S = 1000 / CN - 10
 *   - Metric  (mm):  S = 25400 / CN - 254
 */
export function computePotentialRetention(cn: number, unitSystem: Hec1UnitSystem = "English"): number {
  const safeCn = Math.max(1e-6, Math.min(100.0, cn));
  if (unitSystem === "Metric") {
    return 25400.0 / safeCn - 254.0;
  }
  return 1000.0 / safeCn - 10.0;
}

/**
 * Computes exact SCS Curve Number cumulative rainfall-excess Q for cumulative precipitation P:
 *   Q_perv = (P - Ia)^2 / (P - Ia + S)   for P > Ia, else 0
 *   Q_tot  = (1 - f_imp) * Q_perv + f_imp * P
 */
export function computeScsExcessRunoff(
  cumulativeP: number,
  cn: number,
  initialAbstraction?: number,
  unitSystem: Hec1UnitSystem = "English",
  rtimpPercent = 0,
): number {
  if (cumulativeP <= 0) return 0.0;
  const s = computePotentialRetention(cn, unitSystem);
  const ia = initialAbstraction !== undefined && Number.isFinite(initialAbstraction) ? initialAbstraction : 0.2 * s;
  const fImp = Math.max(0.0, Math.min(1.0, rtimpPercent / 100.0));

  let qPerv = 0.0;
  if (cumulativeP > ia) {
    const num = cumulativeP - ia;
    const denom = num + s;
    qPerv = denom > 0 ? (num * num) / denom : num;
  }

  return (1.0 - fImp) * qPerv + fImp * cumulativeP;
}

/**
 * Converts an incremental precipitation hyetograph into an incremental excess-rainfall
 * hyetograph using the specified HEC-1 loss model (`LS`, `LU`, or `LE`).
 */
export function computeExcessHyetograph(
  incrementalPrecip: readonly number[],
  loss: Hec1LossParams | undefined,
  dtHours: number,
  unitSystem: Hec1UnitSystem = "English",
): number[] {
  if (!loss) {
    return incrementalPrecip.map((p) => Math.max(0, p));
  }

  if (loss.method === "SCS") {
    const excess: number[] = [];
    let cumP = 0.0;
    let prevQ = 0.0;
    for (let i = 0; i < incrementalPrecip.length; i++) {
      cumP += Math.max(0, incrementalPrecip[i]!);
      const cumQ = computeScsExcessRunoff(cumP, loss.curveNumber, loss.strtl, unitSystem, loss.rtimp);
      const incQ = Math.max(0.0, cumQ - prevQ);
      excess.push(incQ);
      prevQ = cumQ;
    }
    return excess;
  }

  if (loss.method === "Uniform") {
    const excess: number[] = [];
    const fImp = Math.max(0.0, Math.min(1.0, loss.rtimp / 100.0));
    let remainingInitial = Math.max(0.0, loss.strtl);
    const constLossPerStep = Math.max(0.0, loss.cnstl) * dtHours;

    for (let i = 0; i < incrementalPrecip.length; i++) {
      const p = Math.max(0.0, incrementalPrecip[i]!);
      let pAvail = p;
      if (remainingInitial > 0) {
        const used = Math.min(remainingInitial, pAvail);
        remainingInitial -= used;
        pAvail -= used;
      }
      const qPerv = Math.max(0.0, pAvail - constLossPerStep);
      excess.push((1.0 - fImp) * qPerv + fImp * p);
    }
    return excess;
  }

  // Exponential loss (HEC-1 LE card)
  const excess: number[] = [];
  const fImp = Math.max(0.0, Math.min(1.0, loss.rtimp / 100.0));
  let cumLoss = 0.0;
  let dltkrRem = Math.max(0.0, loss.dltkr);
  for (let i = 0; i < incrementalPrecip.length; i++) {
    const p = Math.max(0.0, incrementalPrecip[i]!);
    const intensity = dtHours > 0 ? p / dtHours : p;
    const ak = loss.strkr / Math.pow(Math.max(1.0, loss.rtiql), 0.1 * cumLoss);
    const dlt = dltkrRem > 0 ? 0.2 * dltkrRem * Math.pow(1.0 - cumLoss / Math.max(1e-6, loss.dltkr), 2) : 0.0;
    const lossRate = (ak + dlt) * Math.pow(Math.max(0, intensity), loss.erain);
    const stepLoss = Math.min(p, lossRate * dtHours);
    cumLoss += stepLoss;
    dltkrRem = Math.max(0.0, dltkrRem - stepLoss);
    const qPerv = Math.max(0.0, p - stepLoss);
    excess.push((1.0 - fImp) * qPerv + fImp * p);
  }
  return excess;
}
