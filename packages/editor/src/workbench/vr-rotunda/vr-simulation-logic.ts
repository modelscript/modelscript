// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure VR Simulation & Multi-Channel Oscilloscope Data + Hit-Testing Engine.
 * Zero DOM dependencies — 100% unit-testable in Node/SSR and runs identically
 * for Modelica, PSCAD, PSS/E, SPICE, Cantera, SBML, and all polyglot solvers.
 */

export const SIMULATION_TRACE_PALETTE: readonly string[] = [
  "#38bdf8", // cyan
  "#f97316", // orange
  "#22c55e", // emerald
  "#a855f7", // violet
  "#f43f5e", // rose
  "#eab308", // amber
  "#14b8a6", // teal
  "#60a5fa", // sky
  "#fb7185", // pink
  "#34d399", // mint
] as const;

export type VrSimPlotLayout = "overlay" | "stacked";

export interface VrSimulationSeries {
  readonly name: string;
  readonly color: string;
  readonly values: readonly number[];
  readonly min: number;
  readonly max: number;
}

export interface VrSimulationDataset {
  readonly times: readonly number[];
  readonly tMin: number;
  readonly tMax: number;
  readonly allVariables: readonly string[];
  readonly activeVariables: readonly string[];
  readonly series: readonly VrSimulationSeries[];
}

export const VR_SIM_CANVAS_W = 1408;
export const VR_SIM_CANVAS_H = 820;
export const VR_SIM_VAR_ROWS_PER_PAGE = 9;

export const VR_SIM_PLOT_RECT = {
  x: 84,
  y: 112,
  w: 880,
  h: 598,
} as const;

export const VR_SIM_RACK_RECT = {
  x: 988,
  y: 112,
  w: 396,
  h: 598,
} as const;

export type VrSimHitTarget =
  | { readonly kind: "run" }
  | { readonly kind: "toggle-layout" }
  | { readonly kind: "close" }
  | { readonly kind: "play-pause" }
  | { readonly kind: "reset-time" }
  | { readonly kind: "vars-up" }
  | { readonly kind: "vars-down" }
  | { readonly kind: "vars-top4" }
  | { readonly kind: "vars-clear" }
  | { readonly kind: "toggle-var"; readonly variable: string }
  | { readonly kind: "scrub-plot"; readonly normT: number };

/**
 * Formats a numeric engineering value cleanly for oscilloscope Y-axis ticks
 * and live digital readouts (handles micro/milli/kilo/mega scales cleanly).
 */
export function formatEngineeringValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs >= 1e6 || abs < 1e-3) return v.toExponential(2);
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

/**
 * Computes a deterministic trace color for any variable name based on its index
 * in the full variable list so toggling channels on/off never shuffles colors.
 */
export function getSimulationVariableColor(varName: string, allVariables: readonly string[]): string {
  const idx = allVariables.indexOf(varName);
  const safeIdx = idx >= 0 ? idx : 0;
  return SIMULATION_TRACE_PALETTE[safeIdx % SIMULATION_TRACE_PALETTE.length] ?? "#38bdf8";
}

/**
 * Extracts time-series channels from Ansatz's `localSimulationData` rows
 * (Modelica, PSCAD, PSS/E, SPICE, etc.) for the currently toggled variables.
 */
export function extractVrSimulationDataset(
  rows: readonly Record<string, number | string>[] | null | undefined,
  availableVariables?: readonly string[] | undefined,
  selectedVariables?: readonly string[] | undefined,
): VrSimulationDataset {
  const safeRows = Array.isArray(rows) ? rows : [];
  const sampleRow = safeRows[0];
  const timeKey = sampleRow ? ("time" in sampleRow ? "time" : "t" in sampleRow ? "t" : null) : null;

  const discoveredVars: string[] = [];
  const seen = new Set<string>();
  const pushVar = (name: string) => {
    if (!name || name === "time" || name === "t" || seen.has(name)) return;
    seen.add(name);
    discoveredVars.push(name);
  };

  if (Array.isArray(availableVariables)) {
    for (const v of availableVariables) pushVar(v);
  }
  if (sampleRow) {
    for (const k of Object.keys(sampleRow)) {
      const val = Number(sampleRow[k]);
      if (Number.isFinite(val)) pushVar(k);
    }
  }

  const activeVariables =
    Array.isArray(selectedVariables) && selectedVariables.length > 0
      ? selectedVariables.filter((v) => v !== "time" && v !== "t")
      : discoveredVars.slice(0, 4);

  if (safeRows.length === 0) {
    return {
      times: [],
      tMin: 0,
      tMax: 10,
      allVariables: discoveredVars,
      activeVariables,
      series: [],
    };
  }

  // Downsample gracefully if a high-rate EMT (PSCAD) trace has > 600 points for 72/90Hz Quest 2 redraws
  const maxPoints = 600;
  const stride = safeRows.length > maxPoints ? Math.ceil(safeRows.length / maxPoints) : 1;
  const times: number[] = [];
  for (let i = 0; i < safeRows.length; i += stride) {
    const r = safeRows[i]!;
    const rawT = timeKey ? Number(r[timeKey]) : i;
    times.push(Number.isFinite(rawT) ? rawT : i);
  }
  // Ensure the final sample is always included
  if ((safeRows.length - 1) % stride !== 0) {
    const last = safeRows[safeRows.length - 1]!;
    const rawT = timeKey ? Number(last[timeKey]) : safeRows.length - 1;
    times.push(Number.isFinite(rawT) ? rawT : safeRows.length - 1);
  }

  const series: VrSimulationSeries[] = [];
  for (const varName of activeVariables) {
    const values: number[] = [];
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < safeRows.length; i += stride) {
      const val = Number(safeRows[i]?.[varName]);
      const safeVal = Number.isFinite(val) ? val : 0;
      values.push(safeVal);
      if (safeVal < min) min = safeVal;
      if (safeVal > max) max = safeVal;
    }
    if ((safeRows.length - 1) % stride !== 0) {
      const val = Number(safeRows[safeRows.length - 1]?.[varName]);
      const safeVal = Number.isFinite(val) ? val : 0;
      values.push(safeVal);
      if (safeVal < min) min = safeVal;
      if (safeVal > max) max = safeVal;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    series.push({
      name: varName,
      color: getSimulationVariableColor(varName, discoveredVars.length > 0 ? discoveredVars : activeVariables),
      values,
      min,
      max,
    });
  }

  const tMin = times[0] ?? 0;
  const tMax = times[times.length - 1] ?? Math.max(tMin + 1, 10);

  return {
    times,
    tMin,
    tMax: tMax > tMin ? tMax : tMin + 1,
    allVariables: discoveredVars,
    activeVariables,
    series,
  };
}

