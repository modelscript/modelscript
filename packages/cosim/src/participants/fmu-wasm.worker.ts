// SPDX-License-Identifier: AGPL-3.0-or-later
/// <reference lib="webworker" />

/**
 * Web Worker implementation for FMU-WASM simulation.
 *
 * This worker receives the extracted `model.ts` AssemblyScript source,
 * compiles it into WebAssembly using the `@assemblyscript/compiler`,
 * and runs the numerical integration steps off the main thread.
 *
 * This prevents the browser UI from freezing during computationally
 * expensive co-simulation loops.
 */

import asc from "assemblyscript/dist/asc.js";

let wasmInstance: WebAssembly.Instance | undefined;
let wasmExports: unknown;
const values = new Map<string, number>();
const varRefs = new Map<string, number>();

async function getWasmCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("FmuWasmCache", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("binaries");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedBinary(db: IDBDatabase, key: string): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("binaries", "readonly");
    const req = tx.objectStore("binaries").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(tx.error);
  });
}

async function setCachedBinary(db: IDBDatabase, key: string, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("binaries", "readwrite");
    tx.objectStore("binaries").put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function hashString(str: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return str.substring(0, 32);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

self.onmessage = async (event: MessageEvent) => {
  const { type, payload, id } = event.data;

  try {
    switch (type) {
      case "INIT": {
        const { asSourceStr, variables } = payload;

        let binary: Uint8Array | undefined;
        let cacheKey = "";
        let db: IDBDatabase | null = null;

        try {
          db = await getWasmCacheDb();
          cacheKey = await hashString(asSourceStr);
          if (db) {
            binary = await getCachedBinary(db, cacheKey);
          }
        } catch (e) {
          console.warn("WASM caching unavailable:", e);
        }

        if (!binary) {
          // Compile AssemblyScript
          const result = await asc.compileString(asSourceStr, {
            optimizeLevel: 3,
            shrinkLevel: 0,
            runtime: "stub",
          });

          if (result.error || !result.binary) {
            throw new Error(`Failed to compile FMU AssemblyScript to WASM:\n${result.error?.message}`);
          }
          binary = result.binary;

          if (db && cacheKey) {
            try {
              await setCachedBinary(db, cacheKey, binary);
            } catch (e) {
              console.warn("Failed to cache WASM binary:", e);
            }
          }
        }

        const env = {
          abort: (msg: number, file: number, line: number, column: number) => {
            throw new Error(`WASM abort at ${line}:${column}`);
          },
        };

        const wasmModule = await WebAssembly.instantiate(binary, { env });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wasmInstance = wasmModule as any;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        wasmExports = wasmInstance!.exports;

        const exports = wasmExports as {
          initModel: () => void;
          doStep: (time: number, step: number) => void;
          getVar: (vr: number) => number;
          setVar: (vr: number, val: number) => void;
        };

        if (!exports.initModel || !exports.doStep || !exports.getVar) {
          throw new Error("WASM module missing expected exports");
        }

        exports.initModel();

        // Initialize maps
        varRefs.clear();
        values.clear();
        for (const v of variables) {
          varRefs.set(v.name, v.valueReference);
          values.set(v.name, typeof v.start === "number" ? v.start : 0);
        }

        self.postMessage({ id, type: "INIT_DONE" });
        break;
      }

      case "SET_INPUTS": {
        const exports = wasmExports as { setVar: (vr: number, val: number) => void };
        const inputs: [string, number][] = payload;
        for (const [name, value] of inputs) {
          const vr = varRefs.get(name);
          if (vr !== undefined) exports.setVar(vr, value);
          values.set(name, value);
        }
        self.postMessage({ id, type: "SET_INPUTS_DONE" });
        break;
      }

      case "DO_STEP": {
        const { time, stepSize } = payload;
        if (!wasmExports) throw new Error("Worker not initialized");
        const exports = wasmExports as { doStep: (time: number, step: number) => void; getVar: (vr: number) => number };

        exports.doStep(time, stepSize);

        // Sync values back from WASM
        const outputs: [string, number][] = [];
        for (const [name, vr] of varRefs) {
          const val = exports.getVar(vr);
          values.set(name, val);
          outputs.push([name, val]);
        }

        self.postMessage({ id, type: "DO_STEP_DONE", payload: outputs });
        break;
      }

      case "TERMINATE": {
        wasmInstance = undefined;
        wasmExports = undefined;
        values.clear();
        varRefs.clear();
        self.postMessage({ id, type: "TERMINATE_DONE" });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (err: unknown) {
    self.postMessage({ id, type: "ERROR", error: err instanceof Error ? err.message : String(err) });
  }
};
