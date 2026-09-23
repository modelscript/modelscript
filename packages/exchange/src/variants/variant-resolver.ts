// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanonicalBOMItem, CanonicalWorkspaceManifest } from "../lens/types.js";

export interface VariantResolutionResult {
  variantId: string;
  description?: string | undefined;
  resolvedManifest: CanonicalWorkspaceManifest;
  parameterOverrides: Record<string, unknown>;
  resolvedBom: CanonicalBOMItem[];
}

/**
 * Resolves 150% super-model manifests and parameter sets down to deterministic
 * 100% variant configurations.
 */
export class VariantResolver {
  /**
   * Resolve a specific variant configuration from a 150% canonical manifest.
   */
  static resolveVariant(manifest: CanonicalWorkspaceManifest, variantId?: string): VariantResolutionResult {
    // If no variants defined or no variant requested, return baseline 100%
    if (!variantId || !manifest.variants || !(variantId in manifest.variants)) {
      const defaultId = variantId ?? (manifest.variants ? Object.keys(manifest.variants)[0] : "default") ?? "default";
      return {
        variantId: defaultId,
        resolvedManifest: manifest,
        parameterOverrides: {},
        resolvedBom: manifest.bom ?? [],
      };
    }

    const variantConfig = manifest.variants[variantId];
    if (!variantConfig) {
      throw new Error(`Variant '${variantId}' not found in manifest.`);
    }

    const overrides = variantConfig.overrides ?? {};

    // Filter or adjust BOM items based on variant tags or overrides
    const resolvedBom: CanonicalBOMItem[] = [];
    if (manifest.bom) {
      for (const item of manifest.bom) {
        // If an item has a category or name matching an override, apply it
        let include = true;

        // Support conditional BOM items if variant tags are encoded
        // (e.g. partNumber: "Askoll-230V [variant:eu]" vs "Askoll-120V [variant:us]")
        if (item.partNumber && item.partNumber.includes("[variant:")) {
          const start = item.partNumber.indexOf("[variant:");
          const end = item.partNumber.indexOf("]", start);
          if (start !== -1 && end !== -1) {
            const raw = item.partNumber.slice(start + "[variant:".length, end);
            const allowedVariants = raw.split(",").map((v) => v.trim());
            if (!allowedVariants.includes(variantId)) {
              include = false;
            }
          }
        }

        if (include) {
          resolvedBom.push({ ...item });
        }
      }
    }

    // Clone manifest and update metadata
    const resolvedManifest: CanonicalWorkspaceManifest = {
      ...manifest,
      idShort: `${manifest.idShort}-${variantId}`,
      title: `${manifest.title} (${variantConfig.description ?? variantId})`,
      bom: resolvedBom,
    };

    return {
      variantId,
      description: variantConfig.description,
      resolvedManifest,
      parameterOverrides: overrides,
      resolvedBom,
    };
  }
}
