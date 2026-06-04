// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CFD Animation Artifact Handler
 *
 * Handles animated CFD co-simulation results (melt-front visualizations,
 * volume-of-fluid animations, etc.). The view_config stores an array of
 * time-stepped mesh frames with per-vertex scalar fields.
 *
 * For web viewing, provides a viewer descriptor that maps to
 * the CfdAnimationViewer frontend component.
 */

import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export class CfdAnimationHandler implements ArtifactHandler {
  readonly type = "cfd-animation";
  readonly displayName = "CFD Animation";
  readonly extensions = [".cfd.json"];

  async extractMetadata(_fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    return {
      type: this.type,
      path: filePath,
      description: "CFD melt-front animation",
      details: {},
    };
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!artifact.path && !artifact.frames) errors.push("Missing frames data");
    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "cfd-animation",
      label: "CFD Animation",
      icon: "flame",
      config: { ...metadata.details },
    };
  }
}
