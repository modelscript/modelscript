// SPDX-License-Identifier: AGPL-3.0-or-later

import { DatasetArtifactHandler } from "./dataset-handler.js";
import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export class CsvArtifactHandler implements ArtifactHandler {
  readonly type = "csv";
  readonly displayName = "CSV Table";
  readonly extensions = [".csv"];
  readonly #datasetHandler = new DatasetArtifactHandler();

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    try {
      const datasetMeta = await this.#datasetHandler.extractMetadata(fileBuffer, filePath);
      return {
        type: "csv",
        path: filePath,
        description: datasetMeta?.description ?? "CSV Table",
        mimeType: "text/csv",
        size: fileBuffer.length,
        details: datasetMeta?.details ?? {},
      };
    } catch (err) {
      console.error(`[CsvArtifactHandler] Failed to extract metadata from ${filePath}:`, err);
      return null;
    }
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!artifact["path"]) {
      errors.push("CSV artifact must have a 'path' field");
    } else {
      const p = artifact["path"] as string;
      const validExts = this.extensions;
      if (!validExts.some((ext) => p.toLowerCase().endsWith(ext))) {
        errors.push(`CSV path must end with ${validExts.join(", ")}, got: "${p}"`);
      }
    }

    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "dataset-table",
      label: "View Table",
      icon: "table",
      config: {
        url: metadata.path,
        ...metadata.details,
      },
    };
  }
}
