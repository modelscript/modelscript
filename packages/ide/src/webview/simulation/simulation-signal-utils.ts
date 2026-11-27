// SPDX-License-Identifier: AGPL-3.0-or-later

export { lttbDecimate } from "../../utils/lttb.js";

export interface LocalSignalStats {
  min: number;
  max: number;
  peakToPeak: number;
  mean: number;
  rms: number;
  finalVal: number;
  settlingTime: number | null;
  baselineDeltaMean?: number;
  baselineRmse?: number;
}

export interface PlotBounds {
  tMin: number;
  tMax: number;
  yMin: number;
  yMax: number;
}

export interface LiveBufferBoundsInput {
  times: number[];
  values: Map<string, number[]>;
  count: number;
}

export interface BatchBoundsDataInput {
  t: number[];
  y: number[][];
  states: string[];
  sweepResults?: { value: number; y: number[][] }[];
}

export interface ReachabilityProfileBoundsInput {
  envelopes: { lo: number[]; hi: number[] }[];
  requirementLimit?: number;
  yRange?: [number, number];
}

export interface MonteCarloBoundsInput {
  statistics: Record<
    string,
    {
      ciLo: number[];
      ciHi: number[];
      percentiles: Record<string, number[]>;
    }
  >;
}

export function escapeHtmlSim(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Convert a hex color like "#0969da" to "rgba(9, 105, 218, alpha)" */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function drawSmoothSpline(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) return;

  const tension = 0.25;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];

    if (Math.abs(p2.x - p1.x) < 0.1) {
      ctx.lineTo(p2.x, p2.y);
      continue;
    }

    let p0 = i > 0 ? pts[i - 1] : p1;
    if (Math.abs(p1.x - p0.x) < 0.1) p0 = p1;

    let p3 = i < pts.length - 2 ? pts[i + 2] : p2;
    if (Math.abs(p3.x - p2.x) < 0.1) p3 = p2;

    const t1x = (p2.x - p0.x) * tension;
    const t1y = (p2.y - p0.y) * tension;
    const t2x = (p3.x - p1.x) * tension;
    const t2y = (p3.y - p1.y) * tension;

    ctx.bezierCurveTo(p1.x + t1x / 3, p1.y + t1y / 3, p2.x - t2x / 3, p2.y - t2y / 3, p2.x, p2.y);
  }
}

export function niceTicksFor(min: number, max: number, targetCount: number): number[] {
  const range = max - min;
  if (range <= 0) return [min];
  const rawStep = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / mag;

  let niceStep: number;
  if (normalized <= 1.5) niceStep = 1;
  else if (normalized <= 3) niceStep = 2;
  else if (normalized <= 7) niceStep = 5;
  else niceStep = 10;
  niceStep *= mag;

  const ticks: number[] = [];
  const start = Math.ceil(min / niceStep) * niceStep;
  for (let v = start; v <= max + niceStep * 0.01; v += niceStep) {
    ticks.push(v);
  }
  return ticks;
}

export function formatTick(v: number): string {
  if (Math.abs(v) < 1e-10) return "0";
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) {
    return v.toExponential(1);
  }
  return parseFloat(v.toPrecision(4)).toString();
}

export function computeLocalSignalStats(t: number[], vals: number[], baselineVals?: number[]): LocalSignalStats {
  const n = Math.min(t.length, vals.length);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sumSq = 0;
  let valid = 0;
  let finalVal = 0;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sumSq += v * v;
    valid++;
    finalVal = v;
  }
  if (valid === 0) {
    return { min: 0, max: 0, peakToPeak: 0, mean: 0, rms: 0, finalVal: 0, settlingTime: null };
  }
  const peakToPeak = max - min;
  const mean = sum / valid;
  const rms = Math.sqrt(sumSq / valid);
  let settlingTime: number | null = null;
  if (n >= 2) {
    const band = Math.max(0.02 * Math.abs(finalVal), 0.02 * peakToPeak, 1e-9);
    let lastOutside = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (Number.isFinite(vals[i]) && Math.abs(vals[i] - finalVal) > band) {
        lastOutside = i;
        break;
      }
    }
    if (lastOutside === -1) settlingTime = t[0] ?? 0;
    else if (lastOutside + 1 < n) settlingTime = t[lastOutside + 1] ?? null;
  }
  let baselineDeltaMean: number | undefined;
  let baselineRmse: number | undefined;
  if (baselineVals && baselineVals.length > 0) {
    const bn = Math.min(n, baselineVals.length);
    let deltaSum = 0;
    let sqSum = 0;
    let cnt = 0;
    for (let i = 0; i < bn; i++) {
      const v = vals[i];
      const bv = baselineVals[i];
      if (Number.isFinite(v) && Number.isFinite(bv)) {
        const d = v - bv;
        deltaSum += d;
        sqSum += d * d;
        cnt++;
      }
    }
    if (cnt > 0) {
      baselineDeltaMean = deltaSum / cnt;
      baselineRmse = Math.sqrt(sqSum / cnt);
    }
  }
  return { min, max, peakToPeak, mean, rms, finalVal, settlingTime, baselineDeltaMean, baselineRmse };
}

