// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WaterML to Hydraulic Engine Boundary Condition Projections.
 *
 * Projects WaterML streamflow and stage timeseries into:
 * 1. HEC-RAS Unsteady Flow Hydrograph (.u01) boundary conditions.
 * 2. EPANET Hydraulic Pattern ([PATTERNS]) format.
 * 3. SWMM Timeseries ([TIMESERIES]) format.
 */

import { filterValidObservations } from "../analysis/rating-curve.js";
import type { WaterTimeSeries } from "../types.js";

/**
 * Formats a number to fixed width/decimal representation.
 */
function fmt(val: number, decimals: number = 2): string {
  return Number.isFinite(val) ? val.toFixed(decimals) : "0.00";
}

/**
 * Projects a WaterTimeSeries to HEC-RAS Unsteady Flow boundary block.
 */
export function projectWaterMlToHecRas(
  series: WaterTimeSeries,
  options?: { river?: string | undefined; reach?: string | undefined; riverStation?: string | undefined },
): string {
  const valid = filterValidObservations(series);
  const river = options?.river ?? "MainRiver";
  const reach = options?.reach ?? "Reach1";
  const rs = options?.riverStation ?? series.monitoringPoint.stationId;

  const lines: string[] = [];
  lines.push(`Boundary Location=${river},${reach},${rs}, , , , , `);
  lines.push(`Interval=1HOUR`);
  lines.push(`Flow Hydrograph=${valid.length}`);

  // HEC-RAS formats numbers in 8-column chunks or space-separated lines
  let currentChunk: string[] = [];
  for (let i = 0; i < valid.length; i++) {
    currentChunk.push(fmt(valid[i]!.value, 2).padStart(8));
    if (currentChunk.length === 10 || i === valid.length - 1) {
      lines.push(currentChunk.join(""));
      currentChunk = [];
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Projects a WaterTimeSeries to EPANET [PATTERNS] block.
 */
export function projectWaterMlToEpanet(series: WaterTimeSeries, patternId?: string): string {
  const valid = filterValidObservations(series);
  const id = patternId ?? series.seriesId.replace(/[^a-zA-Z0-9_]/g, "_");

  const lines: string[] = [];
  lines.push(`[PATTERNS]`);
  lines.push(`;ID              Multipliers`);

  // Compute average to normalize if requested, or emit raw multipliers
  let currentChunk: string[] = [];
  for (let i = 0; i < valid.length; i++) {
    currentChunk.push(fmt(valid[i]!.value, 4));
    if (currentChunk.length === 6 || i === valid.length - 1) {
      lines.push(`${id.padEnd(16)} ${currentChunk.join(" ")}`);
      currentChunk = [];
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Projects a WaterTimeSeries to SWMM [TIMESERIES] block.
 */
export function projectWaterMlToSwmm(series: WaterTimeSeries, tsName?: string): string {
  const valid = filterValidObservations(series);
  const name = tsName ?? series.seriesId.replace(/[^a-zA-Z0-9_]/g, "_");

  const lines: string[] = [];
  lines.push(`[TIMESERIES]`);
  lines.push(`;;Name           Date       Time       Value`);

  for (const pt of valid) {
    const d = pt.time;
    const dateStr = `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
    const timeStr = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    lines.push(`${name.padEnd(16)} ${dateStr} ${timeStr}   ${fmt(pt.value, 3)}`);
  }

  return lines.join("\n") + "\n";
}
