// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU (Functional Mock-up Interface) utility support.
 *
 * Provides lightweight XML parsing and ZIP extraction for FMI 2.0/3.0 modelDescription.xml.
 */

import { inflateRaw } from "pako";

// ── FMU model description types ──

export interface FmuScalarVariable {
  name: string;
  causality: "input" | "output" | "local" | "parameter" | "calculatedParameter" | "independent";
  variability: "continuous" | "discrete" | "fixed" | "tunable" | "constant";
  description: string;
  type: "Real" | "Integer" | "Boolean" | "String" | "Enumeration";
  start?: number | boolean | string;
}

// ── XML parsing ──

/**
 * Parse scalar variables from an FMI 2.0 `modelDescription.xml` string.
 * Uses lightweight regex matching — no DOM parser required.
 */
export function parseFmuModelDescription(xml: string): {
  modelName: string;
  description: string;
  variables: FmuScalarVariable[];
} {
  // Extract modelName
  const nameMatch = xml.match(/modelName\s*=\s*"([^"]*)"/);
  const modelName = nameMatch?.[1] ?? "FMU";

  // Extract top-level description
  const descMatch = xml.match(/<fmiModelDescription[^>]*\bdescription\s*=\s*"([^"]*)"/);
  const description = descMatch?.[1] ?? "";

  // Extract scalar variables
  const variables: FmuScalarVariable[] = [];
  const scalarRegex =
    /<ScalarVariable\b([^>]*)\/?>[\s\S]*?(?:<\/ScalarVariable>|(?=<ScalarVariable|<\/ModelVariables))/g;
  let match: RegExpExecArray | null;

  while ((match = scalarRegex.exec(xml)) !== null) {
    const attrs = match[0] ?? "";
    const headerAttrs = match[1] ?? "";

    const varName = headerAttrs.match(/\bname\s*=\s*"([^"]*)"/)?.[1];
    if (!varName) continue;

    const causality = (headerAttrs.match(/\bcausality\s*=\s*"([^"]*)"/)?.[1] ??
      "local") as FmuScalarVariable["causality"];
    const variability = (headerAttrs.match(/\bvariability\s*=\s*"([^"]*)"/)?.[1] ??
      "continuous") as FmuScalarVariable["variability"];
    const varDesc = headerAttrs.match(/\bdescription\s*=\s*"([^"]*)"/)?.[1] ?? "";

    // Extract type based on inner tags
    let type: FmuScalarVariable["type"] = "Real";
    if (attrs.includes("<Integer")) type = "Integer";
    else if (attrs.includes("<Boolean")) type = "Boolean";
    else if (attrs.includes("<String")) type = "String";
    else if (attrs.includes("<Enumeration")) type = "Enumeration";

    // Extract start value from nested tags
    const startMatch = attrs.match(/\bstart\s*=\s*"([^"]*)"/);
    const start = startMatch ? parseFloat(startMatch[1] ?? "") : undefined;

    variables.push({
      name: varName,
      causality,
      variability,
      description: varDesc,
      type,
      ...(Number.isFinite(start) ? { start: start as number } : {}),
    });
  }

  return { modelName, description, variables };
}

// ── Lightweight ZIP reader (browser-safe, uses pako) ──

/**
 * Extract a file from a ZIP archive by name.
 * Supports STORED (method 0) and DEFLATED (method 8) entries.
 */
export function extractFromZip(zipData: Uint8Array, targetName: string): Uint8Array | null {
  // Find End of Central Directory
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData[i] === 0x50 && zipData[i + 1] === 0x4b && zipData[i + 2] === 0x05 && zipData[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;

  // Scan central directory
  let pos = cdOffset;
  while (pos < cdEnd) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const fileName = new TextDecoder().decode(zipData.subarray(pos + 46, pos + 46 + fileNameLength));

    if (fileName === targetName) {
      // Read from local file header
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;
      const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

      if (compressionMethod === 0) {
        return zipData.subarray(dataStart, dataStart + compressedSize);
      } else if (compressionMethod === 8) {
        try {
          return inflateRaw(zipData.subarray(dataStart, dataStart + compressedSize));
        } catch {
          return null;
        }
      }
      return null;
    }
    pos += 46 + fileNameLength + extraLength + commentLength;
  }
  return null;
}
