// SPDX-License-Identifier: AGPL-3.0-or-later

import { ManifoldWorker, type ManifoldSurfaceMesh } from "./manifold-worker.js";
import type { Solid } from "./types.js";

interface PendingEval {
  resolve: (mesh: ManifoldSurfaceMesh) => void;
  reject: (err: Error) => void;
}

interface NodeWorkerLike {
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
  ref?(): void;
  unref?(): void;
}

let sharedWorker: NodeWorkerLike | null = null;
let workerFailed = false;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingEval>();

async function ensureNodeWorker(): Promise<NodeWorkerLike | null> {
  if (workerFailed) return null;
  const isNodeEnv =
    typeof process !== "undefined" &&
    Boolean(process.versions?.node) &&
    typeof (globalThis as { window?: unknown }).window === "undefined";
  if (!isNodeEnv) return null;
  if (sharedWorker) return sharedWorker;

  try {
    const fsMod = await import(/* @vite-ignore */ "node:" + "fs");
    const pathMod = await import(/* @vite-ignore */ "node:" + "path");
    const urlMod = await import(/* @vite-ignore */ "node:" + "url");
    const wtMod = await import(/* @vite-ignore */ "node:" + "worker_threads");

    const curDir = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
    const localWorker = pathMod.resolve(curDir, "manifold-thread.js");
    const distWorker = pathMod.resolve(curDir, "../dist/manifold-thread.js");
    const workerFile = fsMod.existsSync(localWorker) ? localWorker : fsMod.existsSync(distWorker) ? distWorker : null;
    if (!workerFile) {
      workerFailed = true;
      return null;
    }

    const w = new wtMod.Worker(workerFile);
    // Do not block Node process shutdown when no CSG evaluations are in flight
    if (typeof w.unref === "function") w.unref();
    w.on("message", (msg: { id: number; mesh?: ManifoldSurfaceMesh; error?: string }) => {
      const entry = pendingRequests.get(msg.id);
      if (!entry) return;
      pendingRequests.delete(msg.id);
      if (pendingRequests.size === 0 && typeof w.unref === "function") {
        w.unref();
      }
      if (msg.error || !msg.mesh) {
        entry.reject(new Error(msg.error || "Worker CSG evaluation returned empty mesh"));
        return;
      }
      entry.resolve({
        ...msg.mesh,
        vertices: msg.mesh.vertices instanceof Float32Array ? msg.mesh.vertices : new Float32Array(msg.mesh.vertices),
        indices: msg.mesh.indices instanceof Uint32Array ? msg.mesh.indices : new Uint32Array(msg.mesh.indices),
        normals: msg.mesh.normals instanceof Float32Array ? msg.mesh.normals : new Float32Array(msg.mesh.normals),
        faceTagIndices:
          msg.mesh.faceTagIndices instanceof Uint32Array
            ? msg.mesh.faceTagIndices
            : new Uint32Array(msg.mesh.faceTagIndices),
      });
    });
    w.on("error", (err: Error) => {
      workerFailed = true;
      sharedWorker = null;
      for (const [, p] of pendingRequests) p.reject(err);
      pendingRequests.clear();
    });
    w.on("exit", (code: number) => {
      if (sharedWorker === w) sharedWorker = null;
      if (code !== 0) {
        for (const [, p] of pendingRequests) {
          p.reject(new Error(`CAD worker exited with code ${code}`));
        }
        pendingRequests.clear();
      }
    });
    sharedWorker = w;
    return w;
  } catch {
    workerFailed = true;
    return null;
  }
}

/**
 * Evaluates a `Solid` CSG tree into a triangulated `ManifoldSurfaceMesh`.
 * Offloads evaluation to a background Node `worker_threads` worker when compiled
 * `dist/manifold-thread.js` is available, falling back seamlessly to `ManifoldWorker.evaluateSolid`.
 */
export async function evaluateSolidAsync(solid: Solid): Promise<ManifoldSurfaceMesh> {
  const w = await ensureNodeWorker();
  if (w) {
    try {
      return await new Promise<ManifoldSurfaceMesh>((resolve, reject) => {
        const id = nextRequestId++;
        pendingRequests.set(id, { resolve, reject });
        if (typeof w.ref === "function") w.ref();
        w.postMessage({ id, solid });
      });
    } catch {
      // Fallback to synchronous local evaluation if worker serialization fails (e.g. non-cloneable custom fields)
    }
  }
  return ManifoldWorker.evaluateSolid(solid);
}

/**
 * Terminates the pooled background CSG worker thread if one is running.
 */
export async function terminateCadWorker(): Promise<void> {
  if (sharedWorker) {
    const w = sharedWorker;
    sharedWorker = null;
    await w.terminate();
  }
}