export function calculateDefaultPlotBounds(params: {
  isLiveMode: boolean;
  liveBuffer: LiveBufferBoundsInput | null;
  currentData: BatchBoundsDataInput | null;
  hiddenVars: ReadonlySet<string>;
  selectedXVar: string;
  isNormalized: boolean;
  hasReachabilityData: boolean;
  getReachabilityProfileForVar: (varName: string) => ReachabilityProfileBoundsInput | undefined;
  currentMCData: MonteCarloBoundsInput | null;
}): PlotBounds | null {
  const {
    isLiveMode,
    liveBuffer,
    currentData,
    hiddenVars,
    selectedXVar,
    isNormalized,
    hasReachabilityData,
    getReachabilityProfileForVar,
    currentMCData,
  } = params;

  if (isLiveMode && liveBuffer && liveBuffer.count > 0) {
    const times = liveBuffer.times;
    const tMin = times[0];
    const tMax = times[times.length - 1];
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const [name, vals] of liveBuffer.values) {
      if (hiddenVars.has(name)) continue;
      for (const v of vals) {
        if (isFinite(v)) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!isFinite(yMin) || !isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const yPad = (yMax - yMin) * 0.05;
    return { tMin, tMax, yMin: yMin - yPad, yMax: yMax + yPad };
  }

  if (!isLiveMode && currentData && currentData.t.length > 0) {
    const { t, y, states, sweepResults } = currentData;
    let tMin = t[0];
    let tMax = t[t.length - 1];

    const xVarIdx = selectedXVar !== "__time__" ? states.indexOf(selectedXVar) : -1;
    if (xVarIdx >= 0) {
      tMin = Infinity;
      tMax = -Infinity;
      for (let i = 0; i < t.length; i++) {
        const xv = y[i]?.[xVarIdx];
        if (xv !== undefined && isFinite(xv)) {
          if (xv < tMin) tMin = xv;
          if (xv > tMax) tMax = xv;
        }
      }
      if (!isFinite(tMin) || !isFinite(tMax)) {
        tMin = 0;
        tMax = 1;
      }
      if (tMin === tMax) {
        tMin -= 1;
        tMax += 1;
      }
      const xPad = (tMax - tMin) * 0.05;
      tMin -= xPad;
      tMax += xPad;
    }

    if (isNormalized) {
      return { tMin, tMax, yMin: -0.05, yMax: 1.05 };
    }

    let yMin = Infinity;
    let yMax = -Infinity;
    for (let vi = 0; vi < states.length; vi++) {
      if (hiddenVars.has(states[vi])) continue;
      for (let i = 0; i < t.length; i++) {
        if (sweepResults) {
          for (const sweepResult of sweepResults) {
            const v = sweepResult.y[i]?.[vi];
            if (v !== undefined && isFinite(v)) {
              if (v < yMin) yMin = v;
              if (v > yMax) yMax = v;
            }
          }
        } else {
          const v = y[i]?.[vi];
          if (v !== undefined && isFinite(v)) {
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
          }
        }
      }
    }

    if (hasReachabilityData) {
      const visibleStates = states.filter((s) => !hiddenVars.has(s));
      if (visibleStates.length === 1) {
        const singleProfile = getReachabilityProfileForVar(visibleStates[0]);
        if (singleProfile?.yRange && selectedXVar === "__time__") {
          return {
            tMin,
            tMax,
            yMin: singleProfile.yRange[0],
            yMax: singleProfile.yRange[1],
          };
        }
      }
      for (const state of visibleStates) {
        const profile = getReachabilityProfileForVar(state);
        if (!profile) continue;
        for (const env of profile.envelopes) {
          for (const v of env.lo) {
            if (isFinite(v) && v < yMin) yMin = v;
          }
          for (const v of env.hi) {
            if (isFinite(v) && v > yMax) yMax = v;
          }
        }
        if (profile.requirementLimit !== undefined && isFinite(profile.requirementLimit)) {
          if (profile.requirementLimit < yMin) yMin = profile.requirementLimit;
          if (profile.requirementLimit > yMax) yMax = profile.requirementLimit;
        }
      }
    }

    if (currentMCData) {
      for (const state of states) {
        if (hiddenVars.has(state)) continue;
        const stats = currentMCData.statistics[state];
        if (!stats) continue;
        const loArr = stats.percentiles.p5 || stats.ciLo;
        const hiArr = stats.percentiles.p95 || stats.ciHi;
        if (loArr) {
          for (const v of loArr) {
            if (isFinite(v) && v < yMin) yMin = v;
          }
        }
        if (hiArr) {
          for (const v of hiArr) {
            if (isFinite(v) && v > yMax) yMax = v;
          }
        }
      }
    }

    if (!isFinite(yMin) || !isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const yPad = (yMax - yMin) * 0.05;
    return { tMin, tMax, yMin: yMin - yPad, yMax: yMax + yPad };
  }

  return null;
}
