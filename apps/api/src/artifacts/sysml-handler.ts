// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export class SysmlArtifactHandler implements ArtifactHandler {
  readonly type = "sysml";
  readonly displayName = "SysML v2 Architecture";
  readonly extensions = [".sysml"];

  async extractMetadata(_fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    return {
      type: this.type,
      path: filePath,
      description: "SysML v2 System Definition",
      details: { format: "SysML2" },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate(_artifact: Record<string, unknown>): string[] {
    return [];
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "sysml-architecture-viewer",
      label: "System Architecture",
      icon: "schema",
      config: { ...metadata.details },
    };
  }
}
