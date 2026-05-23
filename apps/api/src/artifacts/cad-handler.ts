// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export class CadArtifactHandler implements ArtifactHandler {
  readonly type = "cad";
  readonly displayName = "CAD 3D Model";
  readonly extensions = [".step", ".stp"];

  async extractMetadata(_fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    return {
      type: this.type,
      path: filePath,
      description: "3D CAD Model (STEP format)",
      details: { format: "STEP" },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate(_artifact: Record<string, unknown>): string[] {
    return [];
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "cad-3d-viewer",
      label: "3D Viewer",
      icon: "cube",
      config: { ...metadata.details },
    };
  }
}
