// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RocetsPerformanceMap } from "../types.js";

export interface MapPoint {
  speedRpm: number;
  flowKgS: number;
  headOrPr: number;
  efficiency: number;
}

/**
 * Standard centrifugal pump head and efficiency characteristics.
 */
export const DEFAULT_PUMP_MAP: RocetsPerformanceMap = {
  name: "DEFAULT_CENTRIFUGAL_PUMP",
  speedRpm: [10000, 20000, 30000, 40000],
  flowKgS: [10, 20, 30, 40, 50, 60],
  headOrPressureRatio: [
    [1800, 1750, 1680, 1580, 1420, 1200],
    [2000, 1950, 1870, 1750, 1580, 1350],
    [2200, 2140, 2050, 1920, 1720, 1480],
    [2400, 2320, 2220, 2080, 1860, 1590],
  ],
  efficiency: [
    [0.55, 0.68, 0.76, 0.78, 0.74, 0.62],
    [0.58, 0.7, 0.78, 0.8, 0.76, 0.65],
    [0.6, 0.72, 0.8, 0.82, 0.77, 0.66],
    [0.6, 0.71, 0.79, 0.81, 0.76, 0.65],
  ],
};

/**
 * Standard gas turbine pressure ratio and efficiency map.
 */
export const DEFAULT_TURBINE_MAP: RocetsPerformanceMap = {
  name: "DEFAULT_GAS_TURBINE",
  speedRpm: [10000, 20000, 30000, 40000],
  flowKgS: [5, 10, 15, 20, 25],
  headOrPressureRatio: [
    [1.3, 1.5, 1.8, 2.1, 2.4],
    [1.35, 1.55, 1.85, 2.15, 2.45],
    [1.4, 1.6, 1.9, 2.2, 2.5],
    [1.42, 1.62, 1.92, 2.22, 2.52],
  ],
  efficiency: [
    [0.72, 0.78, 0.82, 0.8, 0.75],
    [0.74, 0.8, 0.84, 0.82, 0.77],
    [0.75, 0.81, 0.85, 0.83, 0.78],
    [0.75, 0.8, 0.84, 0.82, 0.77],
  ],
};

/**
 * Bilinear interpolation for turbomachinery performance maps.
 */
export function interpolatePerformanceMap(map: RocetsPerformanceMap, speedRpm: number, flowKgS: number): MapPoint {
  const speeds = map.speedRpm;
  const flows = map.flowKgS;

  // Clamp indices
  let sIdx = 0;
  while (sIdx < speeds.length - 2 && speedRpm > speeds[sIdx + 1]!) {
    sIdx++;
  }
  let fIdx = 0;
  while (fIdx < flows.length - 2 && flowKgS > flows[fIdx + 1]!) {
    fIdx++;
  }

  const sFrac = Math.max(0, Math.min(1, (speedRpm - speeds[sIdx]!) / Math.max(1, speeds[sIdx + 1]! - speeds[sIdx]!)));
  const fFrac = Math.max(0, Math.min(1, (flowKgS - flows[fIdx]!) / Math.max(1e-3, flows[fIdx + 1]! - flows[fIdx]!)));

  const h00 = map.headOrPressureRatio[sIdx]?.[fIdx] ?? 1000;
  const h01 = map.headOrPressureRatio[sIdx]?.[fIdx + 1] ?? h00;
  const h10 = map.headOrPressureRatio[sIdx + 1]?.[fIdx] ?? h00;
  const h11 = map.headOrPressureRatio[sIdx + 1]?.[fIdx + 1] ?? h10;

  const head = (1 - sFrac) * ((1 - fFrac) * h00 + fFrac * h01) + sFrac * ((1 - fFrac) * h10 + fFrac * h11);

  const e00 = map.efficiency[sIdx]?.[fIdx] ?? 0.75;
  const e01 = map.efficiency[sIdx]?.[fIdx + 1] ?? e00;
  const e10 = map.efficiency[sIdx + 1]?.[fIdx] ?? e00;
  const e11 = map.efficiency[sIdx + 1]?.[fIdx + 1] ?? e10;

  const eff = (1 - sFrac) * ((1 - fFrac) * e00 + fFrac * e01) + sFrac * ((1 - fFrac) * e10 + fFrac * e11);

  return {
    speedRpm,
    flowKgS,
    headOrPr: head,
    efficiency: eff,
  };
}
