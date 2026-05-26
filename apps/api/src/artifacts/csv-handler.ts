import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export class CsvArtifactHandler implements ArtifactHandler {
  readonly type = "csv";
  readonly displayName = "CSV Table";
  readonly extensions = [".csv"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    try {
      // Just verify it's readable
      fileBuffer.toString("utf-8");

      return {
        type: "csv",
        path: filePath,
        description: "CSV Table",
        mimeType: "text/csv",
        size: fileBuffer.length,
        details: {},
      };
    } catch (err) {
      console.error(`[CsvArtifactHandler] Failed to extract metadata from ${filePath}:`, err);
      return null;
    }
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!artifact.path) {
      errors.push("CSV artifact must have a 'path' field");
    } else {
      const p = artifact.path as string;
      const validExts = this.extensions;
      if (!validExts.some((ext) => p.toLowerCase().endsWith(ext))) {
        errors.push(`CSV path must end with ${validExts.join(", ")}, got: "${p}"`);
      }
    }

    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "csv",
      label: "View Table",
      icon: "table",
      config: {
        url: metadata.path, // The frontend will fetch the CSV from the URL
      },
    };
  }
}
