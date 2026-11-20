// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dedicated Web Worker for non-blocking browser-local FEA (FeaSolver),
 * CFD (WebGPULbmRunner), and Tet4 mesh generation (Tet4Mesher).
 */

import {
  generateFluidEnclosureMesh,
  generateLocalTetMesh,
  runLocalCfdStudy,
  runLocalFeaStudy,
} from "./cae-local-runner";

export type CaeWorkerRequest =
  | { kind: "fea"; deckContent: string; runId: string; runName: string }
  | { kind: "cfd"; cfgContent: string; runId: string; runName: string; steps?: number }
  | {
      kind: "mesh";
      fineness: "coarse" | "moderate" | "fine";
      size: [number, number, number];
      surfaceMesh?: { vertices: number[]; indices: number[] };
      enclosurePadding?: number;
    };

self.onmessage = async (ev: MessageEvent<CaeWorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.kind === "fea") {
      const res = await runLocalFeaStudy(req.deckContent, req.runId, req.runName, (event) => {
        self.postMessage({ type: "progress", event });
      });
      self.postMessage({ type: "result", data: res }, { transfer: [res.vtkBuffer.buffer] });
    } else if (req.kind === "cfd") {
      const res = await runLocalCfdStudy(
        req.cfgContent,
        req.runId,
        req.runName,
        (event) => {
          self.postMessage({ type: "progress", event });
        },
        req.steps,
      );
      self.postMessage({ type: "result", data: res }, { transfer: [res.vtkBuffer.buffer] });
    } else if (req.kind === "mesh") {
      const targetSurface =
        req.enclosurePadding && req.enclosurePadding > 0 && req.surfaceMesh
          ? generateFluidEnclosureMesh(req.surfaceMesh, req.enclosurePadding)
          : req.surfaceMesh;
      const res = generateLocalTetMesh(req.fineness, req.size, targetSurface);
      self.postMessage({ type: "result", data: res }, { transfer: [res.vtkBuffer.buffer] });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
