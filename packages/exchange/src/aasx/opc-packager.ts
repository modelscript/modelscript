// SPDX-License-Identifier: AGPL-3.0-or-later

import { strToU8, unzipSync, zipSync } from "fflate";
import type { AasJsonProjection } from "../lens/types.js";

export interface AasxFileEntry {
  path: string;
  data: Uint8Array | string;
  contentType?: string | undefined;
}

export interface AasxPackageOptions {
  aasJson: AasJsonProjection | string;
  files?: AasxFileEntry[] | undefined;
}

/**
 * Generates and unpacks Open Packaging Conventions (OPC) compliant .aasx ZIP containers
 * for IEC 63278-1 Asset Administration Shells.
 */
export class OpcAasxPackager {
  /**
   * Build a compliant .aasx ZIP buffer from an AAS JSON structure and supplementary files.
   */
  static buildAasx(options: AasxPackageOptions): Uint8Array {
    const zipEntries: Record<string, Uint8Array> = {};

    const aasJsonStr = typeof options.aasJson === "string" ? options.aasJson : JSON.stringify(options.aasJson, null, 2);

    // 1. AAS Core Spec JSON
    zipEntries["aasx/aas.json"] = strToU8(aasJsonStr);

    // 2. Add supplementary files
    const fileEntries = options.files ?? [];
    for (const f of fileEntries) {
      const cleanPath = f.path.startsWith("/") ? f.path.slice(1) : f.path;
      const targetPath = cleanPath.startsWith("aasx/") ? cleanPath : `aasx/files/${cleanPath}`;
      const data = typeof f.data === "string" ? strToU8(f.data) : f.data;
      zipEntries[targetPath] = data;
    }

    // 3. Generate _rels/.rels
    const relsXml = `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://admin-shell.io/aas/spec/v3/package/1/0/aas-spec" Target="/aasx/aas.json" Id="Rel_AasSpec"/>
</Relationships>`;
    zipEntries["_rels/.rels"] = strToU8(relsXml);

    // 4. Generate [Content_Types].xml
    const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="step" ContentType="application/step"/>
  <Default Extension="stp" ContentType="application/step"/>
  <Default Extension="pdf" ContentType="application/pdf"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="mo" ContentType="text/plain"/>
  <Default Extension="sysml" ContentType="text/plain"/>
  <Override PartName="/aasx/aas.json" ContentType="application/asset-administration-shell-package+json"/>
</Types>`;
    zipEntries["[Content_Types].xml"] = strToU8(contentTypesXml);

    // 5. Compress to ZIP buffer
    return zipSync(zipEntries, { level: 6 });
  }

  /**
   * Unpack an .aasx ZIP buffer into the AAS JSON projection and extracted file entries.
   */
  static extractAasx(aasxBuffer: Uint8Array): {
    aasJson: AasJsonProjection | null;
    rawAasJson: string | null;
    files: Map<string, Uint8Array>;
  } {
    const unzipped = unzipSync(aasxBuffer);
    const files = new Map<string, Uint8Array>();
    let rawAasJson: string | null = null;
    let aasJson: AasJsonProjection | null = null;

    for (const [path, data] of Object.entries(unzipped)) {
      if (path === "aasx/aas.json" || path.endsWith("/aas.json")) {
        rawAasJson = new TextDecoder().decode(data);
        try {
          aasJson = JSON.parse(rawAasJson) as AasJsonProjection;
        } catch {
          // Keep raw string if parse fails
        }
      } else if (!path.startsWith("_rels") && !path.endsWith("[Content_Types].xml")) {
        files.set(path, data);
      }
    }

    return {
      aasJson,
      rawAasJson,
      files,
    };
  }
}
