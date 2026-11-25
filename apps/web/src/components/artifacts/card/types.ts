// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArtifactViewRecord } from "../../../api/artifacts";
import type { AnySpatialPin } from "../spatial-pin";

export interface ArtifactDependencyEntry {
  name: string;
  version: string;
  [key: string]: unknown;
}

export interface ArtifactViewConfig {
  title?: string | undefined;
  description?: string | undefined;
  caption?: string | undefined;
  view_type?: string | undefined;
  format?: string | undefined;
  dialect?: string | undefined;
  url?: string | undefined;
  downloadUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  thumbnail_url?: string | undefined;
  thumbnailUrlLight?: string | undefined;
  thumbnailUrlDark?: string | undefined;
  svg?: string | undefined;
  spec?: unknown;
  code?: string | undefined;
  filename?: string | undefined;
  uri?: string | undefined;
  className?: string | undefined;
  artifactId?: string | number | undefined;
  standalone?: boolean | undefined;
  jobId?: string | number | undefined;
  provenance?: { solver?: string | undefined; profile?: string | undefined; [key: string]: unknown } | undefined;
  solverInfo?: { name?: string | undefined; [key: string]: unknown } | undefined;
  profile?: string | undefined;
  usage?: { cpuSeconds?: number | undefined; costCredits?: number | undefined; [key: string]: unknown } | undefined;
  hpc?:
    | {
        cpuCoreSeconds?: number | undefined;
        costCredits?: number | undefined;
        profile?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
  dependencies?: ArtifactDependencyEntry[] | undefined;
  modelName?: string | undefined;
  fmiVersion?: string | undefined;
  hasWasm?: boolean | undefined;
  variables?: unknown[] | undefined;
  inputs?: unknown[] | undefined;
  outputs?: unknown[] | undefined;
  parameters?: unknown[] | undefined;
  systemName?: string | undefined;
  parts?: unknown[] | undefined;
  requirements?: unknown[] | undefined;
  rowCount?: number | undefined;
  rows?: unknown[] | undefined;
  columns?: unknown[] | undefined;
  componentCount?: number | undefined;
  systemFrequencyHz?: number | undefined;
  busCount?: number | undefined;
  fmuCount?: number | undefined;
  bodyCount?: number | undefined;
  forkedFromArtifactId?: number | string | undefined;
  forked_from_artifact_id?: number | string | undefined;
  upstreamArtifactId?: number | string | undefined;
  modifiedParametersCount?: number | undefined;
  parameterDeltas?: unknown[] | undefined;
  [key: string]: unknown;
}

export interface ArtifactCardRecord extends Partial<ArtifactViewRecord> {
  id?: number | string | undefined;
  view_type: string;
  viewType?: string | undefined;
  view_config?: Record<string, unknown> | string | undefined;
  viewConfigJson?: Record<string, unknown> | string | undefined;
  title?: string | null | undefined;
  name?: string | null | undefined;
  username?: string | null | undefined;
  display_name?: string | null | undefined;
  description?: string | null | undefined;
  thumbnail_url?: string | null | undefined;
  metadata?: string | Record<string, unknown> | undefined;
  forked_from_id?: number | string | null | undefined;
  post?: { forked_from_post_id?: number | string | null | undefined; [key: string]: unknown } | undefined;
  artifactView?: ArtifactCardRecord | undefined;
  artifact_view?: ArtifactCardRecord | undefined;
  [key: string]: unknown;
}

export interface ArtifactViewCardProps {
  artifactId: number | string;
  initialArtifactView?: ArtifactCardRecord | Record<string, unknown> | null | undefined;
  forkedFromId?: number | string | undefined;
  figureNumber?: number | undefined;
  caption?: string | undefined;
  onPinCreated?: ((pin: AnySpatialPin) => void) | undefined;
  onThreadNodeSelected?: ((threadId: string | number) => void) | undefined;
  isFullScreen?: boolean | undefined;
  onFullScreenChange?: ((isFullScreen: boolean) => void) | undefined;
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
