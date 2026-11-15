// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript SDK runtime helpers for user-authored ModelScript capabilities.
 * Compile user modules with `asc` (in Node or in-browser Web Worker) to `.wasm`.
 */

/** Allocate UTF-8 / binary buffer inside WASM linear memory for host marshaling. */
export function msx_alloc(size: i32): usize {
  return heap.alloc(size as usize);
}

/** Pack `(ptr, len)` into a single 64-bit return value for `msx_run_json`. */
export function packResult(ptr: usize, len: i32): u64 {
  return ((ptr as u64) << 32) | ((len as u64) & 0xffffffff);
}

/** Decode a UTF-8 buffer passed from the host into an AssemblyScript `string`. */
export function decodeUtf8(ptr: usize, len: i32): string {
  return String.UTF8.decodeUnsafe(ptr, len);
}

/** Encode a JSON `string` into WASM linear memory and return packed `(ptr, len)` for `msx_run_json`. */
export function returnJsonResult(json: string): u64 {
  const buf = String.UTF8.encode(json, false);
  const len = buf.byteLength;
  const ptr = heap.alloc(len as usize);
  memory.copy(ptr, changetype<usize>(buf), len as usize);
  return packResult(ptr, len);
}

/** Escape a string for safe inclusion inside a JSON string literal. */
export function jsonEscape(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (ch == "\\") out += "\\\\";
    else if (ch == "\"") out += "\\\"";
    else if (ch == "\n") out += "\\n";
    else if (ch == "\r") out += "\\r";
    else if (ch == "\t") out += "\\t";
    else out += ch;
  }
  return out;
}

function floatArrayToJson(arr: Float64Array): string {
  let out = "[";
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) out += ",";
    out += unchecked(arr[i]).toString();
  }
  out += "]";
  return out;
}

/** Allocate an `f64` buffer of `len` elements in WASM linear memory. */
export function allocF64(len: i32): usize {
  return heap.alloc((len as usize) << 3);
}

/** Read an `f64` element at `index` from a linear-memory pointer. */
@inline
export function loadF64(ptr: usize, index: i32): f64 {
  return load<f64>(ptr + ((index as usize) << 3));
}

/** Write an `f64` element at `index` to a linear-memory pointer. */
@inline
export function storeF64(ptr: usize, index: i32, value: f64): void {
  store<f64>(ptr + ((index as usize) << 3), value);
}

/**
 * Build a zero-copy `timeseries` or `bode` `VisualArtifact` JSON descriptor
 * referencing raw `Float64Array` buffers in WASM linear memory (`xPtr`, `yPtr`, `len`)
 * without stringifying numeric samples.
 */
export function plotSeriesRefJson(
  kind: string,
  id: string,
  title: string,
  xLabel: string,
  yLabel: string,
  seriesName: string,
  xPtr: usize,
  yPtr: usize,
  len: i32,
): string {
  return (
    `{"kind":"${jsonEscape(kind)}","id":"${jsonEscape(id)}","title":"${jsonEscape(title)}",` +
    `"xLabel":"${jsonEscape(xLabel)}","yLabel":"${jsonEscape(yLabel)}",` +
    `"series":[{"name":"${jsonEscape(seriesName)}","xPtr":${xPtr},"yPtr":${yPtr},"len":${len}}]}`
  );
}

/** Build a `timeseries` or `bode` `VisualArtifact` JSON fragment from `Float64Array` data. */
export function plotSeriesJson(
  kind: string,
  id: string,
  title: string,
  xLabel: string,
  yLabel: string,
  seriesName: string,
  x: Float64Array,
  y: Float64Array,
): string {
  const n = x.length < y.length ? x.length : y.length;
  const byteLen = (n as usize) << 3;
  const xPtr = heap.alloc(byteLen);
  const yPtr = heap.alloc(byteLen);
  memory.copy(xPtr, x.dataStart, byteLen);
  memory.copy(yPtr, y.dataStart, byteLen);
  return plotSeriesRefJson(kind, id, title, xLabel, yLabel, seriesName, xPtr, yPtr, n);
}

