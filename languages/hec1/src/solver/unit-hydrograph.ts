// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * USACE HEC-1 Unit Hydrograph Generation & Convolution:
 *   - Clark Unit Hydrograph (`UC` card)
 *   - SCS Dimensionless Unit Hydrograph (`UD` card)
 *   - Snyder Synthetic Unit Hydrograph (`US` card)
 */

import type { Hec1HydrographPoint, Hec1UnitHydrograph, Hec1UnitSystem } from "../types.js";

/**
 * Exact unit-volume conversion factor V_unit = (unit depth * unit area) / 1 hour:
 *   - English: 1 mi^2 * 1 in = 5280^2 / 12 ft^3 = 2,323,200 ft^3 = 645.333333... cfs*hr
 *   - Metric:  1 km^2 * 1 mm = 1,000 m^3 = 1000 / 3600 (m^3/s)*hr = 0.277777... (m^3/s)*hr
 */
export function unitRunoffVolumeFactor(unitSystem: Hec1UnitSystem = "English"): number {
  return unitSystem === "Metric" ? 1000.0 / 3600.0 : (5280.0 * 5280.0) / (12.0 * 3600.0);
}

/**
 * HEC-1 synthetic Clark time-area cumulative curve AI(t / Tc).
 */
export function clarkTimeAreaFraction(tOverTc: number): number {
  if (tOverTc <= 0.0) return 0.0;
  if (tOverTc >= 1.0) return 1.0;
  if (tOverTc <= 0.5) {
    return Math.SQRT2 * Math.pow(tOverTc, 1.5);
  }
  return 1.0 - Math.SQRT2 * Math.pow(1.0 - tOverTc, 1.5);
}

/**
 * Generates a Clark Unit Hydrograph (`UC` card: Tc, R) using the exact USACE HEC-1
 * synthetic time-area translation + linear reservoir routing formulation:
 *   I_i = (AI(t_i) - AI(t_{i-1})) * V_unit / dt
 *   c   = dt / (R + 0.5 * dt)
 *   O_i = c * I_i + (1 - c) * O_{i-1}
 *   U_i = 0.5 * (O_{i-1} + O_i)
 */
export function generateClarkUnitHydrograph(
  area: number,
  tcHours: number,
  rHours: number,
  dtHours: number,
  unitSystem: Hec1UnitSystem = "English",
  numOrdinates?: number,
): number[] {
  const safeArea = Math.max(1e-9, area);
  const safeTc = Math.max(dtHours * 0.5, tcHours);
  const safeR = Math.max(1e-6, rHours);
  const vUnit = safeArea * unitRunoffVolumeFactor(unitSystem);

  const defaultSteps = Math.max(20, Math.ceil((safeTc + 12.0 * safeR) / dtHours) + 2);
  const steps = numOrdinates !== undefined ? Math.max(defaultSteps, numOrdinates) : defaultSteps;

  const c = dtHours / (safeR + 0.5 * dtHours);
  const uh: number[] = new Array<number>(steps).fill(0.0);

  let prevAi = 0.0;
  let prevO = 0.0;

  for (let i = 1; i < steps; i++) {
    const t = i * dtHours;
    const ai = clarkTimeAreaFraction(t / safeTc);
    const deltaAi = Math.max(0.0, ai - prevAi);
    const inflow = (deltaAi * vUnit) / dtHours;
    const currO = c * inflow + (1.0 - c) * prevO;
    uh[i] = 0.5 * (prevO + currO);
    prevAi = ai;
    prevO = currO;
  }

  return uh;
}

/**
 * Generates an SCS Dimensionless Unit Hydrograph (`UD` card: Tlag) normalized
 * so discrete volume sum(U_i) * dt equals exact unit volume V_unit.
 */
export function generateScsUnitHydrograph(
  area: number,
  tlagHours: number,
  dtHours: number,
  unitSystem: Hec1UnitSystem = "English",
  numOrdinates?: number,
): number[] {
  const safeArea = Math.max(1e-9, area);
  const tp = Math.max(dtHours, 0.5 * dtHours + Math.max(1e-6, tlagHours));
  const vUnit = safeArea * unitRunoffVolumeFactor(unitSystem);

  const defaultSteps = Math.max(20, Math.ceil((5.5 * tp) / dtHours) + 2);
  const steps = numOrdinates !== undefined ? Math.max(defaultSteps, numOrdinates) : defaultSteps;

  const raw: number[] = new Array<number>(steps).fill(0.0);
  let rawSum = 0.0;
  const m = 3.77; // Gamma shape exponent matching USACE SCS dimensionless peak factor (PRF = 484)

  for (let i = 1; i < steps; i++) {
    const tNorm = (i * dtHours) / tp;
    if (tNorm >= 5.5) break;
    const val = Math.pow(tNorm, m) * Math.exp(m * (1.0 - tNorm));
    raw[i] = val;
    rawSum += val;
  }

  const scale = rawSum > 0 ? vUnit / (rawSum * dtHours) : 0.0;
  return raw.map((v) => v * scale);
}

