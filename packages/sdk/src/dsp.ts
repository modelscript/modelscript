// SPDX-License-Identifier: AGPL-3.0-or-later

import type { KernelDiagnostic, KernelResult, PlotSeries, VisualArtifact } from "./types.js";

/** Fluent builder for constructing structured `KernelResult` objects in TypeScript kernels. */
export class ResultBuilder {
  private okFlag = true;
  private readonly kernelId: string;
  private readonly params: Record<string, number | string | boolean> = {};
  private readonly diags: KernelDiagnostic[] = [];
  private readonly arts: VisualArtifact[] = [];
  private summaryText = "";

  constructor(kernelId: string) {
    this.kernelId = kernelId;
  }

  /** Set overall pass/fail status explicitly. */
  status(ok: boolean): this {
    this.okFlag = ok;
    return this;
  }

  /** Set a human-readable summary string. */
  summary(text: string): this {
    this.summaryText = text;
    return this;
  }

  /** Record a scalar output parameter/metric for SysML `require`/`assert` evaluation. */
  metric(name: string, value: number | string | boolean): this {
    this.params[name] = value;
    return this;
  }

  /** Record multiple scalar output parameters/metrics at once. */
  metrics(values: Record<string, number | string | boolean>): this {
    for (const [k, v] of Object.entries(values)) {
      this.params[k] = v;
    }
    return this;
  }

  /** Append a diagnostic entry. Error diagnostics automatically mark `ok = false` unless overridden. */
  diagnostic(severity: KernelDiagnostic["severity"], code: string, message: string): this {
    this.diags.push({ severity, code, message });
    if (severity === "error") this.okFlag = false;
    return this;
  }

  /** Add a time-series plot artifact. */
  timeSeries(id: string, title: string, xLabel: string, yLabel: string, series: PlotSeries[]): this {
    this.arts.push({ kind: "timeseries", id, title, xLabel, yLabel, series });
    return this;
  }

  /** Add a Bode plot artifact. */
  bode(id: string, title: string, xLabel: string, yLabel: string, series: PlotSeries[]): this {
    this.arts.push({ kind: "bode", id, title, xLabel, yLabel, series });
    return this;
  }

  /** Add a table or compliance-matrix artifact. */
  table(
    id: string,
    title: string,
    columns: string[],
    rows: Array<Array<string | number | boolean>>,
    kind: "table" | "compliance-matrix" = "table",
  ): this {
    this.arts.push({ kind, id, title, columns, rows });
    return this;
  }

  /** Add diagram overlay badges. */
  diagramOverlay(
    id: string,
    title: string,
    badges: Array<{ nodeId: string; text: string; severity: "pass" | "warn" | "fail" }>,
  ): this {
    this.arts.push({ kind: "diagram-overlay", id, title, badges });
    return this;
  }

  /** Add structured KPI metric cards. */
  kpiCards(
    id: string,
    title: string,
    cards: Array<{
      label: string;
      value: string | number;
      unit?: string;
      status?: "pass" | "warn" | "fail" | "neutral";
      subtitle?: string;
    }>,
  ): this {
    this.arts.push({ kind: "kpi-cards", id, title, cards });
    return this;
  }

  /** Add a markdown engineering note/report artifact. */
  markdown(id: string, title: string, content: string): this {
    this.arts.push({ kind: "markdown", id, title, content });
    return this;
  }

  /** Add a histogram bar-chart artifact. */
  histogram(id: string, title: string, xLabel: string, yLabel: string, binCenters: number[], counts: number[]): this {
    this.arts.push({ kind: "histogram", id, title, xLabel, yLabel, binCenters, counts });
    return this;
  }

  /** Finalize the `KernelResult`. */
  build(): KernelResult {
    return {
      ok: this.okFlag,
      kernelId: this.kernelId,
      ...(Object.keys(this.params).length > 0 ? { parameters: this.params } : {}),
      ...(this.diags.length > 0 ? { diagnostics: this.diags } : {}),
      ...(this.arts.length > 0 ? { artifacts: this.arts } : {}),
      ...(this.summaryText ? { summary: this.summaryText } : {}),
    };
  }
}

export interface StepResponseMetrics {
  initialValue: number;
  finalValue: number;
  targetValue: number;
  peakValue: number;
  peakTime: number;
  overshootPct: number;
  riseTime: number;
  settlingTime2Pct: number;
  steadyStateError: number;
}

