// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU Artifact Handler
 *
 * Handles Functional Mock-up Units (FMU) per the FMI 2.0 / 3.0 standard.
 * FMUs are ZIP archives containing:
 *   - modelDescription.xml (metadata, variables, parameters)
 *   - binaries/ (platform-specific shared libraries or WASM)
 *   - resources/ (additional data files)
 *   - documentation/ (optional docs)
 *
 * At publish time, this handler extracts:
 *   - FMI version
 *   - Model name and description
 *   - Available platforms (from binaries/ directory)
 *   - Scalar variables (inputs, outputs, parameters)
 *   - Generation tool info
 *
 * The Web UI viewer allows in-browser simulation when a WASM binary is present.
 */

import zlib from "node:zlib";
import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

/** Parsed scalar variable from modelDescription.xml. */
export interface FmuScalarVariable {
  name: string;
  valueReference: number;
  causality: string; // 'input' | 'output' | 'parameter' | 'local' | 'independent'
  variability: string; // 'constant' | 'fixed' | 'tunable' | 'discrete' | 'continuous'
  description?: string | undefined;
  type: string; // 'Real' | 'Integer' | 'Boolean' | 'String' | 'Float64' | ...
  start?: string | undefined;
  unit?: string | undefined;
  min?: string | undefined;
  max?: string | undefined;
}

/** FMU-specific metadata stored in artifact details. */
export interface FmuDetails {
  fmiVersion: string;
  modelName: string;
  modelDescription?: string | undefined;
  modelDescriptionXml?: string | undefined;
  generationTool?: string | undefined;
  generationDateAndTime?: string | undefined;
  guid: string;
  platforms: string[];
  hasWasm: boolean;
  variables: FmuScalarVariable[];
  inputs: FmuScalarVariable[];
  outputs: FmuScalarVariable[];
  parameters: FmuScalarVariable[];
  numberOfEventIndicators?: number | undefined;
}

/**
 * Extract a simple XML attribute value from a tag.
 * Minimal XML parser — avoids pulling in heavyweight XML deps.
 */
function extractXmlAttr(xml: string, tag: string, attr: string): string | undefined {
  // Find the tag (e.g., <fmiModelDescription ...)
  const tagRegex = new RegExp(`<${tag}[\\s>]`, "i");
  const tagMatch = tagRegex.exec(xml);
  if (!tagMatch) return undefined;

  // Read the full tag content (up to > or />)
  const remaining = xml.substring(tagMatch.index);
  const endTag = remaining.indexOf(">");
  if (endTag === -1) return undefined;
  const tagContent = remaining.substring(0, endTag + 1);

  // Extract the attribute
  const attrRegex = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i");
  const attrMatch = attrRegex.exec(tagContent);
  return attrMatch?.[1];
}

/**
 * Extract scalar variables from modelDescription.xml (supports both FMI 2.0 <ScalarVariable>
 * and FMI 3.0 typed variable elements <Float64>, <Int32>, <Boolean>, etc.).
 */