/**
 * Generates a Snyder Synthetic Unit Hydrograph (`US` card: Tp, Cp) using a
 * gamma distribution matched to Snyder's peaking coefficient Cp and normalized
 * to exact unit runoff volume.
 */
export function generateSnyderUnitHydrograph(
  area: number,
  tpHours: number,
  cp: number,
  dtHours: number,
  unitSystem: Hec1UnitSystem = "English",
  numOrdinates?: number,
): number[] {
  const safeArea = Math.max(1e-9, area);
  const safeTp = Math.max(dtHours, tpHours);
  const safeCp = Math.max(0.1, Math.min(1.2, cp));
  const vUnit = safeArea * unitRunoffVolumeFactor(unitSystem);

  // Higher Cp produces a sharper gamma peak; map Cp in [0.4, 0.8] -> shape m in [2.5, 6.5]
  const m = Math.max(1.5, Math.min(10.0, 1.0 + 7.5 * safeCp * safeCp));
  const defaultSteps = Math.max(20, Math.ceil((6.0 * safeTp) / dtHours) + 2);
  const steps = numOrdinates !== undefined ? Math.max(defaultSteps, numOrdinates) : defaultSteps;

  const raw: number[] = new Array<number>(steps).fill(0.0);
  let rawSum = 0.0;

  for (let i = 1; i < steps; i++) {
    const tNorm = (i * dtHours) / safeTp;
    if (tNorm >= 6.0) break;
    const val = Math.pow(tNorm, m) * Math.exp(m * (1.0 - tNorm));
    raw[i] = val;
    rawSum += val;
  }

  const scale = rawSum > 0 ? vUnit / (rawSum * dtHours) : 0.0;
  return raw.map((v) => v * scale);
}

/**
 * Dispatches unit hydrograph generation for any HEC-1 UH specification (`UC`, `UD`, `US`).
 */
export function generateUnitHydrograph(
  area: number,
  uhSpec: Hec1UnitHydrograph,
  dtHours: number,
  unitSystem: Hec1UnitSystem = "English",
  numOrdinates?: number,
): number[] {
  switch (uhSpec.method) {
    case "Clark":
      return generateClarkUnitHydrograph(area, uhSpec.tc, uhSpec.r, dtHours, unitSystem, numOrdinates);
    case "SCS":
      return generateScsUnitHydrograph(area, uhSpec.tlag, dtHours, unitSystem, numOrdinates);
    case "Snyder":
      return generateSnyderUnitHydrograph(area, uhSpec.tp, uhSpec.cp, dtHours, unitSystem, numOrdinates);
  }
}

/**
 * Discrete convolution of incremental excess precipitation with a unit hydrograph.
 */
export function convolveUnitHydrograph(
  excessPrecip: readonly number[],
  unitHydrograph: readonly number[],
  dtHours: number,
  numOrdinates?: number,
  baseflow = 0.0,
): Hec1HydrographPoint[] {
  const naturalLen = excessPrecip.length + unitHydrograph.length;
  const totalLen = numOrdinates !== undefined ? Math.max(1, numOrdinates) : naturalLen;
  const flows = new Float64Array(totalLen);

  for (let i = 0; i < excessPrecip.length; i++) {
    const pe = excessPrecip[i]!;
    if (pe <= 0) continue;
    for (let j = 0; j < unitHydrograph.length; j++) {
      const idx = i + j;
      if (idx >= totalLen) break;
      flows[idx] = flows[idx]! + pe * unitHydrograph[j]!;
    }
  }

  const points: Hec1HydrographPoint[] = new Array<Hec1HydrographPoint>(totalLen);
  for (let i = 0; i < totalLen; i++) {
    points[i] = {
      timeHours: i * dtHours,
      flow: flows[i]! + baseflow,
    };
  }
  return points;
}
