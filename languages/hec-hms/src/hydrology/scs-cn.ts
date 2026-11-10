// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * USACE SCS Runoff Curve Number (CN) and Dimensionless Unit Hydrograph solver.
 */

import type { HmsHydrographPoint, HmsSubbasin, HmsUnitSystem } from "../types.js";

export interface ScsCnOptions {
  precipitationTotal: number; // mm (Metric) or in (English)
  durationHours: number; // e.g. 24.0
  timeStepHours?: number; // e.g. 0.25 (15 min)
  unitSystem?: HmsUnitSystem;
}

/**
 * Computes potential maximum retention S from Curve Number (CN).
 */
export function computePotentialRetention(cn: number, unitSystem: HmsUnitSystem = "Metric"): number {
  const safeCn = Math.max(1.0, Math.min(100.0, cn));
  if (unitSystem === "Metric") {
    return 25400.0 / safeCn - 254.0; // mm
  }
  return 1000.0 / safeCn - 10.0; // inches
}

/**
 * Computes cumulative runoff Q from precipitation P and Curve Number.
 */
export function computeCumulativeRunoff(
  p: number,
  cn: number,
  initialAbstraction?: number,
  unitSystem: HmsUnitSystem = "Metric",
): number {
  const s = computePotentialRetention(cn, unitSystem);
  const ia = initialAbstraction !== undefined ? initialAbstraction : 0.2 * s;

  if (p <= ia) return 0.0;
  return Math.pow(p - ia, 2) / (p - ia + s);
}

/**
 * Computes SCS Dimensionless Unit Hydrograph ordinates.
 */
function scsDimensionlessUh(tNorm: number): number {
  if (tNorm <= 0) return 0;
  if (tNorm >= 5.0) return 0;
  // Gamma-distribution approximation of the standard USACE SCS dimensionless hydrograph
  // q / q_p = (t / T_p)^3.7 * exp(3.7 * (1 - t / T_p))
  return Math.pow(tNorm, 3.7) * Math.exp(3.7 * (1.0 - tNorm));
}

/**
 * Simulates rainfall-runoff for a subbasin using SCS-CN and SCS Unit Hydrograph.
 */
export function simulateSubbasinRunoff(subbasin: HmsSubbasin, options: ScsCnOptions): HmsHydrographPoint[] {
  const unitSystem = options.unitSystem ?? "Metric";
  const dt = options.timeStepHours ?? 0.25;
  const cn = subbasin.curveNumber ?? 75.0;
  const area = subbasin.area > 0 ? subbasin.area : 1.0;
  const lagHours = (subbasin.lagMinutes ?? 60.0) / 60.0;

  // Time to peak
  const tp = Math.max(dt, dt / 2.0 + lagHours);

  // Peak discharge of unit hydrograph (per unit excess precipitation)
  // Metric: q_p = 2.08 * A / T_p (m^3/s per mm)
  // English: q_p = 484 * A / T_p (cfs per in)
  const peakCoeff = unitSystem === "Metric" ? 2.08 : 484.0;
  const qp = (peakCoeff * area) / tp;

  // Generate precipitation hyetograph (SCS Type II 24-hr cumulative distribution)
  const steps = Math.ceil(options.durationHours / dt);
  const pTotal = options.precipitationTotal;

  const excessRain: number[] = [];
  let prevQ = 0.0;

  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const tNorm = t / options.durationHours;
    // SCS Type II cumulative rain approximation: S-curve
    const cumPFrac = Math.pow(tNorm, 3) / (Math.pow(tNorm, 3) + Math.pow(1 - tNorm, 3));
    const cumP = cumPFrac * pTotal;

    const cumQ = computeCumulativeRunoff(cumP, cn, subbasin.initialAbstraction, unitSystem);
    const incQ = Math.max(0.0, cumQ - prevQ);
    excessRain.push(incQ);
    prevQ = cumQ;
  }

  // Convolve excess rain with unit hydrograph
  const uhLength = Math.ceil((5.0 * tp) / dt);
  const totalSteps = steps + uhLength;
  const hydrographFlows = new Float64Array(totalSteps + 1);

  for (let i = 0; i <= steps; i++) {
    const pe = excessRain[i]!;
    if (pe <= 0) continue;

    for (let j = 0; j <= uhLength; j++) {
      const tUh = j * dt;
      const qUh = qp * scsDimensionlessUh(tUh / tp);
      const idx = i + j;
      hydrographFlows[idx] = (hydrographFlows[idx] ?? 0.0) + pe * qUh;
    }
  }

  const result: HmsHydrographPoint[] = [];
  for (let i = 0; i <= totalSteps; i++) {
    result.push({
      timeHours: i * dt,
      flow: hydrographFlows[i]!,
    });
  }

  return result;
}
