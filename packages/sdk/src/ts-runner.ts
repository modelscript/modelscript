// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ts from "typescript";
import * as dsp from "./dsp.js";
import type {
  KernelBatchItemResult,
  KernelBatchTask,
  KernelContext,
  KernelHostHandlers,
  KernelInput,
  KernelInspectOptions,
  KernelResult,
  KernelSimulateOptions,
} from "./types.js";

export interface TsCompileResult {
  ok: boolean;
  entryFile: string;
  modules: Record<string, string>;
  diagnostics: string[];
  cacheHit: boolean;
}

export interface RunTsKernelOptions {
  /** Maximum execution time in milliseconds before the Worker is preemptively terminated. */
  timeoutMs?: number;
  /** Run inside an isolated Worker thread / Web Worker (default: `true`). */
  preemptible?: boolean;
  /** Optional host RPC handlers (`readFile`, `simulate`, `onProgress`) exposed via `KernelContext`. */
  host?: KernelHostHandlers;
}

const tsCompileCache = new Map<string, Omit<TsCompileResult, "cacheHit">>();

export function clearTsCompileCache(): void {
  tsCompileCache.clear();
}

function normalizePath(p: string): string {
  const clean = p.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = clean.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function fnv1aHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function computeTsCacheKey(entryFile: string, files: Readonly<Record<string, string>>): string {
  const keys = Object.keys(files).sort();
  const payload = keys.map((k) => `${normalizePath(k)}:${files[k] ?? ""}`).join("\0");
  return `${normalizePath(entryFile)}|${fnv1aHash(payload)}`;
}

function formatTsDiagnostics(fileName: string, diags: readonly ts.Diagnostic[] | undefined): string[] {
  if (!diags || diags.length === 0) return [];
  return diags.map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && typeof d.start === "number") {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      const sev = d.category === ts.DiagnosticCategory.Warning ? "WARNING" : "ERROR";
      return `${sev} ${fileName}(${line + 1},${character + 1}): ${msg}`;
    }
    return `ERROR ${fileName}: ${msg}`;
  });
}

/**
 * Transpiles an in-memory map of TypeScript files into CommonJS modules suitable for
 * isolated Worker execution in both Node.js and Browser environments.
 */
export function compileTypeScript(entryFile: string, files: Readonly<Record<string, string>>): TsCompileResult {
  const normEntry = normalizePath(entryFile);
  const cacheKey = computeTsCacheKey(normEntry, files);
  const cached = tsCompileCache.get(cacheKey);
  if (cached) {
    return { ...cached, cacheHit: true };
  }

  const normalizedFiles: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    normalizedFiles[normalizePath(k)] = v;
  }

  if (!(normEntry in normalizedFiles)) {
    return {
      ok: false,
      entryFile: normEntry,
      modules: {},
      diagnostics: [`ERROR ${normEntry}: Entry file not found in provided files.`],
      cacheHit: false,
    };
  }

  const modules: Record<string, string> = {};
  const diagnostics: string[] = [];

  for (const [fileName, source] of Object.entries(normalizedFiles)) {
    if (!/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/i.test(fileName)) continue;
    const out = ts.transpileModule(source, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        allowJs: true,
        strict: false,
        skipLibCheck: true,
      },
    });
    const diags = formatTsDiagnostics(fileName, out.diagnostics);
    diagnostics.push(...diags);
    modules[fileName] = out.outputText;
  }

  const hasErrors = diagnostics.some((d) => !d.startsWith("WARNING "));
  const result: Omit<TsCompileResult, "cacheHit"> = {
    ok: !hasErrors,
    entryFile: normEntry,
    modules,
    diagnostics,
  };
  if (!hasErrors) {
    tsCompileCache.set(cacheKey, result);
  }
  return { ...result, cacheHit: false };
}