/** Build a complete `KernelResult` JSON string for `returnJsonResult(...)`. */
export function kernelResultJson(
  ok: boolean,
  kernelId: string,
  summary: string,
  artifactsJson: string[] = [],
): string {
  let arts = "[";
  for (let i = 0; i < artifactsJson.length; i++) {
    if (i > 0) arts += ",";
    arts += artifactsJson[i];
  }
  arts += "]";
  return (
    `{"ok":${ok ? "true" : "false"},"kernelId":"${jsonEscape(kernelId)}",` +
    `"summary":"${jsonEscape(summary)}","artifacts":${arts}}`
  );
}

/** Root-mean-square error between two equal-length `Float64Array` waveforms. */
export function rmse(actual: Float64Array, reference: Float64Array): f64 {
  const n = actual.length < reference.length ? actual.length : reference.length;
  if (n <= 0) return 0.0;
  let sumSq: f64 = 0.0;
  for (let i = 0; i < n; i++) {
    const diff = unchecked(actual[i]) - unchecked(reference[i]);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (n as f64));
}

/** Maximum relative error normalized by peak reference magnitude. */
export function maxRelError(actual: Float64Array, reference: Float64Array): f64 {
  const n = actual.length < reference.length ? actual.length : reference.length;
  if (n <= 0) return 0.0;
  let peak: f64 = 0.0;
  let maxErr: f64 = 0.0;
  for (let i = 0; i < n; i++) {
    const r = Math.abs(unchecked(reference[i]));
    if (r > peak) peak = r;
    const err = Math.abs(unchecked(actual[i]) - unchecked(reference[i]));
    if (err > maxErr) maxErr = err;
  }
  return peak > 1e-12 ? maxErr / peak : maxErr;
}

function findJsonValueStart(json: string, key: string): i32 {
  const needle = `"${key}":`;
  const idx = json.indexOf(needle);
  if (idx < 0) return -1;
  let pos = idx + needle.length;
  while (pos < json.length) {
    const ch = json.charCodeAt(pos);
    if (ch != 32 && ch != 9 && ch != 10 && ch != 13) break;
    pos++;
  }
  return pos < json.length ? pos : -1;
}

/** Extract a numeric parameter from the JSON `KernelInput` string (returns `fallback` if missing/NaN). */
export function getParamF64(json: string, key: string, fallback: f64 = 0.0): f64 {
  const start = findJsonValueStart(json, key);
  if (start < 0) return fallback;
  let end = start;
  while (end < json.length) {
    const c = json.charCodeAt(end);
    const isNumChar =
      (c >= 48 && c <= 57) || c == 45 || c == 43 || c == 46 || c == 101 || c == 69;
    if (!isNumChar) break;
    end++;
  }
  if (end <= start) return fallback;
  const parsed = F64.parseFloat(json.slice(start, end));
  return isNaN(parsed) ? fallback : parsed;
}

/** Extract a boolean parameter from the JSON `KernelInput` string. */
export function getParamBool(json: string, key: string, fallback: boolean = false): boolean {
  const start = findJsonValueStart(json, key);
  if (start < 0) return fallback;
  if (json.startsWith("true", start)) return true;
  if (json.startsWith("false", start)) return false;
  return fallback;
}

/** Extract a string parameter from the JSON `KernelInput` string. */
export function getParamString(json: string, key: string, fallback: string = ""): string {
  const start = findJsonValueStart(json, key);
  if (start < 0 || json.charCodeAt(start) != 34) return fallback;
  let out = "";
  let i = start + 1;
  while (i < json.length) {
    const ch = json.charCodeAt(i);
    if (ch == 92 && i + 1 < json.length) {
      const next = json.charCodeAt(i + 1);
      if (next == 110) out += "\n";
      else if (next == 114) out += "\r";
      else if (next == 116) out += "\t";
      else out += json.charAt(i + 1);
      i += 2;
      continue;
    }
    if (ch == 34) break;
    out += json.charAt(i);
    i++;
  }
  return out;
}
