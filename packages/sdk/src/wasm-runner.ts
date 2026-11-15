// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ImplementationRef, KernelInput, KernelResult, VisualArtifact } from "./types.js";

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Infers whether a kernel module should execute as AssemblyScript/WASM (`"wasm"`)
 * or TypeScript (`"ts"`) based on file extension, `assembly/` directory, or imports.
 */
export function inferKernelScheme(modulePath: string, files?: Readonly<Record<string, string>>): "wasm" | "ts" {
  const norm = normalizeRelPath(modulePath);
  if (/\.wasm$/i.test(norm)) return "wasm";
  if (norm.startsWith("assembly/") || norm.includes("/assembly/")) return "wasm";
  if (files) {
    const src = files[norm] ?? files[modulePath] ?? files[`./${norm}`];
    if (src && /from\s+["']@modelscript\/sdk\/assembly["']/.test(src)) {
      return "wasm";
    }
  }
  return "ts";
}

/**
 * Parses a SysML v2 `implementation` reference. Supports both scheme-less paths
 * (recommended) and explicit legacy URI schemes:
 * - `./assembly/fitter.ts#fitWideband` (inferred as `"wasm"`)
 * - `./src/custom.ts#evaluate` (inferred as `"ts"`)
 * - `wasm://./assembly/fitter.ts#fitWideband`
 * - `ts://./src/custom.ts#evaluate`
 */
export function parseImplementationUri(
  uri: string,
  files?: Readonly<Record<string, string>>,
): ImplementationRef | null {
  const trimmed = uri.trim().replace(/^["']|["']$/g, "");
  const schemeMatch = /^(wasm|ts|sysml):\/\/([^#]+)(?:#([A-Za-z0-9_$-]+))?$/.exec(trimmed);
  if (schemeMatch) {
    return {
      scheme: schemeMatch[1] as ImplementationRef["scheme"],
      modulePath: schemeMatch[2] ?? "",
      exportName: schemeMatch[3] ?? "run",
    };
  }

  const pathMatch = /^([^#\s]+?\.(?:wasm|ts|tsx|js|mjs|mts))(?:#([A-Za-z0-9_$-]+))?$/i.exec(trimmed);
  if (!pathMatch?.[1]) return null;
  const modulePath = pathMatch[1];
  return {
    scheme: inferKernelScheme(modulePath, files),
    modulePath,
    exportName: pathMatch[2] ?? "run",
  };
}

/**
 * Convention-based auto-discovery of a TypeScript or AssemblyScript kernel implementation
 * for a SysML v2 definition when `attribute implementation` is omitted.
 *
 * Matches:
 * 1. `/** @sysml <DefName> * /` JSDoc annotation above an exported function
 * 2. Exported function matching `<DefName>`, `camelCase(<DefName>)`, or `snake_case(<DefName>)`
 */
export function discoverImplementationForDefinition(
  defName: string,
  files: Readonly<Record<string, string>>,
): ImplementationRef | null {
  const camel = defName.charAt(0).toLowerCase() + defName.slice(1);
  const snake = defName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const candidates = new Set([defName, camel, snake]);
  const tagRe = new RegExp(
    `@sysml\\s+${defName}\\b[\\s\\S]{0,200}?export\\s+(?:async\\s+)?function\\s+([A-Za-z_][A-Za-z0-9_]*)`,
  );
  const exportFnRe = /export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;

  const sortedPaths = Object.keys(files).sort();
  // Pass 1: explicit @sysml annotation
  for (const relPath of sortedPaths) {
    const src = files[relPath];
    if (!src) continue;
    const tagMatch = tagRe.exec(src);
    if (tagMatch?.[1]) {
      return {
        scheme: inferKernelScheme(relPath, files),
        modulePath: relPath,
        exportName: tagMatch[1],
      };
    }
  }

  // Pass 2: exported function name matches definition name (or camelCase / snake_case)
  for (const relPath of sortedPaths) {
    const src = files[relPath];
    if (!src) continue;
    exportFnRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = exportFnRe.exec(src)) !== null) {
      const fnName = m[1];
      if (fnName && candidates.has(fnName)) {
        return {
          scheme: inferKernelScheme(relPath, files),
          modulePath: relPath,
          exportName: fnName,
        };
      }
    }
  }

  return null;
}

interface RawBinarySeries {
  name: string;
  x?: number[];
  y?: number[];
  xPtr?: number;
  yPtr?: number;
  len?: number;
}

function hydrateBinaryArtifacts(
  artifacts: VisualArtifact[] | undefined,
  memory: WebAssembly.Memory,
): VisualArtifact[] | undefined {
  if (!artifacts) return undefined;
  return artifacts.map((art) => {
    if (art.kind !== "timeseries" && art.kind !== "bode") return art;
    return {
      ...art,
      series: (art.series as unknown as RawBinarySeries[]).map((s) => {
        if (typeof s.xPtr === "number" && typeof s.yPtr === "number" && typeof s.len === "number") {
          const xView = new Float64Array(memory.buffer, s.xPtr, s.len);
          const yView = new Float64Array(memory.buffer, s.yPtr, s.len);
          return {
            name: s.name,
            x: Array.from(xView),
            y: Array.from(yView),
          };
        }
        return {
          name: s.name,
          x: s.x ?? [],
          y: s.y ?? [],
        };
      }),
    };
  });
}

export interface RunWasmKernelOptions {
  /** Watchdog timeout in milliseconds (rejects if WASM execution exceeds budget). */
  timeoutMs?: number;
  /**
   * When true (or when `timeoutMs` is set and `preemptible !== false`), runs WASM inside
   * an isolated Worker thread so synchronous infinite loops can be preemptively terminated.
   */
  preemptible?: boolean;
}

/**
 * Self-contained worker script body used by both Node `worker_threads` and Browser `Worker`
 * to execute a WASM kernel in isolation and support preemptive `worker.terminate()`.
 */
const WORKER_RUNNER_BODY = `
async function runInWorker(payload) {
  const { wasmBytes, exportName, input } = payload;
  const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
  const compiled = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      abort: (_msg, _file, line, col) => {
        throw new Error("WASM kernel aborted at " + line + ":" + col);
      },
    },
  });
  const exports = instance.exports;
  const memory = exports["memory"];
  const alloc = exports["msx_alloc"];
  const runJson = exports["msx_run_json"];

  if (memory && typeof alloc === "function" && typeof runJson === "function") {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const waveformPtrs = {};
    if (input.waveforms) {
      for (const [name, wf] of Object.entries(input.waveforms)) {
        const len = Math.min(wf.x.length, wf.y.length);
        const xPtr = alloc(len * 8);
        const yPtr = alloc(len * 8);
        new Float64Array(memory.buffer, xPtr, len).set(wf.x.slice(0, len));
        new Float64Array(memory.buffer, yPtr, len).set(wf.y.slice(0, len));
        waveformPtrs[name] = { xPtr, yPtr, len };
      }
    }
    const envelope = {
      definitionName: input.definitionName,
      packageName: input.packageName,
      parameters: input.parameters,
      files: input.files,
      ...(Object.keys(waveformPtrs).length > 0 ? { waveformPtrs } : {}),
    };
    const expBytes = encoder.encode(exportName);
    const inBytes = encoder.encode(JSON.stringify(envelope));
    const expPtr = alloc(expBytes.length);
    const inPtr = alloc(inBytes.length);
    new Uint8Array(memory.buffer, expPtr, expBytes.length).set(expBytes);
    new Uint8Array(memory.buffer, inPtr, inBytes.length).set(inBytes);
    const packed = runJson(expPtr, expBytes.length, inPtr, inBytes.length);
    const outPtr = Number(packed >> 32n);
    const outLen = Number(packed & 0xffffffffn);
    const parsed = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, outPtr, outLen)));
    if (parsed.artifacts) {
      parsed.artifacts = parsed.artifacts.map((art) => {
        if (art.kind !== "timeseries" && art.kind !== "bode") return art;
        return {
          ...art,
          series: art.series.map((s) => {
            if (typeof s.xPtr === "number" && typeof s.yPtr === "number" && typeof s.len === "number") {
              return {
                name: s.name,
                x: Array.from(new Float64Array(memory.buffer, s.xPtr, s.len)),
                y: Array.from(new Float64Array(memory.buffer, s.yPtr, s.len)),
              };
            }
            return s;
          }),
        };
      });
    }
    return parsed;
  }

  const fn = exports[exportName];
  if (typeof fn !== "function") {
    throw new Error("WASM module does not export '" + exportName + "' or 'msx_run_json'.");
  }
  const numericArgs = Object.values(input.parameters || {}).filter((v) => typeof v === "number");
  const rawResult = fn(...numericArgs);
  const ok = typeof rawResult === "boolean" ? rawResult : Number(rawResult) !== 0;
  return {
    ok,
    kernelId: input.definitionName + "#" + exportName,
    ...(typeof rawResult === "number" ? { parameters: { result: rawResult } } : {}),
    summary: "Executed WASM export '" + exportName + "' -> " + String(rawResult),
  };
}
`;

async function runInPreemptibleWorker(
  bytes: Uint8Array,
  exportName: string,
  input: KernelInput,
  timeoutMs?: number,
): Promise<KernelResult> {
  // Serialize waveforms as plain arrays/typed-arrays for structured clone
  const serializableInput = {
    ...input,
    ...(input.waveforms
      ? {
          waveforms: Object.fromEntries(
            Object.entries(input.waveforms).map(([k, v]) => [
              k,
              {
                x: v.x instanceof Float64Array ? v.x : Float64Array.from(v.x),
                y: v.y instanceof Float64Array ? v.y : Float64Array.from(v.y),
              },
            ]),
          ),
        }
      : {}),
  };

  if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
    const code = `${WORKER_RUNNER_BODY}
self.onmessage = async (e) => {
  try {
    const res = await runInWorker(e.data);
    self.postMessage({ ok: true, result: res });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};`;
    const blobUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    const worker = new Worker(blobUrl);
    return new Promise<KernelResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(blobUrl);
      };
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`WASM kernel '${exportName}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      worker.onmessage = (ev: MessageEvent<{ ok: boolean; result?: KernelResult; error?: string }>) => {
        cleanup();
        if (ev.data.ok && ev.data.result) resolve(ev.data.result);
        else reject(new Error(ev.data.error ?? "Worker WASM execution failed"));
      };
      worker.onerror = (ev) => {
        cleanup();
        reject(new Error(ev.message || "Worker WASM execution error"));
      };
      worker.postMessage({ wasmBytes: bytes, exportName, input: serializableInput });
    });
  }

  // Node worker_threads fallback
  const { Worker: NodeWorker } = await import("node:worker_threads");
  const nodeCode = `const { parentPort, workerData } = require("node:worker_threads");
${WORKER_RUNNER_BODY}
runInWorker(workerData).then(
  (result) => parentPort.postMessage({ ok: true, result }),
  (err) => parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) }),
);`;
  const worker = new NodeWorker(nodeCode, {
    eval: true,
    workerData: { wasmBytes: bytes, exportName, input: serializableInput },
  });

  return new Promise<KernelResult>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer) clearTimeout(timer);
    };
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        reject(new Error(`WASM kernel '${exportName}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
    worker.on("message", (msg: { ok: boolean; result?: KernelResult; error?: string }) => {
      if (settled) return;
      settled = true;
      finish();
      void worker.terminate();
      if (msg.ok && msg.result) resolve(msg.result);
      else reject(new Error(msg.error ?? "Worker WASM execution failed"));
    });
    worker.on("error", (err) => {
      if (settled) return;
      settled = true;
      finish();
      reject(err);
    });
  });
}

