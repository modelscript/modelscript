import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export class MermaidArtifactHandler implements ArtifactHandler {
  readonly type = "mermaid";
  readonly displayName = "Mermaid Diagram";
  readonly extensions = [".mmd", ".mermaid"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    try {
      // Just verify it's readable
      fileBuffer.toString("utf-8");

      return {
        type: "mermaid",
        path: filePath,
        description: "Mermaid Diagram",
        mimeType: "text/plain",
        size: fileBuffer.length,
        details: {},
      };
    } catch (err) {
      console.error(`[MermaidArtifactHandler] Failed to extract metadata from ${filePath}:`, err);
      return null;
    }
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!artifact.path) {
      errors.push("Mermaid artifact must have a 'path' field");
    } else {
      const p = artifact.path as string;
      const validExts = this.extensions;
      if (!validExts.some((ext) => p.toLowerCase().endsWith(ext))) {
        errors.push(`Mermaid path must end with ${validExts.join(", ")}, got: "${p}"`);
      }
    }

    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "mermaid-diagram",
      label: "View Diagram",
      icon: "workflow",
      config: {
        codeUrl: metadata.path, // The frontend can fetch the text from the path
      },
    };
  }
}
