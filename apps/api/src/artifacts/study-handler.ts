// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { getStandardMimeType, parseStandardStudyDocument } from "../services/studies/study-standards.js";
import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

/**
 * Artifact handler for Standards-Native Engineering Studies:
 *  - SED-ML L1V4 (`.sedml`)
 *  - ASAM / Modelica Association SSP 2.0 Parameter Sets (`.ssv`)
 *  - Sandia Dakota DoE / UQ / Optimization Decks (`.dakota`)
 *
 * When a package containing a `.sedml`, `.ssv`, or `.dakota` file is published,
 * `publish-worker` extracts its metadata into the `artifacts` table (`type = 'study-template'`)
 * and automatically registers it in the cross-package Study Template Gallery.
 */
export class StudyArtifactHandler implements ArtifactHandler {
  readonly type = "study-template";
  readonly displayName = "Engineering Study (SED-ML / SSP / Dakota)";
  readonly extensions = [".sedml", ".ssv", ".dakota"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    const rawText = fileBuffer.toString("utf-8").trim();
    const fileName = path.basename(filePath);

    try {
      const parsed = parseStandardStudyDocument(rawText, fileName);
      const { study, standardFormat, boundModelId, boundModelName, boundInputs, boundParameters } = parsed;

      return {
        type: this.type,
        path: filePath,
        description: study.description,
        mimeType: getStandardMimeType(standardFormat),
        size: fileBuffer.byteLength,
        details: {
          standardFormat,
          rawStandardSource: rawText,
          slug: study.slug,
          name: study.name,
          version: study.version,
          kind: study.kind,
          category: study.category,
          tags: study.tags,
          boundModelId,
          boundModelName,
          boundInputs,
          boundParameters,
          modelContract: study.modelContract,
          inputs: study.inputs,
          presets: study.presets,
          execution: study.execution,
          outputs: study.outputs,
        },
      };
    } catch {
      return null;
    }
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!artifact["path"] || typeof artifact["path"] !== "string") {
      errors.push('Study artifact must specify a valid "path" (.sedml, .ssv, or .dakota).');
    }
    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "study-studio",
      label: String(metadata.details["name"] || "Engineering Study"),
      icon: "sliders",
      config: {
        path: metadata.path,
        ...metadata.details,
      },
    };
  }
}
