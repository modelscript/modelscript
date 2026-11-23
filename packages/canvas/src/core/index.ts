// SPDX-License-Identifier: AGPL-3.0-or-later

export { computeSnapAndGuides, type AlignmentGuideLine, type SnapResult } from "./alignment-guides.js";
export { CameraController, type CameraControllerOptions, type CameraState, type ViewportSize } from "./camera.js";
export { CanvasCommandBus, type CanvasCommand } from "./command-bus.js";
export {
  DEFAULT_LOD_THRESHOLDS,
  WebGlContextBudget,
  resolveTileLodTier,
  type LodThresholds,
  type WebGlSlotAllocation,
} from "./lod-scheduler.js";
export { CanvasSpatialIndex, boundsIntersect, pointInBounds, type IndexedSpatialItem } from "./spatial-index.js";
