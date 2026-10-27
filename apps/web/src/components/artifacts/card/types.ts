// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AnySpatialPin } from "../spatial-pin";

export interface ArtifactViewCardProps {
  artifactId: number;
  initialArtifactView?: any;
  forkedFromId?: number | string | undefined;
  onPinCreated?: ((pin: AnySpatialPin) => void) | undefined;
  onThreadNodeSelected?: ((threadId: string | number) => void) | undefined;
}

export type PlaceholderType =
  | "generic"
  | "cfd"
  | "fea"
  | "cad"
  | "gcode"
  | "fmu"
  | "sysml"
  | "dataset"
  | "plot"
  | "pdf"
  | "circuit"
  | "network"
  | "hydraulic"
  | "schematic";
