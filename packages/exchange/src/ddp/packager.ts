// SPDX-License-Identifier: AGPL-3.0-or-later

import { strToU8, unzipSync, zipSync } from "fflate";
import { DdpManifestParser } from "./manifest.js";
import type { DdpArtifactDescriptor, DdpManifest, DdpPackageContent, DdpPackageOptions } from "./types.js";

/** Default file name for the DDP manifest inside the container */
export const DDP_MANIFEST_FILENAME = "ddp-manifest.json";
/** Alternative file name supported for prostep ivip compatibility */
export const DDP_LEGACY_MANIFEST_FILENAME = "manifest.json";

/**
 * Packager and extractor for Digital Data Package (.ddp / .zip) containers.
 *
 * Implements prostep ivip PSI 21 container packaging using standard ZIP archives
 * containing a root ddp-manifest.json and organized domain subdirectories:
 * - requirements/  (SysML v2, ReqIF)
 * - geometry/      (STEP AP242, JT, 3D PDF)
 * - behavior/      (SSP, FMU, Modelica)
 * - parameters/    (SSV, CSV, JSON)
 * - docs/          (PDF, Markdown, HTML)
 */
export class DdpPackager {
  /**
   * Build a compliant .ddp ZIP archive from a manifest and supplementary domain files.
   */
  static buildDdp(options: DdpPackageOptions): Uint8Array {
    const zipEntries: Record<string, Uint8Array> = {};

    // 1. Process & validate manifest
    let manifestObj: DdpManifest;
    let manifestStr: string;

    if (typeof options.manifest === "string") {
      manifestStr = options.manifest;
      manifestObj = DdpManifestParser.parse(manifestStr);
    } else {
      manifestObj = options.manifest;
      manifestStr = DdpManifestParser.serialize(manifestObj, true);
    }

    // Embed root ddp-manifest.json
    zipEntries[DDP_MANIFEST_FILENAME] = strToU8(manifestStr);

    // 2. Add supplementary domain files
    const files = options.files ?? [];
    for (const f of files) {
      const cleanPath = f.path.startsWith("/") ? f.path.slice(1) : f.path;
      const data = typeof f.data === "string" ? strToU8(f.data) : f.data;
      zipEntries[cleanPath] = data;
    }

    // 3. Compress using fflate
    const level = (options.compressionLevel ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    return zipSync(zipEntries, { level });
  }

  /**
   * Extract a .ddp ZIP archive into its parsed manifest and extracted file map.
   */
  static extractDdp(ddpBuffer: Uint8Array): DdpPackageContent {
    const unzipped = unzipSync(ddpBuffer);
    const files = new Map<string, Uint8Array>();
    let rawManifest: string | null = null;

    // Scan for manifest first
    for (const [path, data] of Object.entries(unzipped)) {
      if (
        path === DDP_MANIFEST_FILENAME ||
        path === DDP_LEGACY_MANIFEST_FILENAME ||
        path.endsWith("/" + DDP_MANIFEST_FILENAME) ||
        path.endsWith("/" + DDP_LEGACY_MANIFEST_FILENAME)
      ) {
        rawManifest = new TextDecoder().decode(data);
      } else {
        files.set(path, data);
      }
    }

    if (!rawManifest) {
      throw new Error(
        `Invalid DDP container: neither '${DDP_MANIFEST_FILENAME}' nor '${DDP_LEGACY_MANIFEST_FILENAME}' found in archive root.`,
      );
    }

    const manifest = DdpManifestParser.parse(rawManifest);

    return {
      manifest,
      rawManifest,
      files,
    };
  }

  /**
   * Infer standard MIME content type and domain classification from file extension.
   */
  static inferArtifactMetadata(filePath: string): {
    contentType: string;
    domain: DdpArtifactDescriptor["domain"];
    format: string;
  } {
    const lower = filePath.toLowerCase();

    if (lower.endsWith(".sysml")) {
      return { contentType: "text/x-sysml2", domain: "requirements", format: "SysML v2" };
    }
    if (lower.endsWith(".reqif") || lower.endsWith(".reqifz")) {
      return { contentType: "application/x-reqif+xml", domain: "requirements", format: "ReqIF 1.2" };
    }
    if (lower.endsWith(".stp") || lower.endsWith(".step")) {
      return { contentType: "application/step", domain: "geometry", format: "STEP AP242" };
    }
    if (lower.endsWith(".jt")) {
      return { contentType: "model/jt", domain: "geometry", format: "JT (ISO 14306)" };
    }
    if (lower.endsWith(".fmu")) {
      return { contentType: "application/x-fmu", domain: "behavior", format: "FMI 3.0 / 2.0" };
    }
    if (lower.endsWith(".ssp")) {
      return { contentType: "application/x-ssp", domain: "behavior", format: "SSP 1.0" };
    }
    if (lower.endsWith(".mo")) {
      return { contentType: "text/x-modelica", domain: "behavior", format: "Modelica 3.6" };
    }
    if (lower.endsWith(".ssv") || lower.endsWith(".csv")) {
      return { contentType: "text/csv", domain: "parameters", format: "Parameter Set" };
    }
    if (lower.endsWith(".pdf")) {
      return { contentType: "application/pdf", domain: "documentation", format: "PDF / 3D PDF" };
    }
    if (lower.endsWith(".json")) {
      return { contentType: "application/json", domain: "documentation", format: "JSON" };
    }
    if (lower.endsWith(".md") || lower.endsWith(".txt")) {
      return { contentType: "text/plain", domain: "documentation", format: "Text" };
    }

    return { contentType: "application/octet-stream", domain: "other", format: "Binary" };
  }
}