function extractScalarVariables(xml: string): FmuScalarVariable[] {
  const variables: FmuScalarVariable[] = [];

  // 1. FMI 2.0 <ScalarVariable> elements
  const svRegex = /<ScalarVariable\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/ScalarVariable>)/gi;
  let match: RegExpExecArray | null;

  while ((match = svRegex.exec(xml)) !== null) {
    const attrStr = match[1] ?? "";
    const innerContent = match[2] ?? "";

    const nameMatch = /\bname\s*=\s*"([^"]*)"/.exec(attrStr);
    const vrMatch = /\bvalueReference\s*=\s*"(\d+)"/.exec(attrStr);
    const causalityMatch = /\bcausality\s*=\s*"([^"]*)"/.exec(attrStr);
    const variabilityMatch = /\bvariability\s*=\s*"([^"]*)"/.exec(attrStr);
    const descMatch = /\bdescription\s*=\s*"([^"]*)"/.exec(attrStr);

    if (!nameMatch?.[1] || !vrMatch?.[1]) continue;

    let type = "Real";
    let start: string | undefined;
    let unit: string | undefined;
    let min: string | undefined;
    let max: string | undefined;

    const typeMatch =
      /<(Real|Integer|Boolean|String|Enumeration|Float32|Float64|Int8|UInt8|Int16|UInt16|Int32|UInt32|Int64|UInt64)\s*([^>]*?)\/?>/.exec(
        innerContent || attrStr,
      );
    if (typeMatch) {
      type = typeMatch[1] ?? "Real";
      const typeAttrs = typeMatch[2] ?? "";
      const startMatch = /\bstart\s*=\s*"([^"]*)"/.exec(typeAttrs);
      if (startMatch?.[1] !== undefined) start = startMatch[1];
      const unitMatch = /\bunit\s*=\s*"([^"]*)"/.exec(typeAttrs);
      if (unitMatch?.[1] !== undefined) unit = unitMatch[1];
      const minMatch = /\bmin\s*=\s*"([^"]*)"/.exec(typeAttrs);
      if (minMatch?.[1] !== undefined) min = minMatch[1];
      const maxMatch = /\bmax\s*=\s*"([^"]*)"/.exec(typeAttrs);
      if (maxMatch?.[1] !== undefined) max = maxMatch[1];
    }

    variables.push({
      name: nameMatch[1] ?? "Unknown",
      valueReference: parseInt(vrMatch[1] ?? "0", 10),
      causality: causalityMatch?.[1] ?? "local",
      variability: variabilityMatch?.[1] ?? "continuous",
      description: descMatch?.[1],
      type,
      start,
      unit,
      min,
      max,
    });
  }

  // 2. FMI 3.0 direct typed variable elements inside <ModelVariables> (when no FMI 2.0 <ScalarVariable> matched)
  if (variables.length === 0) {
    const mvMatch = /<ModelVariables\b[^>]*>([\s\S]*?)<\/ModelVariables>/i.exec(xml);
    const mvScope = mvMatch?.[1] ?? xml;
    const fmi3Regex =
      /<(Float64|Float32|Int64|UInt64|Int32|UInt32|Int16|UInt16|Int8|UInt8|Boolean|String|Binary|Enumeration|Clock)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
    while ((match = fmi3Regex.exec(mvScope)) !== null) {
      const rawType = match[1] ?? "Float64";
      const attrStr = match[2] ?? "";
      const innerContent = match[3] ?? "";

      const nameMatch = /\bname\s*=\s*"([^"]*)"/.exec(attrStr);
      const vrMatch = /\bvalueReference\s*=\s*"(\d+)"/.exec(attrStr);
      if (!nameMatch?.[1] || !vrMatch?.[1]) continue;

      const causalityMatch = /\bcausality\s*=\s*"([^"]*)"/.exec(attrStr);
      const variabilityMatch = /\bvariability\s*=\s*"([^"]*)"/.exec(attrStr);
      const descMatch = /\bdescription\s*=\s*"([^"]*)"/.exec(attrStr);
      const startAttrMatch = /\bstart\s*=\s*"([^"]*)"/.exec(attrStr);
      const startChildMatch = /<Start\s+[^>]*?\bvalue\s*=\s*"([^"]*)"/i.exec(innerContent);
      const unitMatch = /\bunit\s*=\s*"([^"]*)"/.exec(attrStr);
      const minMatch = /\bmin\s*=\s*"([^"]*)"/.exec(attrStr);
      const maxMatch = /\bmax\s*=\s*"([^"]*)"/.exec(attrStr);

      const defaultVariability = rawType === "Float64" || rawType === "Float32" ? "continuous" : "discrete";

      variables.push({
        name: nameMatch[1],
        valueReference: parseInt(vrMatch[1], 10),
        causality: causalityMatch?.[1] ?? "local",
        variability: variabilityMatch?.[1] ?? defaultVariability,
        description: descMatch?.[1],
        type: rawType,
        start: startAttrMatch?.[1] ?? startChildMatch?.[1],
        unit: unitMatch?.[1],
        min: minMatch?.[1],
        max: maxMatch?.[1],
      });
    }
  }

  return variables;
}

