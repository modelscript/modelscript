// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DdpArtifactDescriptor, DdpManifest, DdpRelation } from "./types.js";

/** Standard CASCaRA / prostep ivip JSON-LD context URL */
export const DEFAULT_DDP_CONTEXT = "https://w3id.org/cascara/v1/context.jsonld";

/**
 * Serializer, parser, and validator for Digital Data Package (DDP) manifests.
 */
export class DdpManifestParser {
  /**
   * Parse a JSON or JSON-LD DDP manifest string into a DdpManifest structure.
   */
  static parse(jsonStr: string): DdpManifest {
    const raw = JSON.parse(jsonStr) as Record<string, unknown>;

    // Handle standard ddpVersion or default to 1.0
    const ddpVersion = typeof raw.ddpVersion === "string" ? raw.ddpVersion : "1.0";
    const packageId = typeof raw.packageId === "string" ? raw.packageId : ((raw.id as string) ?? "ddp:unnamed-package");
    const title = typeof raw.title === "string" ? raw.title : ((raw.name as string) ?? packageId);
    const version = typeof raw.version === "string" ? raw.version : "1.0.0";
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();

    const artifactsRaw = (raw.artifacts as Record<string, unknown>) ?? {};
    const artifacts = {
      requirements: Array.isArray(artifactsRaw.requirements)
        ? (artifactsRaw.requirements as DdpArtifactDescriptor[])
        : undefined,
      geometry: Array.isArray(artifactsRaw.geometry) ? (artifactsRaw.geometry as DdpArtifactDescriptor[]) : undefined,
      behavior: Array.isArray(artifactsRaw.behavior) ? (artifactsRaw.behavior as DdpArtifactDescriptor[]) : undefined,
      parameters: Array.isArray(artifactsRaw.parameters)
        ? (artifactsRaw.parameters as DdpArtifactDescriptor[])
        : undefined,
      documentation: Array.isArray(artifactsRaw.documentation)
        ? (artifactsRaw.documentation as DdpArtifactDescriptor[])
        : undefined,
    };

    const relations = Array.isArray(raw.relations) ? (raw.relations as DdpRelation[]) : undefined;

    return {
      "@context": (raw["@context"] as string | Record<string, string>) ?? DEFAULT_DDP_CONTEXT,
      ddpVersion,
      packageId,
      title,
      version,
      description: typeof raw.description === "string" ? raw.description : undefined,
      creator: raw.creator as DdpManifest["creator"],
      recipient: raw.recipient as DdpManifest["recipient"],
      createdAt,
      modifiedAt: typeof raw.modifiedAt === "string" ? raw.modifiedAt : undefined,
      securityClassification: typeof raw.securityClassification === "string" ? raw.securityClassification : undefined,
      license: typeof raw.license === "string" ? raw.license : undefined,
      artifacts,
      relations,
      properties: raw.properties as Record<string, unknown> | undefined,
    };
  }

  /**
   * Serialize a DdpManifest into a formatted JSON string.
   */
  static serialize(manifest: DdpManifest, pretty = true): string {
    const output: Record<string, unknown> = {
      "@context": manifest["@context"] ?? DEFAULT_DDP_CONTEXT,
      ddpVersion: manifest.ddpVersion,
      packageId: manifest.packageId,
      title: manifest.title,
      version: manifest.version,
    };

    if (manifest.description) output.description = manifest.description;
    if (manifest.creator) output.creator = manifest.creator;
    if (manifest.recipient) output.recipient = manifest.recipient;
    output.createdAt = manifest.createdAt;
    if (manifest.modifiedAt) output.modifiedAt = manifest.modifiedAt;
    if (manifest.securityClassification) output.securityClassification = manifest.securityClassification;
    if (manifest.license) output.license = manifest.license;

    output.artifacts = manifest.artifacts;
    if (manifest.relations && manifest.relations.length > 0) {
      output.relations = manifest.relations;
    }
    if (manifest.properties && Object.keys(manifest.properties).length > 0) {
      output.properties = manifest.properties;
    }

    return JSON.stringify(output, null, pretty ? 2 : undefined);
  }

  /**
   * Validate a DdpManifest for structural consistency and referential link integrity.
   */
  static validate(manifest: DdpManifest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!manifest.packageId) {
      errors.push("Missing required field 'packageId'.");
    }
    if (!manifest.title) {
      errors.push("Missing required field 'title'.");
    }
    if (!manifest.version) {
      errors.push("Missing required field 'version'.");
    }

    // Collect all declared artifact IDs and paths for link validation
    const knownArtifactIds = new Set<string>();
    const knownArtifactPaths = new Set<string>();

    const allArtifacts = [
      ...(manifest.artifacts.requirements ?? []),
      ...(manifest.artifacts.geometry ?? []),
      ...(manifest.artifacts.behavior ?? []),
      ...(manifest.artifacts.parameters ?? []),
      ...(manifest.artifacts.documentation ?? []),
    ];

    for (const art of allArtifacts) {
      if (!art.id) errors.push(`Artifact missing 'id': ${JSON.stringify(art)}`);
      if (!art.path) errors.push(`Artifact '${art.id}' missing 'path'.`);
      if (!art.contentType) errors.push(`Artifact '${art.id}' missing 'contentType'.`);

      knownArtifactIds.add(art.id);
      knownArtifactPaths.add(art.path);
      // Also register clean relative paths (without leading slash)
      if (art.path.startsWith("/")) {
        knownArtifactPaths.add(art.path.slice(1));
      }
    }

    // Validate relations if present
    if (manifest.relations) {
      for (let i = 0; i < manifest.relations.length; i++) {
        const rel = manifest.relations[i];
        if (!rel.relationType) {
          errors.push(`Relation at index ${i} is missing 'relationType'.`);
        }
        if (!rel.source) {
          errors.push(`Relation at index ${i} is missing 'source'.`);
        }
        if (!rel.target) {
          errors.push(`Relation at index ${i} is missing 'target'.`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create an initial blank DDP manifest with sensible defaults.
   */
  static createDefaultManifest(packageId: string, title: string, version = "1.0.0"): DdpManifest {
    return {
      "@context": DEFAULT_DDP_CONTEXT,
      ddpVersion: "1.0",
      packageId,
      title,
      version,
      createdAt: new Date().toISOString(),
      artifacts: {
        requirements: [],
        geometry: [],
        behavior: [],
        parameters: [],
        documentation: [],
      },
      relations: [],
    };
  }
}