/** Arithmetic mean of a numeric array or `Float64Array`. */
export function mean(values: ArrayLike<number>): number {
  const n = values.length;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i] ?? 0;
  return sum / n;
}

/** Sample standard deviation (Bessel-corrected for `n > 1`). */
export function std(values: ArrayLike<number>): number {
  const n = values.length;
  if (n <= 1) return 0;
  const avg = mean(values);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = (values[i] ?? 0) - avg;
    sq += d * d;
  }
  return Math.sqrt(sq / (n - 1));
}

/** Root-mean-square error between two waveforms. */
export function rmse(actual: ArrayLike<number>, reference: ArrayLike<number>): number {
  const n = Math.min(actual.length, reference.length);
  if (n <= 0) return 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = (actual[i] ?? 0) - (reference[i] ?? 0);
    sq += d * d;
  }
  return Math.sqrt(sq / n);
}

/** Maximum relative error normalized by peak reference magnitude. */
export function maxRelError(actual: ArrayLike<number>, reference: ArrayLike<number>): number {
  const n = Math.min(actual.length, reference.length);
  if (n <= 0) return 0;
  let peak = 0;
  let maxErr = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.abs(reference[i] ?? 0);
    if (r > peak) peak = r;
    const err = Math.abs((actual[i] ?? 0) - (reference[i] ?? 0));
    if (err > maxErr) maxErr = err;
  }
  return peak > 1e-12 ? maxErr / peak : maxErr;
}

/** Linearly resample a non-uniform `(x, y)` signal onto a uniform grid with step `dt`. */
export function resampleUniform(x: ArrayLike<number>, y: ArrayLike<number>, dt: number): { x: number[]; y: number[] } {
  const n = Math.min(x.length, y.length);
  if (n <= 0 || dt <= 0) return { x: [], y: [] };
  if (n === 1) return { x: [x[0] ?? 0], y: [y[0] ?? 0] };

  const t0 = x[0] ?? 0;
  const tEnd = x[n - 1] ?? t0;
  const outX: number[] = [];
  const outY: number[] = [];
  let seg = 0;

  for (let t = t0; t <= tEnd + dt * 1e-9; t += dt) {
    const tc = Math.min(t, tEnd);
    while (seg + 1 < n - 1 && (x[seg + 1] ?? tEnd) < tc) {
      seg++;
    }
    const x0 = x[seg] ?? t0;
    const x1 = x[seg + 1] ?? x0;
    const y0 = y[seg] ?? 0;
    const y1 = y[seg + 1] ?? y0;
    const span = x1 - x0;
    const alpha = span > 1e-15 ? (tc - x0) / span : 0;
    outX.push(tc);
    outY.push(y0 + alpha * (y1 - y0));
  }
  return { x: outX, y: outY };
}

/** Compute standard control-systems step-response metrics from `(t, y)` samples. */
export function stepResponseMetrics(t: ArrayLike<number>, y: ArrayLike<number>, target?: number): StepResponseMetrics {
  const n = Math.min(t.length, y.length);
  if (n <= 0) {
    return {
      initialValue: 0,
      finalValue: 0,
      targetValue: target ?? 0,
      peakValue: 0,
      peakTime: 0,
      overshootPct: 0,
      riseTime: 0,
      settlingTime2Pct: 0,
      steadyStateError: 0,
    };
  }

  const y0 = y[0] ?? 0;
  const yFinal = y[n - 1] ?? y0;
  const yTarget = target ?? yFinal;
  const stepSpan = yFinal - y0;
  const dir = stepSpan >= 0 ? 1 : -1;

  let peakValue = y0;
  let peakTime = t[0] ?? 0;
  for (let i = 0; i < n; i++) {
    const val = y[i] ?? 0;
    if ((val - peakValue) * dir > 0) {
      peakValue = val;
      peakTime = t[i] ?? 0;
    }
  }

  const denom = Math.abs(stepSpan);
  const overshootPct = denom > 1e-12 ? Math.max(0, ((peakValue - yFinal) * dir) / denom) * 100 : 0;

  let t10 = t[0] ?? 0;
  let t90 = t[n - 1] ?? t10;
  let found10 = false;
  let found90 = false;
  if (denom > 1e-12) {
    const level10 = y0 + 0.1 * stepSpan;
    const level90 = y0 + 0.9 * stepSpan;
    for (let i = 0; i < n; i++) {
      const val = y[i] ?? 0;
      if (!found10 && (val - level10) * dir >= 0) {
        t10 = t[i] ?? 0;
        found10 = true;
      }
      if (!found90 && (val - level90) * dir >= 0) {
        t90 = t[i] ?? 0;
        found90 = true;
        break;
      }
    }
  }
  const riseTime = found10 && found90 ? Math.max(0, t90 - t10) : 0;

  const band = Math.max(0.02 * Math.max(denom, Math.abs(yFinal)), 1e-9);
  let settlingTime2Pct = t[0] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs((y[i] ?? 0) - yFinal) > band) {
      settlingTime2Pct = t[Math.min(i + 1, n - 1)] ?? t[i] ?? 0;
      break;
    }
  }

  return {
    initialValue: y0,
    finalValue: yFinal,
    targetValue: yTarget,
    peakValue,
    peakTime,
    overshootPct,
    riseTime,
    settlingTime2Pct,
    steadyStateError: Math.abs(yTarget - yFinal),
  };
}

