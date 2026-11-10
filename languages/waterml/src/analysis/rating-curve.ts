// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Hydrologic Stage-Discharge Rating Curve & Quality Control Analysis.
 *
 * Provides power-law rating equation evaluation, inverse solving, piecewise-linear table
 * interpolation, QC filtering, and log-linear least-squares parameter fitting with RMSE
 * and residual metrics.
 */

import type { RatingCurve, RatingCurveEquation, WaterObservation, WaterTimeSeries } from "../types.js";

export interface RatingFitResult {
  equation: RatingCurveEquation;
  rmse: number;
  residualMax: number;
  converged: boolean;
  sampleCount: number;
}

/**
 * Evaluates stage-to-discharge power law: Q = a * (h - h0)^b.
 * Returns 0 if stage <= h0.
 */
export function evaluateRatingEquation(eq: RatingCurveEquation, stageM: number): number {
  if (stageM <= eq.h0) return 0;
  return eq.a * Math.pow(stageM - eq.h0, eq.b);
}

/**
 * Inverses stage-to-discharge power law: h = h0 + (Q / a)^(1/b).
 */
export function invertRatingEquation(eq: RatingCurveEquation, dischargeM3S: number): number {
  if (dischargeM3S <= 0 || eq.a <= 0 || eq.b <= 0) return eq.h0;
  return eq.h0 + Math.pow(dischargeM3S / eq.a, 1.0 / eq.b);
}

/**
 * Evaluates a RatingCurve (using equation if present, or table interpolation).
 */
export function evaluateRatingCurve(curve: RatingCurve, stageM: number): number {
  if (curve.equation) {
    return evaluateRatingEquation(curve.equation, stageM);
  }

  if (curve.tablePoints && curve.tablePoints.length > 0) {
    const pts = [...curve.tablePoints].sort((p1, p2) => p1.stageM - p2.stageM);
    if (stageM <= pts[0]!.stageM) return pts[0]!.dischargeM3S;
    if (stageM >= pts[pts.length - 1]!.stageM) return pts[pts.length - 1]!.dischargeM3S;

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      if (stageM >= p1.stageM && stageM <= p2.stageM) {
        const span = p2.stageM - p1.stageM;
        if (span <= 1e-9) return p1.dischargeM3S;
        const frac = (stageM - p1.stageM) / span;
        return p1.dischargeM3S + frac * (p2.dischargeM3S - p1.dischargeM3S);
      }
    }
  }

  return 0;
}

/**
 * Filters out suspect or missing observations.
 */
export function filterValidObservations(series: WaterTimeSeries): WaterObservation[] {
  return series.points.filter((pt) => {
    if (pt.quality === "suspect" || pt.quality === "missing") return false;
    if (Number.isNaN(pt.value) || !Number.isFinite(pt.value)) return false;
    return true;
  });
}

/**
 * Fits a power-law rating equation Q = a * (h - h0)^b given stage and discharge paired data.
 * Performs log-linear regression over h - h0: ln(Q) = ln(a) + b * ln(h - h0).
 * Tests candidate h0 values to find the minimal residual sum of squares.
 */
export function fitRatingCurve(
  pairs: Array<{ stageM: number; dischargeM3S: number }>,
  options?: { h0Candidates?: number[] | undefined; tolerance?: number | undefined },
): RatingFitResult {
  const valid = pairs.filter((p) => p.dischargeM3S > 0);
  if (valid.length < 2) {
    return {
      equation: { a: 1.0, h0: 0.0, b: 1.67 },
      rmse: 0,
      residualMax: 0,
      converged: false,
      sampleCount: valid.length,
    };
  }

  const minStage = Math.min(...valid.map((p) => p.stageM));
  const h0Candidates = options?.h0Candidates ?? [
    0,
    minStage * 0.1,
    minStage * 0.3,
    minStage * 0.5,
    minStage * 0.8,
    minStage * 0.95,
  ];

  let bestEq: RatingCurveEquation = { a: 1.0, h0: 0.0, b: 1.67 };
  let bestRmse = Infinity;
  let bestResidualMax = Infinity;
  let converged = false;

  for (const h0 of h0Candidates) {
    if (h0 >= minStage) continue;

    // Linear regression on X = ln(h - h0), Y = ln(Q)
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    const n = valid.length;

    for (const p of valid) {
      const x = Math.log(p.stageM - h0);
      const y = Math.log(p.dischargeM3S);
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-12) continue;

    const b = (n * sumXY - sumX * sumY) / denom;
    const lnA = (sumY - b * sumX) / n;
    const a = Math.exp(lnA);

    if (a <= 0 || b <= 0) continue;

    // Compute residual and RMSE
    let sse = 0;
    let maxRes = 0;
    for (const p of valid) {
      const pred = a * Math.pow(p.stageM - h0, b);
      const res = Math.abs(pred - p.dischargeM3S);
      sse += res * res;
      if (res > maxRes) maxRes = res;
    }

    const rmse = Math.sqrt(sse / n);
    if (rmse < bestRmse) {
      bestRmse = rmse;
      bestResidualMax = maxRes;
      bestEq = { a, h0, b };
      converged = true;
    }
  }

  return {
    equation: bestEq,
    rmse: bestRmse === Infinity ? 0 : bestRmse,
    residualMax: bestResidualMax === Infinity ? 0 : bestResidualMax,
    converged,
    sampleCount: valid.length,
  };
}
