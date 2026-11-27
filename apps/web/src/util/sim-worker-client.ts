// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Client wrapper for the lightweight 100% client-side WASM simulation worker
 * (`/lsp/server/dist/simWorker.js`).
 */

export interface FastSimRequest {
  libraryName: string;
  version: string;
  className: string;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  numberOfIntervals?: number | undefined;
  interval?: number | undefined;
  rtol?: number | undefined;
  atol?: number | undefined;
  solver?: string | undefined;
  parameterOverrides?: Record<string, number> | undefined;
}

export interface FastSimResponse {
  ok: boolean;
  fallbackToLsp?: boolean | undefined;
  error?: string | undefined;
  t?: number[] | undefined;
  y?: number[][] | undefined;
  states?: string[] | undefined;
  experiment?: {
    startTime: number;
    stopTime: number;
    interval: number;
    tolerance: number;
    solver: string;
  };
  telemetry?: {
    executionTimeMs: number;
    stepCount: number;
    filesFetched: number;
  };
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (res: FastSimResponse) => void; reject: (err: Error) => void }>();

function getOrCreateWorker(): Worker {
  if (worker) return worker;
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const w = new Worker(new URL("/lsp/server/dist/simWorker.js", origin), {
    name: "modelscript-wasm-sim",
  });
  w.onmessage = (event: MessageEvent<FastSimResponse & { id: number }>) => {
    const data = event.data;
    const entry = pending.get(data.id);
    if (entry) {
      pending.delete(data.id);
      entry.resolve(data);
    }
  };
  w.onerror = (err) => {
    const error = new Error(err.message || "WASM simulation worker failed");
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

export function simulateInWasmWorker(req: FastSimRequest): Promise<FastSimResponse> {
  if (typeof Worker === "undefined" || typeof window === "undefined") {
    return Promise.resolve({ ok: false, fallbackToLsp: true, error: "WebWorker unavailable" });
  }
  const id = nextId++;
  const origin = window.location.origin;
  const w = getOrCreateWorker();
  return new Promise<FastSimResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({
      id,
      type: "simulate",
      origin,
      ...req,
    });
  });
}