/** Apply a Hann window to a signal array (returns a new `number[]`). */
export function hannWindow(samples: ArrayLike<number>): number[] {
  const n = samples.length;
  if (n <= 0) return [];
  if (n === 1) return [samples[0] ?? 0];
  const out = new Array<number>(n);
  const denom = n - 1;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    out[i] = (samples[i] ?? 0) * w;
  }
  return out;
}

export interface RfftResult {
  magnitudes: number[];
  phases: number[];
  fftSize: number;
  bins: (sampleRateHz: number) => number[];
}

/**
 * Radix-2 real-input FFT (zero-pads or truncates to nearest power of two >= 2).
 * Returns single-sided magnitude and phase spectra.
 */
export function rfft(samples: ArrayLike<number>): RfftResult {
  const nIn = samples.length;
  let n = 2;
  while (n < nIn) n <<= 1;

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < nIn; i++) re[i] = samples[i] ?? 0;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
    }
  }

  // Cooley-Tukey butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j]!;
        const uIm = im[i + j]!;
        const vRe = re[i + j + half]! * wRe - im[i + j + half]! * wIm;
        const vIm = re[i + j + half]! * wIm + im[i + j + half]! * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }

  const halfBins = (n >> 1) + 1;
  const magnitudes = new Array<number>(halfBins);
  const phases = new Array<number>(halfBins);
  const scale = nIn > 0 ? 1 / nIn : 1;
  for (let k = 0; k < halfBins; k++) {
    const rk = re[k]!;
    const ik = im[k]!;
    const mult = k === 0 || k === n >> 1 ? 1 : 2;
    magnitudes[k] = Math.hypot(rk, ik) * scale * mult;
    phases[k] = Math.atan2(ik, rk);
  }

  return {
    magnitudes,
    phases,
    fftSize: n,
    bins: (sampleRateHz: number) => Array.from({ length: halfBins }, (_, k) => (k * sampleRateHz) / n),
  };
}

/** Definite integral of `(x, y)` via the composite trapezoidal rule. */
export function integrateTrapezoidal(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = Math.min(x.length, y.length);
  if (n <= 1) return 0;
  let area = 0;
  for (let i = 1; i < n; i++) {
    const dx = (x[i] ?? 0) - (x[i - 1] ?? 0);
    area += 0.5 * ((y[i] ?? 0) + (y[i - 1] ?? 0)) * dx;
  }
  return area;
}

/** Linear-interpolated quantile `q in [0, 1]` of numeric samples. */
export function quantile(values: ArrayLike<number>, q: number): number {
  const n = values.length;
  if (n <= 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, q));
  const pos = clamped * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] ?? 0;
  const alpha = pos - lo;
  return (sorted[lo] ?? 0) * (1 - alpha) + (sorted[hi] ?? 0) * alpha;
}

