// SPDX-License-Identifier: AGPL-3.0-or-later

import { PagedStorageEngine, type PagedWasmExports } from "./paged_store.js";

/**
 * Dedicated Web Worker orchestrating Origin Private File System (OPFS)
 * synchronous access for 100M+ and 1B+ fact persistence.
 */
export interface OPFSInitPayload {
  wasmModule: WebAssembly.Module;
  fileName?: string | undefined;
}

export interface OPFSInsertBatchPayload {
  triples: { s: string | number; p: string | number; o: string | number }[];
}

export interface OPFSQueryPayload {
  pattern: Parameters<PagedStorageEngine["findTriples"]>[0];
}

export interface OPFSMessageRequest {
  id: number;
  type: "INIT" | "INSERT_BATCH" | "QUERY" | "FLUSH" | "METRICS" | "CLOSE";
  payload?: OPFSInitPayload | OPFSInsertBatchPayload | OPFSQueryPayload | Record<string, unknown> | undefined;
}

export interface OPFSMessageResponse {
  id: number;
  success: boolean;
  data?: unknown;
  error?: string | undefined;
}

interface OPFSSyncAccessHandleLike {
  flush?: () => void;
  close?: () => void;
}

interface OPFSFileHandleLike {
  createSyncAccessHandle?: () => Promise<OPFSSyncAccessHandleLike>;
}

interface OPFSDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OPFSFileHandleLike>;
}

interface NavigatorWithOPFS {
  storage?: {
    getDirectory?: () => Promise<OPFSDirectoryHandleLike>;
  };
}

interface WorkerGlobalLike {
  onmessage?: ((e: MessageEvent<OPFSMessageRequest>) => unknown) | null;
  postMessage(message: OPFSMessageResponse): void;
}

let g_storageEngine: PagedStorageEngine | null = null;
let g_syncHandle: OPFSSyncAccessHandleLike | null = null;

export async function initOPFSWorker(
  wasmModule: WebAssembly.Module,
  fileName: string = "modelscript_ontology.bin",
): Promise<void> {
  let syncHandle: OPFSSyncAccessHandleLike | null = null;

  const navStorage = typeof navigator !== "undefined" ? (navigator as unknown as NavigatorWithOPFS).storage : undefined;
  if (navStorage?.getDirectory) {
    const root = await navStorage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    if (fileHandle.createSyncAccessHandle) {
      syncHandle = await fileHandle.createSyncAccessHandle();
    }
  }

  const env = {
    abort: (_msgPtr: number, _filePtr: number, line: number, col: number) => {
      console.error(`OPFS Worker WASM Abort at line ${line}, col ${col}`);
    },
    trace: (msgPtr: number, n: number) => {
      console.log(`OPFS Worker WASM Trace: ${msgPtr}, n=${n}`);
    },
  };

  const instantiated = await WebAssembly.instantiate(wasmModule, { env });
  const exports = { ...instantiated.exports } as unknown as PagedWasmExports;
  exports.memory = instantiated.exports["memory"] as WebAssembly.Memory;

  g_syncHandle = syncHandle;
  g_storageEngine = new PagedStorageEngine(exports, 1024); // 1024 frames = 4MB working set
}

const workerSelf = typeof self !== "undefined" ? (self as unknown as WorkerGlobalLike) : undefined;

if (workerSelf && typeof workerSelf.onmessage !== "undefined") {
  workerSelf.onmessage = async (e: MessageEvent<OPFSMessageRequest>) => {
    const { id, type, payload } = e.data;

    try {
      switch (type) {
        case "INIT": {
          const initPayload = payload as Partial<OPFSInitPayload> | undefined;
          if (!initPayload?.wasmModule || !(initPayload.wasmModule instanceof WebAssembly.Module)) {
            throw new Error("Expected pre-compiled WebAssembly.Module in payload.wasmModule");
          }
          await initOPFSWorker(initPayload.wasmModule, initPayload.fileName);
          workerSelf.postMessage({ id, success: true });
          break;
        }
        case "INSERT_BATCH": {
          if (!g_storageEngine) throw new Error("Worker storage engine not initialized");
          const batchPayload = payload as OPFSInsertBatchPayload;
          const triples = batchPayload.triples;
          let inserted = 0;
          for (const t of triples) {
            if (g_storageEngine.insertTriple(t.s, t.p, t.o)) {
              inserted++;
            }
          }
          workerSelf.postMessage({ id, success: true, data: { inserted } });
          break;
        }
        case "QUERY": {
          if (!g_storageEngine) throw new Error("Worker storage engine not initialized");
          const queryPayload = payload as OPFSQueryPayload;
          const results = g_storageEngine.findTriples(queryPayload.pattern);
          workerSelf.postMessage({ id, success: true, data: { results } });
          break;
        }
        case "FLUSH": {
          if (!g_storageEngine) throw new Error("Worker storage engine not initialized");
          const flushed = g_storageEngine.flush();
          if (g_syncHandle?.flush) {
            g_syncHandle.flush();
          }
          workerSelf.postMessage({ id, success: true, data: { flushed } });
          break;
        }
        case "METRICS": {
          if (!g_storageEngine) throw new Error("Worker storage engine not initialized");
          const metrics = g_storageEngine.getMetrics();
          workerSelf.postMessage({ id, success: true, data: metrics });
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
          workerSelf.postMessage({ id, success: true });
          break;
        }
        default:
          throw new Error(`Unknown OPFS worker message type: ${String(type)}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      workerSelf.postMessage({ id, success: false, error: message });
    }
  };
}
