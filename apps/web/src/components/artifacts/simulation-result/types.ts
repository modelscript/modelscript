// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SpatialPin } from "../spatial-pin";
import type { CameraPreset } from "../ViewportCameraControls";

export interface SimulationResultViewConfig {
  url?: string | undefined;
  resultVtuUrl?: string | undefined;
  resultUrl?: string | undefined;
  fileUrl?: string | undefined;
  vtuInline?: string | undefined;
  fieldUnits?: Record<string, string> | undefined;
  threshold?: number | undefined;
  allowableLimit?: number | undefined;
  thresholdLabel?: string | undefined;
  thumbnailUrl?: string | undefined;
  thumbnail_url?: string | undefined;
  solverInfo?: { name?: string | undefined; [key: string]: unknown } | undefined;
  profile?: string | undefined;
  hpc?:
    | {
        profile?: string | undefined;
        costCredits?: number | undefined;
        cpuCoreSeconds?: number | undefined;
        [key: string]: unknown;
      }
    | undefined;
  usage?:
    | {
        costCredits?: number | undefined;
        cpuSeconds?: number | undefined;
        [key: string]: unknown;
      }
    | undefined;
  threadNodeId?: string | number | undefined;
  threadId?: string | number | undefined;
  artifactId?: string | number | undefined;
  [key: string]: unknown;
}

export interface SimulationResultViewerProps {
  artifactId?: number | undefined;
  viewConfig: SimulationResultViewConfig;
  isFullScreen?: boolean | undefined;
  onPinCreated?: ((pin: SpatialPin) => void) | undefined;
  onThreadNodeSelected?: ((threadId: string | number) => void) | undefined;
}

export interface FieldMeta {
  name: string;
  association: "point" | "cell";
  numComponents: number;
  range: [number, number];
  unit?: string | undefined;
}

export type { CameraPreset, SpatialPin };