/** Equal-width histogram counts and bin centers. */
export function histogram(
  values: ArrayLike<number>,
  bins = 10,
): { binCenters: number[]; counts: number[]; edges: number[] } {
  const n = values.length;
  const k = Math.max(1, Math.floor(bins));
  if (n <= 0) return { binCenters: [], counts: [], edges: [] };
  let minV = values[0] ?? 0;
  let maxV = minV;
  for (let i = 1; i < n; i++) {
    const v = values[i] ?? 0;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const span = maxV - minV > 1e-12 ? maxV - minV : 1;
  const width = span / k;
  const counts = new Array<number>(k).fill(0);
  const edges = Array.from({ length: k + 1 }, (_, i) => minV + i * width);
  const binCenters = Array.from({ length: k }, (_, i) => minV + (i + 0.5) * width);
  for (let i = 0; i < n; i++) {
    const v = values[i] ?? 0;
    const idx = Math.min(k - 1, Math.max(0, Math.floor((v - minV) / width)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return { binCenters, counts, edges };
}

export interface NelderMeadOptions {
  maxIterations?: number;
  tolerance?: number;
  initialStep?: number;
}

/** Lightweight Nelder-Mead simplex minimizer for parameter fitting & calibration. */
export function nelderMead(
  objective: (x: number[]) => number,
  x0: number[],
  options: NelderMeadOptions = {},
): { x: number[]; fx: number; iterations: number; converged: boolean } {
  const dim = x0.length;
  if (dim === 0) return { x: [], fx: objective([]), iterations: 0, converged: true };

  const maxIter = options.maxIterations ?? 200 * dim;
  const tol = options.tolerance ?? 1e-6;
  const step = options.initialStep ?? 0.1;

  const simplex: Array<{ pt: number[]; val: number }> = [{ pt: [...x0], val: objective(x0) }];
  for (let i = 0; i < dim; i++) {
    const pt = [...x0];
    pt[i] = (pt[i] ?? 0) + (Math.abs(pt[i] ?? 0) > 1e-6 ? Math.abs(pt[i]!) * step : step);
    simplex.push({ pt, val: objective(pt) });
  }

  let iter = 0;
  let converged = false;
  while (iter < maxIter) {
    simplex.sort((a, b) => a.val - b.val);
    const best = simplex[0]!;
    const worst = simplex[dim]!;
    const secondWorst = simplex[dim - 1]!;

    let maxDiff = 0;
    for (let i = 1; i <= dim; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(simplex[i]!.val - best.val));
    }
    if (maxDiff < tol) {
      converged = true;
      break;
    }

    const centroid = new Array<number>(dim).fill(0);
    for (let i = 0; i < dim; i++) {
      for (let d = 0; d < dim; d++) centroid[d] = (centroid[d] ?? 0) + simplex[i]!.pt[d]!;
    }
    for (let d = 0; d < dim; d++) centroid[d] = centroid[d]! / dim;

    const xr = centroid.map((c, d) => c + (c - worst.pt[d]!));
    const fr = objective(xr);

    if (fr < best.val) {
      const xe = centroid.map((c, d) => c + 2 * (xr[d]! - c));
      const fe = objective(xe);
      simplex[dim] = fe < fr ? { pt: xe, val: fe } : { pt: xr, val: fr };
    } else if (fr < secondWorst.val) {
      simplex[dim] = { pt: xr, val: fr };
    } else {
      const xc =
        fr < worst.val
          ? centroid.map((c, d) => c + 0.5 * (xr[d]! - c))
          : centroid.map((c, d) => c + 0.5 * (worst.pt[d]! - c));
      const fc = objective(xc);
      if (fc < worst.val) {
        simplex[dim] = { pt: xc, val: fc };
      } else {
        for (let i = 1; i <= dim; i++) {
          const shrunk = best.pt.map((b, d) => b + 0.5 * (simplex[i]!.pt[d]! - b));
          simplex[i] = { pt: shrunk, val: objective(shrunk) };
        }
      }
    }
    iter++;
  }

  simplex.sort((a, b) => a.val - b.val);
  return { x: simplex[0]!.pt, fx: simplex[0]!.val, iterations: iter, converged };
}

export interface DelimitedTableResult {
  headers: string[];
  rows: Array<Array<number | string>>;
  columns: Record<string, number[]>;
}

/**
 * Parses CSV, TSV, or whitespace-delimited engineering profiles (e.g. PMView `.txt`,
 * SFRA sweeps, or lab measurements) into headers, typed rows, and numeric column vectors.
 */
export function parseDelimitedTable(
  text: string,
  options: { delimiter?: string; hasHeader?: boolean; commentPrefix?: string } = {},
): DelimitedTableResult {
  const commentPrefix = options.commentPrefix ?? "#";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith(commentPrefix) && !l.startsWith("//"));

  if (lines.length === 0) return { headers: [], rows: [], columns: {} };

  const first = lines[0]!;
  const splitLine = (line: string): string[] => {
    if (options.delimiter) return line.split(options.delimiter).map((c) => c.trim());
    if (line.includes(",")) return line.split(",").map((c) => c.trim());
    if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
    return line.split(/\s+/).map((c) => c.trim());
  };

  const firstCells = splitLine(first);
  const looksNumeric = firstCells.every((c) => c !== "" && Number.isFinite(Number(c)));
  const hasHeader = options.hasHeader ?? !looksNumeric;

  const headers = hasHeader ? firstCells : firstCells.map((_, idx) => `col${idx}`);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const columns: Record<string, number[]> = {};
  for (const h of headers) columns[h] = [];
  const rows: Array<Array<number | string>> = [];

  for (const line of dataLines) {
    const cells = splitLine(line);
    const row: Array<number | string> = [];
    for (let i = 0; i < headers.length; i++) {
      const raw = cells[i] ?? "";
      const num = raw !== "" ? Number(raw) : Number.NaN;
      if (Number.isFinite(num)) {
        row.push(num);
        columns[headers[i]!]!.push(num);
      } else {
        row.push(raw);
      }
    }
    rows.push(row);
  }

  return { headers, rows, columns };
}

export interface ComtradeAsciiResult {
  stationName: string;
  deviceId: string;
  lineFrequencyHz: number;
  sampleRateHz: number;
  time: number[];
  channels: Record<string, { unit: string; values: number[] }>;
}

/**
 * Lightweight IEEE C37.111 COMTRADE ASCII parser (`.cfg` + `.dat`) for use inside
 * isolated TypeScript verification kernels without external dependencies.
 */
export function parseComtradeAscii(cfgText: string, datText: string): ComtradeAsciiResult {
  const cfgLines = cfgText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const headerParts = (cfgLines[0] ?? "Station,Device,1999").split(",");
  const stationName = (headerParts[0] ?? "Station").trim();
  const deviceId = (headerParts[1] ?? "Device").trim();

  const countParts = (cfgLines[1] ?? "0,0A,0D").split(",");
  const analogCount = Number.parseInt(countParts[1] ?? "0", 10) || 0;

  interface AnalogSpec {
    name: string;
    unit: string;
    a: number;
    b: number;
  }
  const analogSpecs: AnalogSpec[] = [];
  for (let i = 0; i < analogCount; i++) {
    const parts = (cfgLines[2 + i] ?? "").split(",");
    analogSpecs.push({
      name: (parts[1] ?? `ch${i + 1}`).trim() || `ch${i + 1}`,
      unit: (parts[4] ?? "").trim(),
      a: Number.parseFloat(parts[5] ?? "1") || 1,
      b: Number.parseFloat(parts[6] ?? "0") || 0,
    });
  }

  let cursor = 2 + analogCount + (Number.parseInt(countParts[2] ?? "0", 10) || 0);
  const lineFrequencyHz = Number.parseFloat(cfgLines[cursor] ?? "60") || 60;
  cursor++;
  const nRates = Number.parseInt(cfgLines[cursor] ?? "1", 10) || 1;
  cursor++;
  const rateLine = (cfgLines[cursor] ?? "1000,0").split(",");
  const sampleRateHz = Number.parseFloat(rateLine[0] ?? "1000") || 1000;
  cursor += Math.max(1, nRates);
  const timeMult = Number.parseFloat(cfgLines[cursor + 2] ?? "1") || 1;

  const time: number[] = [];
  const channels: Record<string, { unit: string; values: number[] }> = {};
  for (const spec of analogSpecs) {
    channels[spec.name] = { unit: spec.unit, values: [] };
  }

  const datLines = datText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let r = 0; r < datLines.length; r++) {
    const parts = datLines[r]!.split(",");
    const tsRaw = Number.parseFloat(parts[1] ?? "");
    const tSec = Number.isFinite(tsRaw) ? tsRaw * 1e-6 * timeMult : r / sampleRateHz;
    time.push(tSec);
    for (let i = 0; i < analogSpecs.length; i++) {
      const spec = analogSpecs[i]!;
      const rawVal = Number.parseFloat(parts[2 + i] ?? "0");
      channels[spec.name]!.values.push(Number.isFinite(rawVal) ? spec.a * rawVal + spec.b : 0);
    }
  }

  return { stationName, deviceId, lineFrequencyHz, sampleRateHz, time, channels };
}
