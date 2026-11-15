// SPDX-License-Identifier: AGPL-3.0-or-later

export interface AscCompileOptions {
  optimize?: boolean;
  extraArgs?: string[];
}

export interface AscCompileResult {
  ok: boolean;
  wasmBytes?: Uint8Array;
  diagnostics: string[];
  cached?: boolean;
}

const SDK_ASSEMBLY_BUILTIN = `
export function msx_alloc(size: i32): usize {
  return heap.alloc(size as usize);
}

export function packResult(ptr: usize, len: i32): u64 {
  return ((ptr as u64) << 32) | ((len as u64) & 0xffffffff);
}

export function decodeUtf8(ptr: usize, len: i32): string {
  return String.UTF8.decodeUnsafe(ptr, len);
}

export function returnJsonResult(json: string): u64 {
  const buf = String.UTF8.encode(json, false);
  const len = buf.byteLength;
  const ptr = heap.alloc(len as usize);
  memory.copy(ptr, changetype<usize>(buf), len as usize);
  return packResult(ptr, len);
}

export function jsonEscape(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (ch == "\\\\") out += "\\\\\\\\";
    else if (ch == "\\"") out += "\\\\\\"";
    else if (ch == "\\n") out += "\\\\n";
    else if (ch == "\\r") out += "\\\\r";
    else if (ch == "\\t") out += "\\\\t";
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

export function allocF64(len: i32): usize {
  return heap.alloc((len as usize) << 3);
}

@inline
export function loadF64(ptr: usize, index: i32): f64 {
  return load<f64>(ptr + ((index as usize) << 3));
}

@inline
export function storeF64(ptr: usize, index: i32, value: f64): void {
  store<f64>(ptr + ((index as usize) << 3), value);
}

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
    \`{"kind":"\${jsonEscape(kind)}","id":"\${jsonEscape(id)}","title":"\${jsonEscape(title)}",\` +
    \`"xLabel":"\${jsonEscape(xLabel)}","yLabel":"\${jsonEscape(yLabel)}",\` +
    \`"series":[{"name":"\${jsonEscape(seriesName)}","xPtr":\${xPtr},"yPtr":\${yPtr},"len":\${len}}]}\`
  );
}

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
    \`{"ok":\${ok ? "true" : "false"},"kernelId":"\${jsonEscape(kernelId)}",\` +
    \`"summary":"\${jsonEscape(summary)}","artifacts":\${arts}}\`
  );
}

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
  const needle = '"' + key + '":';
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

export function getParamBool(json: string, key: string, fallback: boolean = false): boolean {
  const start = findJsonValueStart(json, key);
  if (start < 0) return fallback;
  if (json.startsWith("true", start)) return true;
  if (json.startsWith("false", start)) return false;
  return fallback;
}

export function getParamString(json: string, key: string, fallback: string = ""): string {
  const start = findJsonValueStart(json, key);
  if (start < 0 || json.charCodeAt(start) != 34) return fallback;
  let out = "";
  let i = start + 1;
  while (i < json.length) {
    const ch = json.charCodeAt(i);
    if (ch == 92 && i + 1 < json.length) {
      const next = json.charCodeAt(i + 1);
      if (next == 110) out += "\\n";
      else if (next == 114) out += "\\r";
      else if (next == 116) out += "\\t";
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
`;

function normalizeVfsPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

const wasmCompileCache = new Map<string, Uint8Array>();

function hashStringFnv1a(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function computeCompileCacheKey(entryPath: string, files: Record<string, string>, options: AscCompileOptions): string {
  const sortedEntries = Object.entries(files)
    .map(([k, v]) => [normalizeVfsPath(k), v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const payload = JSON.stringify({
    entry: normalizeVfsPath(entryPath),
    optimize: Boolean(options.optimize),
    extraArgs: options.extraArgs ?? [],
    files: sortedEntries,
  });
  return `${payload.length}:${hashStringFnv1a(payload)}`;
}

/** Clears the in-memory AssemblyScript WASM compile cache. */
export function clearCompileCache(): void {
  wasmCompileCache.clear();
}

/**
 * Compiles a user-authored AssemblyScript file completely in-memory
 * (works in both Node and browser Web Workers via `assemblyscript/asc`),
 * with content-addressed caching so unchanged sources re-run in <1ms.
 */
export async function compileAssemblyScript(
  entryPath: string,
  files: Record<string, string>,
  options: AscCompileOptions = {},
): Promise<AscCompileResult> {
  const cacheKey = computeCompileCacheKey(entryPath, files, options);
  const cachedBytes = wasmCompileCache.get(cacheKey);
  if (cachedBytes) {
    return {
      ok: true,
      wasmBytes: cachedBytes,
      diagnostics: [],
      cached: true,
    };
  }

  const asc = await import("assemblyscript/asc");

  const vfs = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) {
    vfs.set(normalizeVfsPath(k), v);
  }
  vfs.set("node_modules/@modelscript/sdk/assembly/index.ts", SDK_ASSEMBLY_BUILTIN);
  vfs.set(
    "node_modules/@modelscript/sdk/package.json",
    JSON.stringify({ name: "@modelscript/sdk", main: "assembly/index.ts" }),
  );

  const diagnostics: string[] = [];
  let wasmBytes: Uint8Array | undefined;
  const normalizedEntry = normalizeVfsPath(entryPath);

  const args = [
    normalizedEntry,
    "--outFile",
    "capability.wasm",
    "--exportRuntime",
    ...(options.optimize ? ["-O3"] : []),
    ...(options.extraArgs ?? []),
  ];

  const { error } = await asc.main(args, {
    readFile(filename: string) {
      const norm = normalizeVfsPath(filename);
      if (vfs.has(norm)) return vfs.get(norm) ?? null;
      if (norm.endsWith("@modelscript/sdk/assembly.ts") || norm.endsWith("@modelscript/sdk/assembly/index.ts")) {
        return SDK_ASSEMBLY_BUILTIN;
      }
      return null;
    },
    writeFile(filename: string, contents: Uint8Array | string) {
      if (filename === "capability.wasm" && contents instanceof Uint8Array) {
        wasmBytes = new Uint8Array(contents);
      }
    },
    listFiles(dirname: string) {
      const prefix = normalizeVfsPath(dirname).replace(/\/$/, "");
      const out: string[] = [];
      for (const k of vfs.keys()) {
        if (prefix === "" || prefix === "." || k.startsWith(`${prefix}/`)) {
          out.push(k);
        }
      }
      return out;
    },
    stderr: {
      write(chunk: Uint8Array | string) {
        const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        if (text.trim()) diagnostics.push(text.trim());
      },
    },
    stdout: {
      write() {
        /* ignore */
      },
    },
  });

  if (error || !wasmBytes) {
    if (error && !diagnostics.includes(error.message)) {
      diagnostics.push(error.message);
    }
    return { ok: false, diagnostics, cached: false };
  }

  wasmCompileCache.set(cacheKey, wasmBytes);
  return { ok: true, wasmBytes, diagnostics, cached: false };
}