/** Inline pure-JS SDK runtime shimmed into the Worker as `@modelscript/sdk`. */
const WORKER_SDK_SHIM_SOURCE = `
class ResultBuilder {
  constructor(kernelId) {
    this.okFlag = true;
    this.kernelId = kernelId;
    this.params = {};
    this.diags = [];
    this.arts = [];
    this.summaryText = "";
  }
  status(ok) { this.okFlag = ok; return this; }
  summary(text) { this.summaryText = text; return this; }
  metric(name, value) { this.params[name] = value; return this; }
  metrics(values) { Object.assign(this.params, values); return this; }
  diagnostic(severity, code, message) {
    this.diags.push({ severity, code, message });
    if (severity === "error") this.okFlag = false;
    return this;
  }
  timeSeries(id, title, xLabel, yLabel, series) {
    this.arts.push({ kind: "timeseries", id, title, xLabel, yLabel, series });
    return this;
  }
  bode(id, title, xLabel, yLabel, series) {
    this.arts.push({ kind: "bode", id, title, xLabel, yLabel, series });
    return this;
  }
  table(id, title, columns, rows, kind = "table") {
    this.arts.push({ kind, id, title, columns, rows });
    return this;
  }
  diagramOverlay(id, title, badges) {
    this.arts.push({ kind: "diagram-overlay", id, title, badges });
    return this;
  }
  kpiCards(id, title, cards) {
    this.arts.push({ kind: "kpi-cards", id, title, cards });
    return this;
  }
  markdown(id, title, content) {
    this.arts.push({ kind: "markdown", id, title, content });
    return this;
  }
  histogram(id, title, xLabel, yLabel, binCenters, counts) {
    this.arts.push({ kind: "histogram", id, title, xLabel, yLabel, binCenters, counts });
    return this;
  }
  build() {
    const out = { ok: this.okFlag, kernelId: this.kernelId };
    if (Object.keys(this.params).length > 0) out.parameters = this.params;
    if (this.diags.length > 0) out.diagnostics = this.diags;
    if (this.arts.length > 0) out.artifacts = this.arts;
    if (this.summaryText) out.summary = this.summaryText;
    return out;
  }
}
function mean(values) {
  const n = values.length;
  if (n <= 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += values[i] ?? 0;
  return s / n;
}
function std(values) {
  const n = values.length;
  if (n <= 1) return 0;
  const avg = mean(values);
  let sq = 0;
  for (let i = 0; i < n; i++) { const d = (values[i] ?? 0) - avg; sq += d * d; }
  return Math.sqrt(sq / (n - 1));
}
function rmse(actual, reference) {
  const n = Math.min(actual.length, reference.length);
  if (n <= 0) return 0;
  let sq = 0;
  for (let i = 0; i < n; i++) { const d = (actual[i] ?? 0) - (reference[i] ?? 0); sq += d * d; }
  return Math.sqrt(sq / n);
}
function maxRelError(actual, reference) {
  const n = Math.min(actual.length, reference.length);
  if (n <= 0) return 0;
  let peak = 0, maxErr = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.abs(reference[i] ?? 0);
    if (r > peak) peak = r;
    const err = Math.abs((actual[i] ?? 0) - (reference[i] ?? 0));
    if (err > maxErr) maxErr = err;
  }
  return peak > 1e-12 ? maxErr / peak : maxErr;
}
function resampleUniform(x, y, dt) {
  const n = Math.min(x.length, y.length);
  if (n <= 0 || dt <= 0) return { x: [], y: [] };
  if (n === 1) return { x: [x[0] ?? 0], y: [y[0] ?? 0] };
  const t0 = x[0] ?? 0, tEnd = x[n - 1] ?? t0;
  const outX = [], outY = [];
  let seg = 0;
  for (let t = t0; t <= tEnd + dt * 1e-9; t += dt) {
    const tc = Math.min(t, tEnd);
    while (seg + 1 < n - 1 && (x[seg + 1] ?? tEnd) < tc) seg++;
    const x0 = x[seg] ?? t0, x1 = x[seg + 1] ?? x0;
    const y0 = y[seg] ?? 0, y1 = y[seg + 1] ?? y0;
    const span = x1 - x0;
    const alpha = span > 1e-15 ? (tc - x0) / span : 0;
    outX.push(tc);
    outY.push(y0 + alpha * (y1 - y0));
  }
  return { x: outX, y: outY };
}
function stepResponseMetrics(t, y, target) {
  const n = Math.min(t.length, y.length);
  if (n <= 0) return { initialValue: 0, finalValue: 0, targetValue: target ?? 0, peakValue: 0, peakTime: 0, overshootPct: 0, riseTime: 0, settlingTime2Pct: 0, steadyStateError: 0 };
  const y0 = y[0] ?? 0, yFinal = y[n - 1] ?? y0, yTarget = target ?? yFinal;
  const stepSpan = yFinal - y0, dir = stepSpan >= 0 ? 1 : -1;
  let peakValue = y0, peakTime = t[0] ?? 0;
  for (let i = 0; i < n; i++) {
    const val = y[i] ?? 0;
    if ((val - peakValue) * dir > 0) { peakValue = val; peakTime = t[i] ?? 0; }
  }
  const denom = Math.abs(stepSpan);
  const overshootPct = denom > 1e-12 ? Math.max(0, ((peakValue - yFinal) * dir) / denom) * 100 : 0;
  let t10 = t[0] ?? 0, t90 = t[n - 1] ?? t10, found10 = false, found90 = false;
  if (denom > 1e-12) {
    const l10 = y0 + 0.1 * stepSpan, l90 = y0 + 0.9 * stepSpan;
    for (let i = 0; i < n; i++) {
      const val = y[i] ?? 0;
      if (!found10 && (val - l10) * dir >= 0) { t10 = t[i] ?? 0; found10 = true; }
      if (!found90 && (val - l90) * dir >= 0) { t90 = t[i] ?? 0; found90 = true; break; }
    }
  }
  const riseTime = found10 && found90 ? Math.max(0, t90 - t10) : 0;
  const band = Math.max(0.02 * Math.max(denom, Math.abs(yFinal)), 1e-9);
  let settlingTime2Pct = t[0] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs((y[i] ?? 0) - yFinal) > band) { settlingTime2Pct = t[Math.min(i + 1, n - 1)] ?? t[i] ?? 0; break; }
  }
  return { initialValue: y0, finalValue: yFinal, targetValue: yTarget, peakValue, peakTime, overshootPct, riseTime, settlingTime2Pct, steadyStateError: Math.abs(yTarget - yFinal) };
}
function hannWindow(samples) {
  const n = samples.length;
  if (n <= 0) return [];
  if (n === 1) return [samples[0] ?? 0];
  const out = new Array(n);
  const denom = n - 1;
  for (let i = 0; i < n; i++) out[i] = (samples[i] ?? 0) * 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
  return out;
}
function rfft(samples) {
  const nIn = samples.length;
  let n = 2;
  while (n < nIn) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < nIn; i++) re[i] = samples[i] ?? 0;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wlenRe = Math.cos(ang), wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe; im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe; wRe = nextWRe;
      }
    }
  }
  const halfBins = (n >> 1) + 1, magnitudes = new Array(halfBins), phases = new Array(halfBins);
  const scale = nIn > 0 ? 1 / nIn : 1;
  for (let k = 0; k < halfBins; k++) {
    const mult = k === 0 || k === n >> 1 ? 1 : 2;
    magnitudes[k] = Math.hypot(re[k], im[k]) * scale * mult;
    phases[k] = Math.atan2(im[k], re[k]);
  }
  return { magnitudes, phases, fftSize: n, bins: (sr) => Array.from({ length: halfBins }, (_, k) => (k * sr) / n) };
}
function integrateTrapezoidal(x, y) {
  const n = Math.min(x.length, y.length);
  if (n <= 1) return 0;
  let area = 0;
  for (let i = 1; i < n; i++) area += 0.5 * ((y[i] ?? 0) + (y[i - 1] ?? 0)) * ((x[i] ?? 0) - (x[i - 1] ?? 0));
  return area;
}
function quantile(values, q) {
  const n = values.length;
  if (n <= 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const pos = Math.max(0, Math.min(1, q)) * (sorted.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] ?? 0;
  const alpha = pos - lo;
  return (sorted[lo] ?? 0) * (1 - alpha) + (sorted[hi] ?? 0) * alpha;
}
function histogram(values, bins = 10) {
  const n = values.length, k = Math.max(1, Math.floor(bins));
  if (n <= 0) return { binCenters: [], counts: [], edges: [] };
  let minV = values[0] ?? 0, maxV = minV;
  for (let i = 1; i < n; i++) { const v = values[i] ?? 0; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  const span = maxV - minV > 1e-12 ? maxV - minV : 1, width = span / k;
  const counts = new Array(k).fill(0);
  const edges = Array.from({ length: k + 1 }, (_, i) => minV + i * width);
  const binCenters = Array.from({ length: k }, (_, i) => minV + (i + 0.5) * width);
  for (let i = 0; i < n; i++) {
    const idx = Math.min(k - 1, Math.max(0, Math.floor(((values[i] ?? 0) - minV) / width)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return { binCenters, counts, edges };
}
function nelderMead(objective, x0, options = {}) {
  const dim = x0.length;
  if (dim === 0) return { x: [], fx: objective([]), iterations: 0, converged: true };
  const maxIter = options.maxIterations ?? 200 * dim, tol = options.tolerance ?? 1e-6, step = options.initialStep ?? 0.1;
  const simplex = [{ pt: [...x0], val: objective(x0) }];
  for (let i = 0; i < dim; i++) {
    const pt = [...x0];
    pt[i] = (pt[i] ?? 0) + (Math.abs(pt[i] ?? 0) > 1e-6 ? Math.abs(pt[i]) * step : step);
    simplex.push({ pt, val: objective(pt) });
  }
  let iter = 0, converged = false;
  while (iter < maxIter) {
    simplex.sort((a, b) => a.val - b.val);
    const best = simplex[0], worst = simplex[dim], secondWorst = simplex[dim - 1];
    let maxDiff = 0;
    for (let i = 1; i <= dim; i++) maxDiff = Math.max(maxDiff, Math.abs(simplex[i].val - best.val));
    if (maxDiff < tol) { converged = true; break; }
    const centroid = new Array(dim).fill(0);
    for (let i = 0; i < dim; i++) for (let d = 0; d < dim; d++) centroid[d] += simplex[i].pt[d];
    for (let d = 0; d < dim; d++) centroid[d] /= dim;
    const xr = centroid.map((c, d) => c + (c - worst.pt[d]));
    const fr = objective(xr);
    if (fr < best.val) {
      const xe = centroid.map((c, d) => c + 2 * (xr[d] - c));
      const fe = objective(xe);
      simplex[dim] = fe < fr ? { pt: xe, val: fe } : { pt: xr, val: fr };
    } else if (fr < secondWorst.val) {
      simplex[dim] = { pt: xr, val: fr };
    } else {
      const xc = fr < worst.val ? centroid.map((c, d) => c + 0.5 * (xr[d] - c)) : centroid.map((c, d) => c + 0.5 * (worst.pt[d] - c));
      const fc = objective(xc);
      if (fc < worst.val) simplex[dim] = { pt: xc, val: fc };
      else for (let i = 1; i <= dim; i++) { const shrunk = best.pt.map((b, d) => b + 0.5 * (simplex[i].pt[d] - b)); simplex[i] = { pt: shrunk, val: objective(shrunk) }; }
    }
    iter++;
  }
  simplex.sort((a, b) => a.val - b.val);
  return { x: simplex[0].pt, fx: simplex[0].val, iterations: iter, converged };
}
function parseDelimitedTable(text, options = {}) {
  const commentPrefix = options.commentPrefix ?? "#";
  const lines = text.split(/\\r?\\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith(commentPrefix) && !l.startsWith("//"));
  if (lines.length === 0) return { headers: [], rows: [], columns: {} };
  const splitLine = (line) => {
    if (options.delimiter) return line.split(options.delimiter).map((c) => c.trim());
    if (line.includes(",")) return line.split(",").map((c) => c.trim());
    if (line.includes("\\t")) return line.split("\\t").map((c) => c.trim());
    return line.split(/\\s+/).map((c) => c.trim());
  };
  const firstCells = splitLine(lines[0]);
  const looksNumeric = firstCells.every((c) => c !== "" && Number.isFinite(Number(c)));
  const hasHeader = options.hasHeader ?? !looksNumeric;
  const headers = hasHeader ? firstCells : firstCells.map((_, idx) => "col" + idx);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const columns = {};
  for (const h of headers) columns[h] = [];
  const rows = [];
  for (const line of dataLines) {
    const cells = splitLine(line);
    const row = [];
    for (let i = 0; i < headers.length; i++) {
      const raw = cells[i] ?? "";
      const num = raw !== "" ? Number(raw) : Number.NaN;
      if (Number.isFinite(num)) { row.push(num); columns[headers[i]].push(num); }
      else row.push(raw);
    }
    rows.push(row);
  }
  return { headers, rows, columns };
}
function parseComtradeAscii(cfgText, datText) {
  const cfgLines = cfgText.split(/\\r?\\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const headerParts = (cfgLines[0] ?? "Station,Device,1999").split(",");
  const stationName = (headerParts[0] ?? "Station").trim(), deviceId = (headerParts[1] ?? "Device").trim();
  const countParts = (cfgLines[1] ?? "0,0A,0D").split(",");
  const analogCount = Number.parseInt(countParts[1] ?? "0", 10) || 0;
  const analogSpecs = [];
  for (let i = 0; i < analogCount; i++) {
    const parts = (cfgLines[2 + i] ?? "").split(",");
    analogSpecs.push({
      name: (parts[1] ?? ("ch" + (i + 1))).trim() || ("ch" + (i + 1)),
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
  const time = [], channels = {};
  for (const spec of analogSpecs) channels[spec.name] = { unit: spec.unit, values: [] };
  const datLines = datText.split(/\\r?\\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  for (let r = 0; r < datLines.length; r++) {
    const parts = datLines[r].split(",");
    const tsRaw = Number.parseFloat(parts[1] ?? "");
    time.push(Number.isFinite(tsRaw) ? tsRaw * 1e-6 * timeMult : r / sampleRateHz);
    for (let i = 0; i < analogSpecs.length; i++) {
      const spec = analogSpecs[i], rawVal = Number.parseFloat(parts[2 + i] ?? "0");
      channels[spec.name].values.push(Number.isFinite(rawVal) ? spec.a * rawVal + spec.b : 0);
    }
  }
  return { stationName, deviceId, lineFrequencyHz, sampleRateHz, time, channels };
}
function interpolateEnvelopeBound(p0, p1, t, key, mode) {
  const b0 = p0[key], b1 = p1[key];
  if (mode === "hold" || b0 === undefined || b1 === undefined || p1.time === p0.time) {
    return b0 !== undefined ? b0 : (t >= p1.time ? b1 : undefined);
  }
  return b0 + ((t - p0.time) / (p1.time - p0.time)) * (b1 - b0);
}
function checkEnvelope(time, value, envelope, options) {
  const n = Math.min(time.length, value.length);
  if (n === 0 || !envelope || envelope.length === 0) {
    return { ok: true, checkedSamples: 0, violationCount: 0, worstMargin: Infinity, violations: [] };
  }
  const sorted = envelope.slice().sort((a, b) => a.time - b.time);
  const mode = options && options.mode ? options.mode : "linear";
  const minT = sorted[0].time, maxT = sorted[sorted.length - 1].time;
  const violations = [];
  let checkedSamples = 0, worstMargin = Infinity, seg = 0;
  for (let i = 0; i < n; i++) {
    const t = time[i], v = value[i];
    if (!Number.isFinite(t) || !Number.isFinite(v) || t < minT || t > maxT) continue;
    checkedSamples++;
    while (seg + 1 < sorted.length && sorted[seg + 1].time < t) seg++;
    const p0 = sorted[seg], p1 = sorted[Math.min(seg + 1, sorted.length - 1)];
    const lo = interpolateEnvelopeBound(p0, p1, t, "min", mode);
    if (lo !== undefined && Number.isFinite(lo)) {
      const m = v - lo;
      if (m < worstMargin) worstMargin = m;
      if (v < lo) violations.push({ time: t, value: v, bound: "min", limit: lo, margin: m });
    }
    const hi = interpolateEnvelopeBound(p0, p1, t, "max", mode);
    if (hi !== undefined && Number.isFinite(hi)) {
      const m = hi - v;
      if (m < worstMargin) worstMargin = m;
      if (v > hi) violations.push({ time: t, value: v, bound: "max", limit: hi, margin: m });
    }
  }
  return { ok: violations.length === 0, checkedSamples, violationCount: violations.length, worstMargin, violations };
}
function slidingPhasor(time, signal, nominalFreqHz = 60, windowCycles = 1) {
  const n = Math.min(time.length, signal.length);
  if (n < 2 || nominalFreqHz <= 0 || windowCycles <= 0) {
    return { times: [], magnitude: [], phaseRad: [], frequencyHz: nominalFreqHz };
  }
  const span = time[n - 1] - time[0];
  const avgDt = span > 0 ? span / (n - 1) : 1 / (nominalFreqHz * 16);
  const winLen = Math.min(n, Math.max(4, Math.round(windowCycles / nominalFreqHz / avgDt)));
  const omega = 2 * Math.PI * nominalFreqHz;
  const times = [], magnitude = [], phaseRad = [], scale = 2 / winLen;
  for (let end = winLen - 1; end < n; end++) {
    let re = 0, im = 0;
    for (let k = end - winLen + 1; k <= end; k++) {
      const angle = omega * time[k], x = signal[k];
      re += x * Math.cos(angle);
      im -= x * Math.sin(angle);
    }
    const rs = re * scale, is = im * scale;
    times.push(time[end]);
    magnitude.push(Math.hypot(rs, is));
    phaseRad.push(Math.atan2(is, rs));
  }
  return { times, magnitude, phaseRad, frequencyHz: nominalFreqHz };
}
function symmetricalComponents(phaseA, phaseB, phaseC) {
  const n = Math.min(phaseA.mag.length, phaseA.phaseRad.length, phaseB.mag.length, phaseB.phaseRad.length, phaseC.mag.length, phaseC.phaseRad.length);
  const aRe = -0.5, aIm = Math.sqrt(3) / 2;
  const zeroMag = new Array(n), positiveMag = new Array(n), negativeMag = new Array(n), positivePhaseRad = new Array(n), unbalanceFactor = new Array(n);
  for (let i = 0; i < n; i++) {
    const ar = phaseA.mag[i] * Math.cos(phaseA.phaseRad[i]), ai = phaseA.mag[i] * Math.sin(phaseA.phaseRad[i]);
    const br = phaseB.mag[i] * Math.cos(phaseB.phaseRad[i]), bi = phaseB.mag[i] * Math.sin(phaseB.phaseRad[i]);
    const cr = phaseC.mag[i] * Math.cos(phaseC.phaseRad[i]), ci = phaseC.mag[i] * Math.sin(phaseC.phaseRad[i]);
    const abRe = aRe * br - aIm * bi, abIm = aRe * bi + aIm * br;
    const a2bRe = aRe * br + aIm * bi, a2bIm = aRe * bi - aIm * br;
    const acRe = aRe * cr - aIm * ci, acIm = aRe * ci + aIm * cr;
    const a2cRe = aRe * cr + aIm * ci, a2cIm = aRe * ci - aIm * cr;
    zeroMag[i] = Math.hypot(ar + br + cr, ai + bi + ci) / 3;
    const v1Re = (ar + abRe + a2cRe) / 3, v1Im = (ai + abIm + a2cIm) / 3;
    const v2Re = (ar + a2bRe + acRe) / 3, v2Im = (ai + a2bIm + acIm) / 3;
    const pMag = Math.hypot(v1Re, v1Im), nMag = Math.hypot(v2Re, v2Im);
    positiveMag[i] = pMag; negativeMag[i] = nMag;
    positivePhaseRad[i] = Math.atan2(v1Im, v1Re);
    unbalanceFactor[i] = pMag > 1e-12 ? nMag / pMag : 0;
  }
  return { zeroMag, positiveMag, negativeMag, positivePhaseRad, unbalanceFactor };
}
const sdkModule = { ResultBuilder, mean, std, rmse, maxRelError, resampleUniform, stepResponseMetrics, hannWindow, rfft, integrateTrapezoidal, quantile, histogram, nelderMead, parseDelimitedTable, parseComtradeAscii, checkEnvelope, slidingPhasor, symmetricalComponents };
`;

