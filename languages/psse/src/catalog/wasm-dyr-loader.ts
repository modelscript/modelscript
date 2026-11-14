// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import type { PsseCase } from "../types.js";

function sanitizeIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

interface WasmDyrExports {
  memory?: WebAssembly.Memory;
  [fnName: string]: unknown;
}

export interface PsseDynamicModelIO {
  eterm: number;
  speedDev: number;
  efd: number;
  pmech: number;
  vr: number;
  vi: number;
}

export interface PsseLinkedDynamicInstance {
  busNumber: number;
  machineId?: string | undefined;
  modelName: string;
  init(io: PsseDynamicModelIO): void;
  doStep(tSec: number, dtSec: number, io: PsseDynamicModelIO): { efd?: number | undefined; pmech?: number | undefined };
}

const compiledCache = new WeakMap<Uint8Array, WebAssembly.Instance>();

function getOrInstantiateWasm(wasmBytes: Uint8Array): WebAssembly.Instance | undefined {
  let inst = compiledCache.get(wasmBytes);
  if (inst) return inst;
  try {
    const copy = new Uint8Array(wasmBytes);
    const mod = new WebAssembly.Module(copy);
    inst = new WebAssembly.Instance(mod, {});
    compiledCache.set(wasmBytes, inst);
    return inst;
  } catch {
    return undefined;
  }
}

let builtInRegistrationAttempted = false;

/**
 * Ensures the built-in `@modelscript/psse-std-lib` (`package.json#modelscript`) library is
 * registered in `globalLibraryRegistry` when running in Node.js. Browser callers can register
 * pre-bundled JSON/WASM payloads via `globalLibraryRegistry.registerLibraryBundle(...)`.
 */
export async function ensureBuiltInPsseLibraryRegistered(): Promise<void> {
  if (globalLibraryRegistry.getPackagesForLanguage("psse").length > 0) return;
  if (builtInRegistrationAttempted) return;
  builtInRegistrationAttempted = true;
  try {
    const path = await import("node:path");
    const url = await import("node:url");
    const fs = await import("node:fs");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, "../../assets/psse-std-lib"),
      path.resolve(here, "../../../assets/psse-std-lib"),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, "package.json"))) {
        await globalLibraryRegistry.loadLibraryFromDir(dir);
        break;
      }
    }
  } catch {
    // Browser / restricted environments register bundles explicitly
  }
}

/**
 * Instantiates AssemblyScript `.dyr` dynamic models from any loaded `package.json#modelscript`
 * PSS/E library package (`pkg.wasmBytes`) matching records in `psseCase.dyr`.
 */
export function instantiateWasmDyrModelsForCase(psseCase: PsseCase): PsseLinkedDynamicInstance[] {
  const records = psseCase.dyr?.records ?? [];
  if (records.length === 0) return [];

  if (globalLibraryRegistry.getPackagesForLanguage("psse").length === 0) {
    void ensureBuiltInPsseLibraryRegistered();
  }

  const pkgs = globalLibraryRegistry
    .getPackagesForLanguage("psse")
    .filter((p) => p.wasmBytes && p.wasmBytes.byteLength > 0);
  if (pkgs.length === 0) return [];

  const instances: PsseLinkedDynamicInstance[] = [];
  // Allocate per-instance slots in linear memory starting at 4096 (each slot: 64*8=512B CON, 16*8=128B STATE, 6*8=48B IO)
  let slotIndex = 0;

  for (const rec of records) {
    const safe = sanitizeIdent(rec.model.toUpperCase());
    for (const pkg of pkgs) {
      if (!pkg.wasmBytes) continue;
      const instance = getOrInstantiateWasm(pkg.wasmBytes);
      if (!instance) continue;
      const exports = instance.exports as WasmDyrExports;
      const initFn = exports[`${safe}_init`] as
        | ((conPtr: number, count: number, statePtr: number, ioPtr: number) => void)
        | undefined;
      const stepFn = exports[`${safe}_step`] as
        | ((t: number, dt: number, conPtr: number, statePtr: number, ioPtr: number) => void)
        | undefined;
      if (typeof initFn !== "function" || typeof stepFn !== "function" || !exports.memory) continue;

      const mem = exports.memory;
      const base = 4096 + slotIndex * 768;
      if (mem.buffer.byteLength < base + 768) {
        const neededPages = Math.ceil((base + 768 - mem.buffer.byteLength) / 65536);
        mem.grow(neededPages);
      }
      slotIndex++;
      const conPtr = base;
      const statePtr = base + 512;
      const ioPtr = base + 640;
      const con = rec.con ?? [];

      const writeIo = (io: PsseDynamicModelIO) => {
        const f64 = new Float64Array(mem.buffer);
        const o = ioPtr >> 3;
        f64[o + 0] = io.eterm;
        f64[o + 1] = io.speedDev;
        f64[o + 2] = io.efd;
        f64[o + 3] = io.pmech;
        f64[o + 4] = io.vr;
        f64[o + 5] = io.vi;
      };

      const readIo = (): { efd?: number | undefined; pmech?: number | undefined } => {
        const f64 = new Float64Array(mem.buffer);
        const o = ioPtr >> 3;
        return {
          efd: f64[o + 2],
          pmech: f64[o + 3],
        };
      };

      instances.push({
        busNumber: rec.ibus,
        machineId: rec.id,
        modelName: rec.model,
        init(io: PsseDynamicModelIO) {
          const f64 = new Float64Array(mem.buffer);
          for (let i = 0; i < Math.min(con.length, 64); i++) {
            f64[(conPtr >> 3) + i] = con[i]!;
          }
          writeIo(io);
          initFn(conPtr, con.length, statePtr, ioPtr);
        },
        doStep(tSec: number, dtSec: number, io: PsseDynamicModelIO) {
          writeIo(io);
          stepFn(tSec, dtSec, conPtr, statePtr, ioPtr);
          return readIo();
        },
      });
      break;
    }
  }

  return instances;
}

