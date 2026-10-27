// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SpatialPin } from "../spatial-pin";
import type { CameraPreset } from "../ViewportCameraControls";

export interface SimulationResultViewerProps {
  artifactId?: number | undefined;
  viewConfig: any;
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