const WORKER_EXECUTOR_SOURCE = `
function resolveModuleId(fromFile, spec, modules) {
  if (spec === "@modelscript/sdk" || spec.startsWith("@modelscript/sdk/")) return "@modelscript/sdk";
  if (!spec.startsWith("./") && !spec.startsWith("../")) {
    throw new Error("Unsupported import '" + spec + "' in isolated TypeScript kernel. Only relative workspace imports and '@modelscript/sdk' are permitted.");
  }
  const baseParts = fromFile.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") baseParts.pop();
    else baseParts.push(seg);
  }
  const joined = baseParts.join("/");
  const candidates = [joined, joined.replace(/\\.js$/, ".ts"), joined + ".ts", joined + ".js", joined + "/index.ts", joined + "/index.js"];
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(modules, c)) return c;
  }
  throw new Error("Cannot resolve module '" + spec + "' imported from '" + fromFile + "'.");
}

async function executeCompiledModules(modules, entryFile, exportName, input, ctx) {
  const loaded = Object.create(null);
  function loadModule(id) {
    if (id === "@modelscript/sdk") return sdkModule;
    if (Object.prototype.hasOwnProperty.call(loaded, id)) return loaded[id].exports;
    const code = modules[id];
    if (typeof code !== "string") throw new Error("Module not found: " + id);
    const mod = { exports: {} };
    loaded[id] = mod;
    const req = (spec) => loadModule(resolveModuleId(id, spec, modules));
    const fn = new Function("exports", "require", "module", code);
    fn(mod.exports, req, mod);
    return mod.exports;
  }

  const entryExports = loadModule(entryFile);
  const target = entryExports && (entryExports[exportName] ?? entryExports.default);
  if (typeof target !== "function") {
    throw new Error("TypeScript module '" + entryFile + "' does not export function '" + exportName + "'.");
  }
  const res = await Promise.resolve(target(input, ctx));
  if (!res || typeof res !== "object") {
    throw new Error("TypeScript kernel '" + exportName + "' must return a KernelResult object.");
  }
  return res;
}
`;

