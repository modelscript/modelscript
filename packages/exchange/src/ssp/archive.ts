// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SSP (System Structure and Parameterization) archive support for @modelscript/core.
 *
 * Provides utilities for parsing SSP archives to extract system boundary
 * information (inputs, outputs, parameters) that can be used to synthetically
 * generate Modelica variable declarations when an SSP system is instantiated
 * as a block in a Modelica model.
 *
 * An SSP system appears in Modelica source as:
 *   model MySystem
 *     annotation(external="SSP", file="system.ssp");
 *   end MySystem;
 *
 * The SspArchive class extracts the boundary connectors from the top-level
 * system and exposes them as typed variable descriptors for flattener use.
 */

import { inflateRaw } from "pako";

/** Connector descriptor extracted from an SSP system boundary. */
export interface SspBoundaryVariable {
  /** Variable name (from the connector name). */
  name: string;
  /** FMI-style causality. */
  causality: "input" | "output" | "parameter";
  /** Data type. */
  type: "Real" | "Integer" | "Boolean" | "String";
  /** Start value (if defined in parameter bindings). */
  start?: number | string | boolean | undefined;
  /** Unit string (if defined). */
  unit?: string | undefined;
}

/** Parsed SSP archive metadata for compiler use. */
export interface SspArchiveMetadata {
  /** System name from SystemStructure.ssd. */
  systemName: string;
  /** System description. */
  description?: string | undefined;
  /** SSP version. */
  version: string;
  /** Boundary variables (inputs, outputs, parameters). */
  variables: SspBoundaryVariable[];
  /** Component names within the system. */
  componentNames: string[];
  /** Default experiment start time. */
  startTime?: number | undefined;
  /** Default experiment stop time. */
  stopTime?: number | undefined;
}

/**
 * Parse an SSP archive to extract system boundary metadata.
 *
 * This is a lightweight parser for compiler use — it extracts only the
 * top-level system boundary (connectors at the system level, not within
 * individual components).
 *
 * @param data Raw SSP archive bytes (Uint8Array, works in both browser and Node)
 * @returns Parsed SSP metadata, or null if the archive is invalid
 */
export function parseSspArchive(data: Uint8Array): SspArchiveMetadata | null {
  const ssdXml = extractFileFromZip(data, "SystemStructure.ssd");
  if (!ssdXml) return null;

  // Parse system name and version
  const version = extractAttr(ssdXml, "ssd:SystemStructureDescription", "version") ?? "1.0";

  // Extract the <ssd:System> element
  const systemBlock = extractTagBlock(ssdXml, "ssd:System");
  if (!systemBlock) return null;

  const systemAttrs = systemBlock.attrs;
  const systemBody = systemBlock.body;
  const systemName = extractAttrStr(systemAttrs, "name") ?? "System";
  const description = extractAttrStr(systemAttrs, "description");

  // Extract system-level connectors (boundary variables)
  const variables = extractSystemConnectors(systemBody);

  // Extract component names
  const componentNames: string[] = [];
  const compElements = extractTagElements(systemBody, "ssd:Component");
  for (const comp of compElements) {
    const name = extractAttrStr(comp.attrs, "name");
    if (name) componentNames.push(name);
  }

  // Default experiment
  let startTime: number | undefined;
  let stopTime: number | undefined;
  const expBlock = extractTagBlock(ssdXml, "ssd:DefaultExperiment") ?? extractTagBlock(ssdXml, "DefaultExperiment");
  if (expBlock) {
    const startStr = extractAttrStr(expBlock.attrs, "startTime");
    const stopStr = extractAttrStr(expBlock.attrs, "stopTime");
    if (startStr) startTime = parseFloat(startStr);
    if (stopStr) stopTime = parseFloat(stopStr);
  }

  return {
    systemName,
    description,
    version,
    variables,
    componentNames,
    startTime,
    stopTime,
  };
}

/**
 * Generate a Modelica-compatible model description XML fragment
 * for an SSP system (for use as an FMI-like wrapper).
 */
