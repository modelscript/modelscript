// SPDX-License-Identifier: AGPL-3.0-or-later

import { PagedStorageEngine, type PagedWasmExports } from "./paged_store.js";

/**
 * Dedicated Web Worker orchestrating Origin Private File System (OPFS)
 * synchronous access for 100M+ and 1B+ fact persistence.
 */
export interface OPFSMessageRequest {
  id: number;
  type: "INIT" | "INSERT_BATCH" | "QUERY" | "FLUSH" | "METRICS" | "CLOSE";
  payload?: any;
}

export interface OPFSMessageResponse {
  id: number;
  success: boolean;
  data?: any;
  error?: string;
}

let g_storageEngine: PagedStorageEngine | null = null;
let g_syncHandle: any = null;

export async function initOPFSWorker(
  wasmModule: WebAssembly.Module,
  fileName: string = "modelscript_ontology.bin",
): Promise<void> {
  let syncHandle: any = null;

  if (typeof navigator !== "undefined" && (navigator as any).storage?.getDirectory) {
    const root = await (navigator as any).storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    if (fileHandle.createSyncAccessHandle) {
      syncHandle = await fileHandle.createSyncAccessHandle();
    }
  }

  const env = {
    abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
      console.error(`OPFS Worker WASM Abort at line ${line}, col ${col}`);
    },
    trace: (msgPtr: number, n: number) => {
      console.log(`OPFS Worker WASM Trace: ${msgPtr}, n=${n}`);
    },
  };

  const instantiated = await WebAssembly.instantiate(wasmModule, { env });
  const exports = { ...instantiated.exports } as unknown as PagedWasmExports;
  exports.memory = instantiated.exports.memory as WebAssembly.Memory;

  g_syncHandle = syncHandle;
  g_storageEngine = new PagedStorageEngine(exports, 1024); // 1024 frames = 4MB working set
}

if (typeof self !== "undefined" && typeof (self as any).onmessage !== "undefined") {
  (self as any).onmessage = async (e: MessageEvent<OPFSMessageRequest>) => {
    const { id, type, payload } = e.data;

    try {
      switch (type) {
        case "INIT": {
          if (!payload.wasmModule || !(payload.wasmModule instanceof WebAssembly.Module)) {
            throw new Error("Expected pre-compiled WebAssembly.Module in payload.wasmModule");
          }
          await initOPFSWorker(payload.wasmModule, payload.fileName);
          (self as any).postMessage({ id, success: true });
          break;
        }
        case "INSERT_BATCH": {
          if (!g_storageEngine) throw new Error("Worker storage engine not initialized");
          const triples: { s: string | number; p: string | number; o: string | number }[] = payload.triples;
          let inserted = 0;
          for (const t of triples) {
            if (g_storageEngine.insertTriple(t.s, t.p, t.o)) {
              inserted++;
            }
          }
          (self as any).postMessage({ id, success: true, data: { inserted } });
          break;
        }
        case "QUERY": {
          if (!g_storageEngine) throw new Error("Worker storage engine not initialized");
          const results = g_storageEngine.findTriples(payload.pattern);
          (self as any).postMessage({ id, success: true, data: { results } });
          break;
        }
        case "FLUSH": {
          if (!g_storageEngine) throw new Error("Worker storage engine not initialized");
          const flushed = g_storageEngine.flush();
          if (g_syncHandle?.flush) {
            g_syncHandle.flush();
          }
          (self as any).postMessage({ id, success: true, data: { flushed } });
          break;
        }
        case "METRICS": {
          if (!g_storageEngine) throw new Error("Worker storage engine not initialized");
          const metrics = g_storageEngine.getMetrics();
          (self as any).postMessage({ id, success: true, data: metrics });
          break;
        }
        case "CLOSE": {
          if (g_storageEngine) {
            g_storageEngine.close();
          }
          if (g_syncHandle?.close) {
            g_syncHandle.close();
            g_syncHandle = null;
          }
          (self as any).postMessage({ id, success: true });
          break;
        }
        default:
          throw new Error(`Unknown OPFS worker message type: ${type}`);
      }
    } catch (err: any) {
      (self as any).postMessage({ id, success: false, error: err.message ?? String(err) });
    }
  };
}
