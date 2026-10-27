// SPDX-License-Identifier: AGPL-3.0-or-later

import { SANDBOX_WORKER_CODE } from "./sandbox-worker-code.js";
import type { WorkerOutgoingMessage, WorkerStageMessage, WorkerTaskRequest } from "./worker-protocol.js";

let activeWorker: Worker | null = null;
let activeWorkerBlobUrl: string | null = null;

function getOrCreateWorker(): Worker {
  if (activeWorker) return activeWorker;

  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Web Workers are not supported in this environment");
  }

  const blob = new Blob([SANDBOX_WORKER_CODE], {
    type: "application/javascript",
  });
  activeWorkerBlobUrl = URL.createObjectURL(blob);
  activeWorker = new Worker(activeWorkerBlobUrl);

  return activeWorker;
}

export function terminateSandboxWorker(): void {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
  if (activeWorkerBlobUrl) {
    URL.revokeObjectURL(activeWorkerBlobUrl);
    activeWorkerBlobUrl = null;
  }
}

export interface SandboxTaskResult<T = unknown> {
  result: T;
  durationMs: number;
  memoryUsageBytes?: number | undefined;
}

/**
 * Dispatches an engineering parse or lint task to the background Web Worker,
 * completely isolating heavy parsing from the main UI thread.
 */
export function runSandboxTask<T = unknown>(
  request: WorkerTaskRequest,
  onStageUpdate?: ((msg: WorkerStageMessage) => void) | undefined,
): Promise<SandboxTaskResult<T>> {
  return new Promise((resolve, reject) => {
    try {
      const worker = getOrCreateWorker();

      const handleMessage = (e: MessageEvent<WorkerOutgoingMessage>) => {
        const msg = e.data;
        if (!msg || msg.id !== request.id) return;

        if (msg.type === "STAGE_UPDATE") {
          onStageUpdate?.(msg);
        } else if (msg.type === "SUCCESS") {
          worker.removeEventListener("message", handleMessage);
          worker.removeEventListener("error", handleError);
          resolve({
            result: msg.result as T,
            durationMs: msg.durationMs,
            memoryUsageBytes: msg.memoryUsageBytes,
          });
        } else if (msg.type === "ERROR") {
          worker.removeEventListener("message", handleMessage);
          worker.removeEventListener("error", handleError);
          reject(new Error(msg.error));
        }
      };

      const handleError = (err: ErrorEvent) => {
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        reject(new Error(`Worker fatal crash: ${err.message}`));
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleError);

      worker.postMessage(request);
    } catch (err) {
      reject(err);
    }
  });
}