const WORKER_RPC_CLIENT_SOURCE = `
function createWorkerContext(postMsg) {
  let nextRpcId = 1;
  const pending = new Map();
  function callHost(method, args) {
    return new Promise((resolve, reject) => {
      const id = nextRpcId++;
      pending.set(id, { resolve, reject });
      postMsg({ type: "rpc", id, method, args });
    });
  }
  function handleRpcResponse(msg) {
    if (!msg || msg.type !== "rpc-res") return false;
    const entry = pending.get(msg.id);
    if (!entry) return true;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.value);
    else entry.reject(new Error(msg.error || "Host RPC failed"));
    return true;
  }
  const ctx = {
    readFile: (relPath) => callHost("readFile", [relPath]),
    readBinary: (relPath) => callHost("readBinary", [relPath]),
    writeArtifact: (relPath, data) => callHost("writeArtifact", [relPath, data]),
    inspect: (modelPath, options) => callHost("inspect", [modelPath, options]),
    simulate: (modelPath, options) => callHost("simulate", [modelPath, options]),
    runBatch: (tasks, concurrency) => callHost("runBatch", [tasks, concurrency]),
    progress: (percent, message) => postMsg({ type: "progress", percent, message }),
  };
  return { ctx, handleRpcResponse };
}
`;

async function defaultHostRunBatch(
  host: KernelHostHandlers | undefined,
  tasks: KernelBatchTask[],
  concurrency = 4,
): Promise<KernelBatchItemResult[]> {
  if (!host?.simulate) {
    throw new Error("Host runBatch() / simulate() is not configured for this kernel run.");
  }
  const results: KernelBatchItemResult[] = new Array(tasks.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), Math.max(1, tasks.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < tasks.length) {
      const idx = cursor++;
      const task = tasks[idx]!;
      const id = task.id ?? `task_${idx}`;
      try {
        const waveforms = await Promise.resolve(host.simulate!(task.modelPath, task.options));
        results[idx] = { id, ok: true, waveforms };
      } catch (err) {
        results[idx] = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function dispatchHostRpcCall(
  host: KernelHostHandlers | undefined,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (method === "readFile") {
    if (!host?.readFile) throw new Error("Host readFile() is not configured for this kernel run.");
    return await Promise.resolve(host.readFile(String(args[0] ?? "")));
  }
  if (method === "readBinary") {
    if (!host?.readBinary) throw new Error("Host readBinary() is not configured for this kernel run.");
    return await Promise.resolve(host.readBinary(String(args[0] ?? "")));
  }
  if (method === "writeArtifact") {
    if (!host?.writeArtifact) throw new Error("Host writeArtifact() is not configured for this kernel run.");
    return await Promise.resolve(host.writeArtifact(String(args[0] ?? ""), args[1] as string | Uint8Array));
  }
  if (method === "inspect") {
    if (!host?.inspect) throw new Error("Host inspect() is not configured for this kernel run.");
    return await Promise.resolve(host.inspect(String(args[0] ?? ""), args[1] as KernelInspectOptions | undefined));
  }
  if (method === "simulate") {
    if (!host?.simulate) throw new Error("Host simulate() is not configured for this kernel run.");
    return await Promise.resolve(host.simulate(String(args[0] ?? ""), args[1] as KernelSimulateOptions | undefined));
  }
  if (method === "runBatch") {
    const tasks = (Array.isArray(args[0]) ? args[0] : []) as KernelBatchTask[];
    const concurrency = typeof args[1] === "number" ? args[1] : undefined;
    if (host?.runBatch) {
      return await Promise.resolve(host.runBatch(tasks, concurrency));
    }
    return await defaultHostRunBatch(host, tasks, concurrency);
  }
  throw new Error(`Unknown host RPC method '${method}'.`);
}

async function handleHostRpc(
  msg: { type?: string; id?: number; method?: string; args?: unknown[]; percent?: number; message?: string },
  host: KernelHostHandlers | undefined,
  reply: (payload: { type: "rpc-res"; id: number; ok: boolean; value?: unknown; error?: string }) => void,
): Promise<boolean> {
  if (msg.type === "progress") {
    host?.onProgress?.(msg.percent ?? 0, msg.message);
    return true;
  }
  if (msg.type !== "rpc" || typeof msg.id !== "number") return false;
  const id = msg.id;
  try {
    const value = await dispatchHostRpcCall(host, String(msg.method ?? ""), msg.args ?? []);
    reply({ type: "rpc-res", id, ok: true, value });
  } catch (err) {
    reply({ type: "rpc-res", id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

async function runTsInWorker(
  modules: Record<string, string>,
  entryFile: string,
  exportName: string,
  input: KernelInput,
  timeoutMs: number,
  host?: KernelHostHandlers,
): Promise<KernelResult> {
  const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
  if (isNode) {
    const { Worker } = await import("node:worker_threads");
    const workerCode = `
      const { parentPort, workerData } = require("node:worker_threads");
      ${WORKER_SDK_SHIM_SOURCE}
      ${WORKER_EXECUTOR_SOURCE}
      ${WORKER_RPC_CLIENT_SOURCE}
      const { ctx, handleRpcResponse } = createWorkerContext((m) => parentPort.postMessage(m));
      parentPort.on("message", (msg) => { handleRpcResponse(msg); });
      (async () => {
        try {
          const { modules, entryFile, exportName, input } = workerData;
          const result = await executeCompiledModules(modules, entryFile, exportName, input, ctx);
          parentPort.postMessage({ type: "done", ok: true, result });
        } catch (err) {
          parentPort.postMessage({ type: "done", ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      })();
    `;

    return await new Promise<KernelResult>((resolve, reject) => {
      let settled = false;
      const worker = new Worker(workerCode, {
        eval: true,
        workerData: { modules, entryFile, exportName, input },
      });

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              void worker.terminate();
              reject(
                new Error(`TypeScript kernel '${exportName}' exceeded timeout of ${timeoutMs}ms and was terminated.`),
              );
            }, timeoutMs)
          : undefined;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        void worker.terminate();
        fn();
      };

      worker.on(
        "message",
        (msg: {
          type?: string;
          ok?: boolean;
          result?: KernelResult;
          error?: string;
          id?: number;
          method?: string;
          args?: unknown[];
          percent?: number;
          message?: string;
        }) => {
          if (msg.type === "rpc" || msg.type === "progress") {
            void handleHostRpc(msg, host, (reply) => worker.postMessage(reply));
            return;
          }
          finish(() => {
            if (msg.ok && msg.result) resolve(msg.result);
            else reject(new Error(msg.error ?? `TypeScript kernel '${exportName}' failed.`));
          });
        },
      );
      worker.once("error", (err: Error) => finish(() => reject(err)));
      worker.once("exit", (code: number) => {
        if (!settled && code !== 0) {
          finish(() => reject(new Error(`TypeScript worker exited with code ${code}.`)));
        }
      });
    });
  }

  if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
    const workerCode = `
      ${WORKER_SDK_SHIM_SOURCE}
      ${WORKER_EXECUTOR_SOURCE}
      ${WORKER_RPC_CLIENT_SOURCE}
      const { ctx, handleRpcResponse } = createWorkerContext((m) => self.postMessage(m));
      self.onmessage = async (ev) => {
        if (handleRpcResponse(ev.data)) return;
        try {
          const { modules, entryFile, exportName, input } = ev.data;
          const result = await executeCompiledModules(modules, entryFile, exportName, input, ctx);
          self.postMessage({ type: "done", ok: true, result });
        } catch (err) {
          self.postMessage({ type: "done", ok: false, error: err && err.message ? err.message : String(err) });
        }
      };
    `;
    const blobUrl = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));
    return await new Promise<KernelResult>((resolve, reject) => {
      let settled = false;
      const worker = new Worker(blobUrl);
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              worker.terminate();
              URL.revokeObjectURL(blobUrl);
              reject(
                new Error(`TypeScript kernel '${exportName}' exceeded timeout of ${timeoutMs}ms and was terminated.`),
              );
            }, timeoutMs)
          : undefined;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(blobUrl);
        fn();
      };

      worker.onmessage = (
        ev: MessageEvent<{
          type?: string;
          ok?: boolean;
          result?: KernelResult;
          error?: string;
          id?: number;
          method?: string;
          args?: unknown[];
          percent?: number;
          message?: string;
        }>,
      ) => {
        const msg = ev.data;
        if (msg.type === "rpc" || msg.type === "progress") {
          void handleHostRpc(msg, host, (reply) => worker.postMessage(reply));
          return;
        }
        finish(() => {
          if (msg.ok && msg.result) resolve(msg.result);
          else reject(new Error(msg.error ?? `TypeScript kernel '${exportName}' failed.`));
        });
      };
      worker.onerror = (ev: ErrorEvent) => finish(() => reject(new Error(ev.message)));
      worker.postMessage({ modules, entryFile, exportName, input });
    });
  }

  throw new Error("Preemptive Worker execution for TypeScript kernels is unavailable in this runtime.");
}