/**
 * Samples a time-series channel at arbitrary playback time `t` using binary search
 * + linear interpolation so live VR digital readouts stay smooth while scrubbing.
 */
export function sampleSeriesAtTime(times: readonly number[], values: readonly number[], t: number): number {
  const n = Math.min(times.length, values.length);
  if (n === 0) return Number.NaN;
  if (n === 1 || t <= times[0]!) return values[0]!;
  if (t >= times[n - 1]!) return values[n - 1]!;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const t0 = times[lo]!;
  const t1 = times[hi]!;
  const v0 = values[lo]!;
  const v1 = values[hi]!;
  const span = t1 - t0;
  if (span <= 1e-12) return v0;
  const frac = (t - t0) / span;
  return v0 + (v1 - v0) * frac;
}

/**
 * Computes padded Y-axis bounds across one or more series, handling constant
 * flat lines cleanly without collapsing to zero span.
 */
export function computeSeriesYBounds(seriesList: readonly VrSimulationSeries[]): { yMin: number; yMax: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of seriesList) {
    if (s.min < min) min = s.min;
    if (s.max > max) max = s.max;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { yMin: -1, yMax: 1 };
  }
  const span = max - min;
  if (span < 1e-9) {
    const pad = Math.max(Math.abs(min) * 0.15, 0.5);
    return { yMin: min - pad, yMax: max + pad };
  }
  const pad = span * 0.08;
  return { yMin: min - pad, yMax: max + pad };
}

/**
 * Pure pixel-coordinate hit-tester for the 3D VR Simulation & Oscilloscope Panel.
 */
export function hitTestVrSimulationPanel(
  px: number,
  py: number,
  allVariables: readonly string[],
  pageOffset: number,
): VrSimHitTarget | null {
  // Header bar buttons (y: 24..74)
  if (py >= 24 && py <= 76) {
    if (px >= 756 && px <= 1020) return { kind: "run" };
    if (px >= 1034 && px <= 1286) return { kind: "toggle-layout" };
    if (px >= 1300 && px <= 1384) return { kind: "close" };
  }

  // Plot canvas area -> scrub playhead time
  if (
    px >= VR_SIM_PLOT_RECT.x &&
    px <= VR_SIM_PLOT_RECT.x + VR_SIM_PLOT_RECT.w &&
    py >= VR_SIM_PLOT_RECT.y &&
    py <= VR_SIM_PLOT_RECT.y + VR_SIM_PLOT_RECT.h
  ) {
    const normT = Math.max(0, Math.min(1, (px - VR_SIM_PLOT_RECT.x) / VR_SIM_PLOT_RECT.w));
    return { kind: "scrub-plot", normT };
  }

  // Right variable channel rack
  const rx = VR_SIM_RACK_RECT.x;
  const ry = VR_SIM_RACK_RECT.y;
  const rw = VR_SIM_RACK_RECT.w;
  if (px >= rx && px <= rx + rw && py >= ry && py <= ry + VR_SIM_RACK_RECT.h) {
    // Top quick-action row inside rack (y: ry+8 .. ry+48)
    if (py >= ry + 6 && py <= ry + 50) {
      if (px >= rx + 12 && px <= rx + 114) return { kind: "vars-top4" };
      if (px >= rx + 122 && px <= rx + 216) return { kind: "vars-clear" };
      if (px >= rx + 236 && px <= rx + 306) return { kind: "vars-up" };
      if (px >= rx + 314 && px <= rx + 384) return { kind: "vars-down" };
    }

    // Variable toggle rows
    const listTop = ry + 62;
    const rowH = 56;
    const relY = py - listTop;
    if (relY >= 0) {
      const rowIdx = Math.floor(relY / rowH);
      if (rowIdx >= 0 && rowIdx < VR_SIM_VAR_ROWS_PER_PAGE) {
        const varIdx = pageOffset + rowIdx;
        const varName = allVariables[varIdx];
        if (varName) {
          return { kind: "toggle-var", variable: varName };
        }
      }
    }
  }

  // Bottom transport bar (y: 734..796)
  if (py >= 734 && py <= 796) {
    if (px >= 84 && px <= 216) return { kind: "reset-time" };
    if (px >= 228 && px <= 404) return { kind: "play-pause" };
    if (px >= 428 && px <= 964) {
      const normT = Math.max(0, Math.min(1, (px - 428) / (964 - 428)));
      return { kind: "scrub-plot", normT };
    }
  }

  return null;
}
