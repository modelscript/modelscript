// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dedicated Web Worker for non-blocking browser-local FEA (FeaSolver),
 * CFD (LBM, Octree LBM, Compressible FVM, Compressible DG), mesh generation & healing,
 * adjoint sensitivity (LBM + NILSS), POD surrogate training, and CFD V&V benchmarking.
 */

import type { PodTrainConfig, SnapshotMatrixDataset } from "@modelscript/simulate";
import {
  generateFluidEnclosureMesh,
  generateLocalTetMesh,
  runAdjointSensitivityStudy,
  runCfdVvScorecard,
  runLocalCfdStudy,
  runLocalFeaStudy,
  runMeshHealCheck,
  trainLocalPodSurrogate,
  type AdjointStudyOptions,
  type CaeCfdStudyOptions,
  type CaeFeaStudyOptions,
} from "./cae-local-runner";

export type CaeWorkerRequest =
  | { kind: "fea"; deckContent: string; runId: string; runName: string; options?: CaeFeaStudyOptions | undefined }
  | {
      kind: "cfd";
      cfgContent: string;
      runId: string;
      runName: string;
      steps?: number | undefined;
      options?: CaeCfdStudyOptions | undefined;
    }
  | {
      kind: "mesh";
      fineness: "coarse" | "moderate" | "fine";
      size: [number, number, number];
      surfaceMesh?: { vertices: number[]; indices: number[] } | undefined;
      enclosurePadding?: number | undefined;
    }
  | { kind: "mesh-heal"; vertices: Float32Array; indices: Uint32Array }
  | { kind: "adjoint"; cfgContent: string; options?: AdjointStudyOptions | undefined }
  | { kind: "pod-train"; snapshots: SnapshotMatrixDataset; config?: PodTrainConfig | undefined }
  | { kind: "cfd-vv" };

self.onmessage = async (ev: MessageEvent<CaeWorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.kind === "fea") {
      const res = await runLocalFeaStudy(
        req.deckContent,
        req.runId,
        req.runName,
        (event) => {
          self.postMessage({ type: "progress", event });
        },
        req.options,
      );
      self.postMessage({ type: "result", data: res }, { transfer: [res.vtkBuffer.buffer] });
    } else if (req.kind === "cfd") {
      const mergedOpts: CaeCfdStudyOptions | number | undefined = req.options
        ? { ...req.options, steps: req.options.steps ?? req.steps }
        : req.steps;
      const res = await runLocalCfdStudy(
        req.cfgContent,
        req.runId,
        req.runName,
        (event) => {
          self.postMessage({ type: "progress", event });
        },
        mergedOpts,
      );
      self.postMessage({ type: "result", data: res }, { transfer: [res.vtkBuffer.buffer] });
    } else if (req.kind === "mesh") {
      const targetSurface =
        req.enclosurePadding && req.enclosurePadding > 0 && req.surfaceMesh
          ? generateFluidEnclosureMesh(req.surfaceMesh, req.enclosurePadding)
          : req.surfaceMesh;
      const res = generateLocalTetMesh(req.fineness, req.size, targetSurface);
      self.postMessage({ type: "result", data: res }, { transfer: [res.vtkBuffer.buffer] });
    } else if (req.kind === "mesh-heal") {
      const res = runMeshHealCheck(req.vertices, req.indices);
      self.postMessage({ type: "result", data: res });
    } else if (req.kind === "adjoint") {
      const res = runAdjointSensitivityStudy(req.cfgContent, req.options);
      self.postMessage({ type: "result", data: res }, { transfer: [res.sensitivityField.buffer] });
    } else if (req.kind === "pod-train") {
      const res = trainLocalPodSurrogate(req.snapshots, req.config);
      self.postMessage({ type: "result", data: res });
    } else if (req.kind === "cfd-vv") {
      const res = runCfdVvScorecard();
      self.postMessage({ type: "result", data: res });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