/**
 * Detect available platforms from a ZIP file listing.
 * FMU binaries are at: binaries/{platform}/modelIdentifier.{dll|so|dylib}
 */
function detectPlatforms(fileList: string[]): string[] {
  const platforms = new Set<string>();
  for (const f of fileList) {
    const match = /^binaries\/([^/]+)\//.exec(f);
    if (match && match[1]) {
      platforms.add(match[1]);
    }
  }
  return Array.from(platforms).sort();
}

/**
 * Check if the FMU contains WASM binaries for in-browser simulation.
 */
function hasWasmBinary(fileList: string[]): boolean {
  return fileList.some(
    (f) =>
      f.endsWith(".wasm") ||
      f.includes("binaries/wasm") ||
      f.includes("resources/model.js") ||
      f.includes("resources/model.wasm"),
  );
}

interface ZipCentralEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class FmuArtifactHandler implements ArtifactHandler {
  readonly type = "fmu";
  readonly displayName = "Functional Mock-up Unit (FMU)";
  readonly extensions = [".fmu"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    try {
      // FMU is a ZIP file — extract modelDescription.xml
      const modelDescXml = this.extractFileFromZip(fileBuffer, "modelDescription.xml");
      if (!modelDescXml) {
        return null; // Not a valid FMU
      }

      const xml = modelDescXml.toString("utf-8");
      const fileList = this.listZipEntries(fileBuffer);

      const fmiVersion = extractXmlAttr(xml, "fmiModelDescription", "fmiVersion") ?? "2.0";
      const modelName = extractXmlAttr(xml, "fmiModelDescription", "modelName") ?? filePath;
      const guid =
        extractXmlAttr(xml, "fmiModelDescription", "guid") ??
        extractXmlAttr(xml, "fmiModelDescription", "instantiationToken") ??
        "";
      const modelDescription = extractXmlAttr(xml, "fmiModelDescription", "description");
      const generationTool = extractXmlAttr(xml, "fmiModelDescription", "generationTool");
      const generationDateAndTime = extractXmlAttr(xml, "fmiModelDescription", "generationDateAndTime");
      const numberOfEventIndicatorsStr = extractXmlAttr(xml, "fmiModelDescription", "numberOfEventIndicators");

      const variables = extractScalarVariables(xml);
      const platforms = detectPlatforms(fileList);
      const wasm = hasWasmBinary(fileList);

      const details: FmuDetails = {
        fmiVersion,
        modelName,
        modelDescription,
        modelDescriptionXml: xml.length <= 65536 ? xml : xml.slice(0, 65536),
        generationTool,
        generationDateAndTime,
        guid,
        platforms,
        hasWasm: wasm,
        variables,
        inputs: variables.filter((v) => v.causality === "input"),
        outputs: variables.filter((v) => v.causality === "output"),
        parameters: variables.filter((v) => v.causality === "parameter"),
        numberOfEventIndicators: numberOfEventIndicatorsStr ? parseInt(numberOfEventIndicatorsStr, 10) : undefined,
      };

      return {
        type: "fmu",
        path: filePath,
        description: modelDescription ?? `FMI ${fmiVersion} model: ${modelName}`,
        mimeType: "application/x-fmu",
        size: fileBuffer.length,
        details: details as unknown as Record<string, unknown>,
      };
    } catch (err) {
      console.error(`[FmuArtifactHandler] Failed to extract metadata from ${filePath}:`, err);
      return null;
    }
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!artifact["path"]) {
      errors.push("FMU artifact must have a 'path' field");
    } else {
      const p = artifact["path"] as string;
      if (!p.endsWith(".fmu")) {
        errors.push(`FMU artifact path must end with .fmu, got: "${p}"`);
      }
    }