export function generateSspModelDescriptionXml(metadata: SspArchiveMetadata): string {
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<fmiModelDescription`);
  lines.push(`  fmiVersion="2.0"`);
  lines.push(`  modelName="${escapeXml(metadata.systemName)}"`);
  lines.push(`  guid="ssp-${escapeXml(metadata.systemName)}"`);
  lines.push(`  generationTool="ModelScript SSP"`);
  if (metadata.description) {
    lines.push(`  description="${escapeXml(metadata.description)}"`);
  }
  lines.push(`>`);
  lines.push(`  <CoSimulation modelIdentifier="${escapeXml(metadata.systemName)}" />`);

  if (metadata.startTime !== undefined || metadata.stopTime !== undefined) {
    const parts = [`  <DefaultExperiment`];
    if (metadata.startTime !== undefined) parts.push(` startTime="${metadata.startTime}"`);
    if (metadata.stopTime !== undefined) parts.push(` stopTime="${metadata.stopTime}"`);
    parts.push(` />`);
    lines.push(parts.join(""));
  }

  lines.push(`  <ModelVariables>`);
  let vr = 0;
  for (const v of metadata.variables) {
    lines.push(
      `    <ScalarVariable name="${escapeXml(v.name)}" valueReference="${vr}" causality="${v.causality}" variability="continuous">`,
    );
    const typeTag =
      v.type === "Real" ? "Real" : v.type === "Integer" ? "Integer" : v.type === "Boolean" ? "Boolean" : "String";
    const attrs: string[] = [];
    if (v.start !== undefined) attrs.push(`start="${v.start}"`);
    if (v.unit) attrs.push(`unit="${escapeXml(v.unit)}"`);
    lines.push(`      <${typeTag}${attrs.length > 0 ? " " + attrs.join(" ") : ""} />`);
    lines.push(`    </ScalarVariable>`);
    vr++;
  }
  lines.push(`  </ModelVariables>`);

  lines.push(`  <ModelStructure>`);
  const outputIndices = metadata.variables.map((v, i) => (v.causality === "output" ? i + 1 : -1)).filter((i) => i >= 0);
  if (outputIndices.length > 0) {
    lines.push(`    <Outputs>`);
    for (const idx of outputIndices) {
      lines.push(`      <Unknown index="${idx}" />`);
    }
    lines.push(`    </Outputs>`);
  }
  lines.push(`  </ModelStructure>`);

  lines.push(`</fmiModelDescription>`);
  return lines.join("\n") + "\n";
}

// ── Internal helpers ────────────────────────────────────────────────

function extractSystemConnectors(systemBody: string): SspBoundaryVariable[] {
  const variables: SspBoundaryVariable[] = [];

  // System-level connectors are directly under <ssd:System>, not within <ssd:Elements>
  // Look for <ssd:Connectors> block that is NOT inside a <ssd:Component>
  // Simple approach: find connectors before <ssd:Elements>
  const elementsIdx = systemBody.indexOf("<ssd:Elements>");
  const connectorsBlockStr = elementsIdx >= 0 ? systemBody.substring(0, elementsIdx) : systemBody;

  const connectorsBlock = extractTagBlock(connectorsBlockStr, "ssd:Connectors");
  if (!connectorsBlock) return variables;

  const connElements = extractTagElements(connectorsBlock.body, "ssd:Connector");
  for (const { attrs, body } of connElements) {
    const name = extractAttrStr(attrs, "name") ?? "";
    const kind = extractAttrStr(attrs, "kind") ?? "input";

    let type: SspBoundaryVariable["type"] = "Real";
    let unit: string | undefined;

    const realBlock = extractTagBlock(body, "ssc:Real");
    if (realBlock) {
      type = "Real";
      unit = extractAttrStr(realBlock.attrs, "unit");
    } else if (body.includes("<ssc:Integer")) {
      type = "Integer";
    } else if (body.includes("<ssc:Boolean")) {
      type = "Boolean";
    } else if (body.includes("<ssc:String")) {
      type = "String";
    }

    const causality = kind === "output" ? "output" : kind === "parameter" ? "parameter" : "input";
    const variable: SspBoundaryVariable = { name, causality, type };
    if (unit) variable.unit = unit;
    variables.push(variable);
  }

  return variables;
}

/** Extract a text file from a ZIP archive (browser/Node compatible via Uint8Array). */
function extractFileFromZip(zipData: Uint8Array, targetName: string): string | null {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);

  // Find EOCD
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;

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
      const localPos = localHeaderOffset;
      if (view.getUint32(localPos, true) !== 0x04034b50) return null;

      const localFileNameLen = view.getUint16(localPos + 26, true);
      const localExtraLen = view.getUint16(localPos + 28, true);
      const dataStart = localPos + 30 + localFileNameLen + localExtraLen;
      const compressed = zipData.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return new TextDecoder().decode(compressed);
      } else if (compressionMethod === 8) {
        try {
          const inflated = inflateRaw(compressed);
          return new TextDecoder().decode(inflated);
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

function extractTagBlock(xml: string, tag: string): { attrs: string; body: string } | null {
  const openTag = `<${tag}`;
  const startIdx = xml.indexOf(openTag);
  if (startIdx === -1) return null;
  const charAfter = xml[startIdx + openTag.length];
  if (
    charAfter !== undefined &&
    charAfter !== " " &&
    charAfter !== "\t" &&
    charAfter !== "\r" &&
    charAfter !== "\n" &&
    charAfter !== ">" &&
    charAfter !== "/"
  ) {
    return null;
  }
  const tagEnd = xml.indexOf(">", startIdx + openTag.length);
  if (tagEnd === -1) return null;
  const isSelfClosing = xml[tagEnd - 1] === "/";
  const rawAttrs = xml.slice(startIdx + openTag.length, tagEnd);
  const attrs = isSelfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs.trim();
  if (isSelfClosing) {
    return { attrs, body: "" };
  }
  const closeTag = `</${tag}>`;
  const endIdx = xml.indexOf(closeTag, tagEnd + 1);
  if (endIdx === -1) {
    return { attrs, body: "" };
  }
  const body = xml.slice(tagEnd + 1, endIdx);
  return { attrs, body };
}

function extractTagElements(xml: string, tag: string): { attrs: string; body: string }[] {
  const result: { attrs: string; body: string }[] = [];
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let pos = 0;
  while (pos < xml.length) {
    const startIdx = xml.indexOf(openTag, pos);
    if (startIdx === -1) break;
    const charAfter = xml[startIdx + openTag.length];
    if (
      charAfter !== undefined &&
      charAfter !== " " &&
      charAfter !== "\t" &&
      charAfter !== "\r" &&
      charAfter !== "\n" &&
      charAfter !== ">" &&
      charAfter !== "/"
    ) {
      pos = startIdx + openTag.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", startIdx + openTag.length);
    if (tagEnd === -1) break;
    const isSelfClosing = xml[tagEnd - 1] === "/";
    const rawAttrs = xml.slice(startIdx + openTag.length, tagEnd);
    const attrs = isSelfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs.trim();
    if (isSelfClosing) {
      result.push({ attrs, body: "" });
      pos = tagEnd + 1;
    } else {
      const endIdx = xml.indexOf(closeTag, tagEnd + 1);
      if (endIdx === -1) {
        result.push({ attrs, body: "" });
        pos = tagEnd + 1;
      } else {
        result.push({ attrs, body: xml.slice(tagEnd + 1, endIdx) });
        pos = endIdx + closeTag.length;
      }
    }
  }
  return result;
}

function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const block = extractTagBlock(xml, element);
  if (!block) return undefined;
  return extractAttrStr(block.attrs, attr);
}

function extractAttrStr(attrs: string, attr: string): string | undefined {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*"([^"]*)"`));
  if (match) return match[1];
  const singleMatch = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*'([^']*)'`));
  return singleMatch ? singleMatch[1] : undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
