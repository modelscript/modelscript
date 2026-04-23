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

import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

/** Parsed scalar variable from modelDescription.xml. */
export interface FmuScalarVariable {
  name: string;
  valueReference: number;
  causality: string; // 'input' | 'output' | 'parameter' | 'local' | 'independent'
  variability: string; // 'constant' | 'fixed' | 'tunable' | 'discrete' | 'continuous'
  description?: string | undefined;
  type: string; // 'Real' | 'Integer' | 'Boolean' | 'String'
  start?: string | undefined;
  unit?: string | undefined;
}

/** FMU-specific metadata stored in artifact details. */
export interface FmuDetails {
  fmiVersion: string;
  modelName: string;
  modelDescription?: string | undefined;
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
 * Extract scalar variables from modelDescription.xml.
 */
function extractScalarVariables(xml: string): FmuScalarVariable[] {
  const variables: FmuScalarVariable[] = [];

  // Match each ScalarVariable element
  const svRegex = /<ScalarVariable\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/ScalarVariable>)/gi;
  let match: RegExpExecArray | null;

  while ((match = svRegex.exec(xml)) !== null) {
    const attrStr = match[1] ?? "";
    const innerContent = match[2] ?? "";

    // Extract attributes
    const nameMatch = /name\s*=\s*"([^"]*)"/.exec(attrStr);
    const vrMatch = /valueReference\s*=\s*"(\d+)"/.exec(attrStr);
    const causalityMatch = /causality\s*=\s*"([^"]*)"/.exec(attrStr);
    const variabilityMatch = /variability\s*=\s*"([^"]*)"/.exec(attrStr);
    const descMatch = /description\s*=\s*"([^"]*)"/.exec(attrStr);

    if (!nameMatch?.[1] || !vrMatch?.[1]) continue;

    // Determine type from inner element (Real, Integer, Boolean, String)
    let type = "Real";
    let start: string | undefined;
    let unit: string | undefined;

    const typeMatch = /<(Real|Integer|Boolean|String|Float32|Float64|Int32|Int64)\s*([^>]*?)\/?>/.exec(
      innerContent || attrStr,
    );
    if (typeMatch) {
      type = typeMatch[1] ?? "Real";
      const typeAttrs = typeMatch[2] ?? "";
      const startMatch = /start\s*=\s*"([^"]*)"/.exec(typeAttrs);
      if (startMatch?.[1]) start = startMatch[1];
      const unitMatch = /unit\s*=\s*"([^"]*)"/.exec(typeAttrs);
      if (unitMatch?.[1]) unit = unitMatch[1];
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
    });
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

export class FmuArtifactHandler implements ArtifactHandler {
  readonly type = "fmu";
  readonly displayName = "Functional Mock-up Unit (FMU)";
  readonly extensions = [".fmu"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    try {
      // FMU is a ZIP file — do a minimal scan for modelDescription.xml
      const modelDescXml = this.extractFileFromZip(fileBuffer, "modelDescription.xml");
      if (!modelDescXml) {
        return null; // Not a valid FMU
      }

      const xml = modelDescXml.toString("utf-8");
      const fileList = this.listZipEntries(fileBuffer);

      const fmiVersion = extractXmlAttr(xml, "fmiModelDescription", "fmiVersion") ?? "2.0";
      const modelName = extractXmlAttr(xml, "fmiModelDescription", "modelName") ?? filePath;
      const guid = extractXmlAttr(xml, "fmiModelDescription", "guid") ?? "";
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

    if (!artifact.path) {
      errors.push("FMU artifact must have a 'path' field");
    } else {
      const p = artifact.path as string;
      if (!p.endsWith(".fmu")) {
        errors.push(`FMU artifact path must end with .fmu, got: "${p}"`);
      }
    }

    if (artifact.fmiVersion) {
      const v = artifact.fmiVersion as string;
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
        hasWasm: details.hasWasm,
        inputs: details.inputs,
        outputs: details.outputs,
        parameters: details.parameters,
        platforms: details.platforms,
      },
    };
  }

  /**
   * Minimal ZIP file entry extractor (no external dependencies).
   * Finds a file by name in a ZIP archive and returns its contents.
   */
  private extractFileFromZip(zipBuffer: Buffer, targetName: string): Buffer | null {
    // ZIP local file header signature: PK\x03\x04
    let offset = 0;
    while (offset < zipBuffer.length - 30) {
      if (
        zipBuffer[offset] !== 0x50 ||
        zipBuffer[offset + 1] !== 0x4b ||
        zipBuffer[offset + 2] !== 0x03 ||
        zipBuffer[offset + 3] !== 0x04
      ) {
        // Try central directory or end — stop
        break;
      }

      const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
      const nameLength = zipBuffer.readUInt16LE(offset + 26);
      const extraLength = zipBuffer.readUInt16LE(offset + 28);

      const name = zipBuffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf-8");
      const dataStart = offset + 30 + nameLength + extraLength;

      if (name === targetName) {
        if (compressionMethod === 0) {
          // Stored (uncompressed)
          return zipBuffer.subarray(dataStart, dataStart + uncompressedSize);
        }
        // For compressed entries, we'd need zlib — return null for now
        return null;
      }

      offset = dataStart + compressedSize;
    }
    return null;
  }

  /**
   * List all file entries in a ZIP archive (minimal implementation).
   */
  private listZipEntries(zipBuffer: Buffer): string[] {
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

      offset = offset + 30 + nameLength + extraLength + compressedSize;
    }

    return entries;
  }
}
