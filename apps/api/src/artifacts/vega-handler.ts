import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export class VegaArtifactHandler implements ArtifactHandler {
  readonly type = "vega";
  readonly displayName = "Vega/Vega-Lite Plot";
  readonly extensions = [".vl.json", ".vg.json", ".vega.json"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    try {
      const content = fileBuffer.toString("utf-8");
      const spec = JSON.parse(content);
      const isVegaLite = spec.$schema && spec.$schema.includes("vega-lite");

      return {
        type: "vega",
        path: filePath,
        description: spec.description || (isVegaLite ? "Vega-Lite Plot" : "Vega Plot"),
        mimeType: "application/json",
        size: fileBuffer.length,
        details: {
          isVegaLite,
          schema: spec.$schema,
        },
      };
    } catch (err) {
      console.error(`[VegaArtifactHandler] Failed to extract metadata from ${filePath}:`, err);
      return null;
    }
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!artifact.path) {
      errors.push("Vega artifact must have a 'path' field");
    } else {
      const p = artifact.path as string;
      const validExts = this.extensions;
      if (!validExts.some((ext) => p.toLowerCase().endsWith(ext))) {
        errors.push(`Vega path must end with ${validExts.join(", ")}, got: "${p}"`);
      }
    }

    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "vega-plot",
      label: "View Plot",
      icon: "graph",
      config: {
        spec: metadata.path, // The frontend can fetch the JSON from the path
      },
    };
  }
}