    if (artifact["fmiVersion"]) {
      const v = artifact["fmiVersion"] as string;
      if (!["1.0", "2.0", "3.0"].includes(v)) {
        errors.push(`Invalid FMI version: "${v}" (expected 1.0, 2.0, or 3.0)`);
      }
    }

    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    const details = metadata.details as unknown as FmuDetails;

    return {
      viewer: "fmu-simulator",
      label: details.modelName || "FMU Simulation",
      icon: "play-circle",
      config: {
        fmiVersion: details.fmiVersion,
        modelName: details.modelName,
        guid: details.guid,
        generationTool: details.generationTool,
        generationDateAndTime: details.generationDateAndTime,
        description: details.modelDescription,
        modelDescription: details.modelDescriptionXml ?? details.modelDescription,
        hasWasm: details.hasWasm,
        variables: details.variables,
        inputs: details.inputs,
        outputs: details.outputs,
        parameters: details.parameters,
        platforms: details.platforms,
        numberOfEventIndicators: details.numberOfEventIndicators,
      },
    };
  }

  /**
   * Parse the ZIP Central Directory (EOCD -> Central Directory File Headers) so archives using
   * streaming data descriptors (general purpose bit 3, where local header sizes are 0) are read accurately.
   */
  private parseCentralDirectory(zipBuffer: Buffer): ZipCentralEntry[] | null {
    if (zipBuffer.length < 22) return null;
    const minSearchOffset = Math.max(0, zipBuffer.length - 65557);
    let eocdOffset = -1;
    for (let i = zipBuffer.length - 22; i >= minSearchOffset; i--) {
      if (
        zipBuffer[i] === 0x50 &&
        zipBuffer[i + 1] === 0x4b &&
        zipBuffer[i + 2] === 0x05 &&
        zipBuffer[i + 3] === 0x06
      ) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return null;

    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
    const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
    const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
    if (cdOffset + cdSize > zipBuffer.length) return null;

    const entries: ZipCentralEntry[] = [];
    let offset = cdOffset;
    const cdEnd = cdOffset + cdSize;
    while (offset + 46 <= cdEnd && entries.length < totalEntries) {
      if (
        zipBuffer[offset] !== 0x50 ||
        zipBuffer[offset + 1] !== 0x4b ||
        zipBuffer[offset + 2] !== 0x01 ||
        zipBuffer[offset + 3] !== 0x02
      ) {
        break;
      }
      const compressionMethod = zipBuffer.readUInt16LE(offset + 10);
      const compressedSize = zipBuffer.readUInt32LE(offset + 20);
      const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
      const nameLength = zipBuffer.readUInt16LE(offset + 28);
      const extraLength = zipBuffer.readUInt16LE(offset + 30);
      const commentLength = zipBuffer.readUInt16LE(offset + 32);
      const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);

      if (offset + 46 + nameLength > zipBuffer.length) break;
      const name = zipBuffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf-8");
      entries.push({
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset += 46 + nameLength + extraLength + commentLength;
    }

    return entries.length > 0 ? entries : null;
  }

  /**
   * Minimal ZIP file entry extractor (no external dependencies).
   * Finds a file by name in a ZIP archive and returns its contents.
   */
  private extractFileFromZip(zipBuffer: Buffer, targetName: string): Buffer | null {
    const MAX_EXTRACTED_ENTRY_BYTES = 10 * 1024 * 1024;
    const cdEntries = this.parseCentralDirectory(zipBuffer);
    if (cdEntries) {
      const entry = cdEntries.find((e) => e.name === targetName || e.name.replace(/^\.\//, "") === targetName);
      if (entry && entry.localHeaderOffset + 30 <= zipBuffer.length) {
        const lh = entry.localHeaderOffset;
        if (
          zipBuffer[lh] === 0x50 &&
          zipBuffer[lh + 1] === 0x4b &&
          zipBuffer[lh + 2] === 0x03 &&
          zipBuffer[lh + 3] === 0x04
        ) {
          const lhNameLen = zipBuffer.readUInt16LE(lh + 26);
          const lhExtraLen = zipBuffer.readUInt16LE(lh + 28);
          const dataStart = lh + 30 + lhNameLen + lhExtraLen;
          if (entry.compressionMethod === 0) {
            if (entry.uncompressedSize > MAX_EXTRACTED_ENTRY_BYTES) return null;
            return zipBuffer.subarray(dataStart, Math.min(zipBuffer.length, dataStart + entry.uncompressedSize));
          }
          if (entry.compressionMethod === 8) {
            try {
              return zlib.inflateRawSync(
                zipBuffer.subarray(dataStart, Math.min(zipBuffer.length, dataStart + entry.compressedSize)),
                { maxOutputLength: MAX_EXTRACTED_ENTRY_BYTES },
              );
            } catch {
              return null;
            }
          }
        }
      }
    }

    // Fallback: sequential local file header scan (PK\x03\x04)
    let offset = 0;
    while (offset < zipBuffer.length - 30) {
      if (
        zipBuffer[offset] !== 0x50 ||
        zipBuffer[offset + 1] !== 0x4b ||
        zipBuffer[offset + 2] !== 0x03 ||
        zipBuffer[offset + 3] !== 0x04
      ) {
        break;
      }

      const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
      const nameLength = zipBuffer.readUInt16LE(offset + 26);
      const extraLength = zipBuffer.readUInt16LE(offset + 28);

      const name = zipBuffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf-8");
      const dataStart = offset + 30 + nameLength + extraLength;

      if (name === targetName || name.replace(/^\.\//, "") === targetName) {
        if (compressionMethod === 0) {
          if (uncompressedSize > MAX_EXTRACTED_ENTRY_BYTES) return null;
          return zipBuffer.subarray(dataStart, Math.min(zipBuffer.length, dataStart + uncompressedSize));
        }
        if (compressionMethod === 8) {
          try {
            return zlib.inflateRawSync(zipBuffer.subarray(dataStart, dataStart + compressedSize), {
              maxOutputLength: MAX_EXTRACTED_ENTRY_BYTES,
            });
          } catch {
            return null;
          }
        }
        return null;
      }

      if (compressedSize === 0 && uncompressedSize > 0 && compressionMethod === 0) {
        offset = dataStart + uncompressedSize;
      } else if (compressedSize > 0) {
        offset = dataStart + compressedSize;
      } else {
        break;
      }
    }
    return null;
  }

  /**
   * List all file entries in a ZIP archive (minimal implementation).
   */
  private listZipEntries(zipBuffer: Buffer): string[] {
    const cdEntries = this.parseCentralDirectory(zipBuffer);
    if (cdEntries) {
      return cdEntries.map((e) => e.name);
    }

    const entries: string[] = [];
    let offset = 0;

    while (offset < zipBuffer.length - 30) {
      if (
        zipBuffer[offset] !== 0x50 ||
        zipBuffer[offset + 1] !== 0x4b ||
        zipBuffer[offset + 2] !== 0x03 ||
        zipBuffer[offset + 3] !== 0x04
      ) {
        break;
      }

      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const nameLength = zipBuffer.readUInt16LE(offset + 26);
      const extraLength = zipBuffer.readUInt16LE(offset + 28);

      const name = zipBuffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf-8");
      entries.push(name);

      if (compressedSize === 0 && offset + 30 + nameLength + extraLength >= offset) {
        offset = offset + 30 + nameLength + extraLength;
        // Advance to next PK\x03\x04 if data descriptor was used
        const nextSig = zipBuffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset);
        if (nextSig === -1) break;
        offset = nextSig;
      } else {
        offset = offset + 30 + nameLength + extraLength + compressedSize;
      }
    }

    return entries;
  }
}
