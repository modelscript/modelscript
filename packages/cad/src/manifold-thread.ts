// SPDX-License-Identifier: AGPL-3.0-or-later

import { parentPort } from "node:worker_threads";
import { ManifoldWorker } from "./manifold-worker.js";
import type { Solid } from "./types.js";

interface WorkerEvalRequest {
  id: number;
  solid: Solid;
}

if (parentPort) {
  parentPort.on("message", (req: WorkerEvalRequest) => {
    try {
      const mesh = ManifoldWorker.evaluateSolid(req.solid);
      const transferList = [
        mesh.vertices.buffer,
        mesh.indices.buffer,
        mesh.normals.buffer,
        mesh.faceTagIndices.buffer,
      ].filter((buf): buf is ArrayBuffer => buf instanceof ArrayBuffer);
      parentPort!.postMessage({ id: req.id, mesh }, transferList);
    } catch (err) {
      parentPort!.postMessage({
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