/**
 * Compiles user-authored AssemblyScript PSS/E `.dyr` / `USRMDL` source into `Uint8Array` WASM.
 */
export async function compileAssemblyScriptDyrModel(
  sourceTs: string,
): Promise<{ wasmBytes?: Uint8Array; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  try {
    const ascSpec = "assemblyscript/asc";
    const asc = (await import(/* @vite-ignore */ ascSpec)) as typeof import("assemblyscript/asc");
    let outWasm: Uint8Array | undefined;
    const { error, stderr } = await asc.main(
      ["model.ts", "--outFile", "runtime.wasm", "--bindings", "raw", "--optimize", "--noAssert"],
      {
        readFile: (filename: string) => (filename === "model.ts" ? sourceTs : null),
        writeFile: (filename: string, contents: Uint8Array | string) => {
          if (filename === "runtime.wasm") {
            outWasm = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
          }
        },
        listFiles: () => [],
      },
    );
    const errText = stderr?.toString?.() ?? "";
    if (errText.trim().length > 0) diagnostics.push(errText.trim());
    if (error) diagnostics.push(error.message);
    return outWasm ? { wasmBytes: outWasm, diagnostics } : { diagnostics };
  } catch (e) {
    diagnostics.push(e instanceof Error ? e.message : String(e));
    return { diagnostics };
  }
}

/**
 * Compiles user-authored AssemblyScript PSS/E `.dyr` / `USRMDL` source in a Web Worker
 * when running in a browser, falling back safely to `compileAssemblyScriptDyrModel` in Node.js
 * or if the browser worker cannot resolve `assemblyscript/asc`.
 */
export async function compileAssemblyScriptDyrInWorker(
  sourceTs: string,
  options?: { ascUrl?: string },
): Promise<{ wasmBytes?: Uint8Array; diagnostics: string[] }> {
  if (
    typeof Worker === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return compileAssemblyScriptDyrModel(sourceTs);
  }

  const ascUrl =
    options?.ascUrl ??
    (typeof globalThis.location?.origin === "string" && globalThis.location.origin !== "null"
      ? `${globalThis.location.origin}/assets/asc/asc.js`
      : "assemblyscript/asc");

  const workerCode = `
    self.onmessage = async (event) => {
      const { sourceTs } = event.data;
      const diagnostics = [];
      try {
        let asc;
        try {
          asc = await import(${JSON.stringify(ascUrl)});
        } catch {
          asc = await import("assemblyscript/asc");
        }
        let outWasm = null;
        const { error, stderr } = await asc.main(
          ["model.ts", "--outFile", "runtime.wasm", "--bindings", "raw", "--optimize", "--noAssert"],
          {
            readFile: (filename) => (filename === "model.ts" ? sourceTs : null),
            writeFile: (filename, contents) => {
              if (filename === "runtime.wasm") {
                outWasm = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
              }
            },
            listFiles: () => [],
          }
        );
        const errText = stderr && stderr.toString ? stderr.toString() : "";
        if (errText.trim().length > 0) diagnostics.push(errText.trim());
        if (error) diagnostics.push(error.message);
        if (outWasm) {
          self.postMessage({ ok: true, wasmBytes: outWasm, diagnostics }, [outWasm.buffer]);
        } else {
          self.postMessage({ ok: true, diagnostics });
        }
      } catch (err) {
        self.postMessage({
          ok: false,
          fallback: true,
          diagnostics: [err && err.message ? err.message : String(err)],
        });
      }
    };
  `;

  let blobUrl: string | undefined;
  let worker: Worker | undefined;
  try {
    const blob = new Blob([workerCode], { type: "application/javascript" });
    blobUrl = URL.createObjectURL(blob);
    worker = new Worker(blobUrl, { type: "module" });

    return await new Promise<{ wasmBytes?: Uint8Array; diagnostics: string[] }>((resolve) => {
      let settled = false;
      const finish = (res: { wasmBytes?: Uint8Array; diagnostics: string[] }) => {
        if (settled) return;
        settled = true;
        worker?.terminate();
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        resolve(res);
      };

      worker!.onmessage = (ev: MessageEvent) => {
        const data = ev.data as {
          ok?: boolean;
          fallback?: boolean;
          wasmBytes?: Uint8Array;
          diagnostics?: string[];
        };
        if (data?.fallback) {
          finish({ diagnostics: [] });
          return;
        }
        const diags = Array.isArray(data?.diagnostics) ? data.diagnostics : [];
        finish(data?.wasmBytes ? { wasmBytes: data.wasmBytes, diagnostics: diags } : { diagnostics: diags });
      };

      worker!.onerror = () => {
        finish({ diagnostics: [] });
      };

      worker!.postMessage({ sourceTs });
    }).then((res) => {
      if (!res.wasmBytes && res.diagnostics.length === 0) {
        return compileAssemblyScriptDyrModel(sourceTs);
      }
      return res;
    });
  } catch {
    worker?.terminate();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    return compileAssemblyScriptDyrModel(sourceTs);
  }
}