async function runTsInProcess(
  modules: Record<string, string>,
  entryFile: string,
  exportName: string,
  input: KernelInput,
  host?: KernelHostHandlers,
): Promise<KernelResult> {
  const sdkShim = {
    ResultBuilder: dsp.ResultBuilder,
    mean: dsp.mean,
    std: dsp.std,
    rmse: dsp.rmse,
    maxRelError: dsp.maxRelError,
    resampleUniform: dsp.resampleUniform,
    stepResponseMetrics: dsp.stepResponseMetrics,
    hannWindow: dsp.hannWindow,
    rfft: dsp.rfft,
    integrateTrapezoidal: dsp.integrateTrapezoidal,
    quantile: dsp.quantile,
    histogram: dsp.histogram,
    nelderMead: dsp.nelderMead,
    parseDelimitedTable: dsp.parseDelimitedTable,
    parseComtradeAscii: dsp.parseComtradeAscii,
    checkEnvelope: dsp.checkEnvelope,
    slidingPhasor: dsp.slidingPhasor,
    symmetricalComponents: dsp.symmetricalComponents,
  };
  const ctx: KernelContext = {
    readFile: (relPath) => dispatchHostRpcCall(host, "readFile", [relPath]) as Promise<string>,
    readBinary: (relPath) => dispatchHostRpcCall(host, "readBinary", [relPath]) as Promise<Uint8Array>,
    writeArtifact: (relPath, data) => dispatchHostRpcCall(host, "writeArtifact", [relPath, data]) as Promise<string>,
    inspect: (modelPath, opts) =>
      dispatchHostRpcCall(host, "inspect", [modelPath, opts]) as ReturnType<KernelContext["inspect"]>,
    simulate: (modelPath, opts) =>
      dispatchHostRpcCall(host, "simulate", [modelPath, opts]) as ReturnType<KernelContext["simulate"]>,
    runBatch: (tasks, concurrency) =>
      dispatchHostRpcCall(host, "runBatch", [tasks, concurrency]) as ReturnType<KernelContext["runBatch"]>,
    progress: (percent, message) => host?.onProgress?.(percent, message),
  };
  const loaded = new Map<string, { exports: Record<string, unknown> }>();

  const resolveModuleId = (fromFile: string, spec: string): string => {
    if (spec === "@modelscript/sdk" || spec.startsWith("@modelscript/sdk/")) return "@modelscript/sdk";
    if (!spec.startsWith("./") && !spec.startsWith("../")) {
      throw new Error(
        `Unsupported import '${spec}' in TypeScript kernel. Only relative workspace imports and '@modelscript/sdk' are permitted.`,
      );
    }
    const baseParts = fromFile.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") baseParts.pop();
      else baseParts.push(seg);
    }
    const joined = baseParts.join("/");
    const candidates = [
      joined,
      joined.replace(/\.js$/, ".ts"),
      `${joined}.ts`,
      `${joined}.js`,
      `${joined}/index.ts`,
      `${joined}/index.js`,
    ];
    for (const c of candidates) {
      if (Object.prototype.hasOwnProperty.call(modules, c)) return c;
    }
    throw new Error(`Cannot resolve module '${spec}' imported from '${fromFile}'.`);
  };

  const loadModule = (id: string): Record<string, unknown> => {
    if (id === "@modelscript/sdk") return sdkShim;
    const cached = loaded.get(id);
    if (cached) return cached.exports;
    const code = modules[id];
    if (typeof code !== "string") throw new Error(`Module not found: ${id}`);
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    loaded.set(id, mod);
    const req = (spec: string) => loadModule(resolveModuleId(id, spec));
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("exports", "require", "module", code);
    fn(mod.exports, req, mod);
    return mod.exports;
  };

  const entryExports = loadModule(entryFile);
  const target = (entryExports[exportName] ?? entryExports["default"]) as
    | ((inp: KernelInput, context?: KernelContext) => KernelResult | Promise<KernelResult>)
    | undefined;
  if (typeof target !== "function") {
    throw new Error(`TypeScript module '${entryFile}' does not export function '${exportName}'.`);
  }
  return await Promise.resolve(target(input, ctx));
}

/**
 * Compiles and executes a user-authored TypeScript capability (`ts://...#exportName`)
 * inside an isolated Worker with a `terminate()` watchdog by default.
 */
export async function runTsKernel(
  entryFile: string,
  files: Readonly<Record<string, string>>,
  exportName: string,
  input: KernelInput,
  options: RunTsKernelOptions = {},
): Promise<KernelResult> {
  const compiled = compileTypeScript(entryFile, files);
  if (!compiled.ok) {
    throw new Error(`TypeScript compile failed for ${entryFile}:\n${compiled.diagnostics.join("\n")}`);
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  const useWorker = options.preemptible !== false || timeoutMs > 0;
  if (useWorker) {
    return await runTsInWorker(compiled.modules, compiled.entryFile, exportName, input, timeoutMs, options.host);
  }
  return await runTsInProcess(compiled.modules, compiled.entryFile, exportName, input, options.host);
}