/**
 * Executes a user-compiled WASM kernel in a sandboxed WebAssembly instance.
 * Supports:
 * 1. Rich ModelScript ABI (`msx_alloc` + `msx_run_json`) with zero-copy `Float64Array`
 *    linear-memory waveform marshaling (`waveforms` input & `xPtr`/`yPtr` output series)
 * 2. Direct scalar WASM exports (`exportName(...numericArgs): number`) for lightweight functions
 * 3. Preemptive Worker isolation (`preemptible: true` or `timeoutMs` set) that can terminate
 *    synchronous infinite loops in both Node and Browser.
 */
export async function runWasmKernel(
  wasmBytes: Uint8Array | ArrayBuffer,
  exportName: string,
  input: KernelInput,
  options: RunWasmKernelOptions = {},
): Promise<KernelResult> {
  const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
  const useWorker = options.preemptible === true || (options.preemptible !== false && (options.timeoutMs ?? 0) > 0);
  if (useWorker) {
    return runInPreemptibleWorker(bytes, exportName, input, options.timeoutMs);
  }

  const compiled = await WebAssembly.compile(bytes as BufferSource);
  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      abort: (_msg: number, _file: number, line: number, col: number) => {
        throw new Error(`WASM kernel aborted at ${line}:${col}`);
      },
    },
  });

  const exports = instance.exports as Record<string, unknown>;
  const memory = exports["memory"] as WebAssembly.Memory | undefined;

  // Mode 1: Rich JSON + Binary Linear-Memory ABI (`msx_alloc` + `msx_run_json`)
  const alloc = exports["msx_alloc"] as ((size: number) => number) | undefined;
  const runJson = exports["msx_run_json"] as
    | ((expPtr: number, expLen: number, inPtr: number, inLen: number) => bigint)
    | undefined;

  if (memory && typeof alloc === "function" && typeof runJson === "function") {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const waveformPtrs: Record<string, { xPtr: number; yPtr: number; len: number }> = {};
    if (input.waveforms) {
      for (const [name, wf] of Object.entries(input.waveforms)) {
        const len = Math.min(wf.x.length, wf.y.length);
        const xPtr = alloc(len * 8);
        const yPtr = alloc(len * 8);
        new Float64Array(memory.buffer, xPtr, len).set(
          wf.x instanceof Float64Array ? wf.x.subarray(0, len) : wf.x.slice(0, len),
        );
        new Float64Array(memory.buffer, yPtr, len).set(
          wf.y instanceof Float64Array ? wf.y.subarray(0, len) : wf.y.slice(0, len),
        );
        waveformPtrs[name] = { xPtr, yPtr, len };
      }
    }

    const envelope = {
      definitionName: input.definitionName,
      packageName: input.packageName,
      parameters: input.parameters,
      files: input.files,
      ...(Object.keys(waveformPtrs).length > 0 ? { waveformPtrs } : {}),
    };

    const expBytes = encoder.encode(exportName);
    const inBytes = encoder.encode(JSON.stringify(envelope));

    const expPtr = alloc(expBytes.length);
    const inPtr = alloc(inBytes.length);

    new Uint8Array(memory.buffer, expPtr, expBytes.length).set(expBytes);
    new Uint8Array(memory.buffer, inPtr, inBytes.length).set(inBytes);

    const packed = runJson(expPtr, expBytes.length, inPtr, inBytes.length);
    const outPtr = Number(packed >> 32n);
    const outLen = Number(packed & 0xffffffffn);
    const outSlice = new Uint8Array(memory.buffer, outPtr, outLen);
    const parsed = JSON.parse(decoder.decode(outSlice)) as KernelResult;
    if (!parsed.artifacts) return parsed;
    const hydrated = hydrateBinaryArtifacts(parsed.artifacts, memory);
    return {
      ...parsed,
      ...(hydrated ? { artifacts: hydrated } : {}),
    };
  }

  // Mode 2: Direct scalar WASM function export
  const fn = exports[exportName];
  if (typeof fn !== "function") {
    throw new Error(`WASM module does not export '${exportName}' or 'msx_run_json'.`);
  }

  const numericArgs = Object.values(input.parameters).filter((v): v is number => typeof v === "number");
  const rawResult = (fn as (...args: number[]) => unknown)(...numericArgs);
  const ok = typeof rawResult === "boolean" ? rawResult : Number(rawResult) !== 0;

  return {
    ok,
    kernelId: `${input.definitionName}#${exportName}`,
    ...(typeof rawResult === "number" ? { parameters: { result: rawResult } } : {}),
    summary: `Executed WASM export '${exportName}' -> ${String(rawResult)}`,
  };
}
