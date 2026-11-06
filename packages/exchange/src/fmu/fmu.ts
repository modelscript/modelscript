// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU (Functional Mock-up Interface) utility support.
 *
 * Provides lightweight XML parsing and ZIP extraction for FMI 2.0/3.0 modelDescription.xml.
 */

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { inflateRaw } from "pako";

// ── FMU model description types ──

export interface FmuScalarVariable {
  name: string;
  causality: "input" | "output" | "local" | "parameter" | "calculatedParameter" | "independent";
  variability: "continuous" | "discrete" | "fixed" | "tunable" | "constant";
  description: string;
  type: "Real" | "Integer" | "Boolean" | "String" | "Enumeration";
  start?: number | boolean | string | undefined;
}

// ── XML parsing ──

function localXmlName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

function matchXmlTag(element: XmlElement, expected: string): boolean {
  return localXmlName(element.name).toUpperCase() === expected.toUpperCase();
}

function findXmlDescendants(element: XmlElement, predicate: (e: XmlElement) => boolean): XmlElement[] {
  const result: XmlElement[] = [];
  function walk(node: XmlElement) {
    for (const child of node.children) {
      if (predicate(child)) result.push(child);
      walk(child);
    }
  }
  walk(element);
  return result;
}

/**
 * Parse scalar variables from an FMI 2.0 / 3.0 `modelDescription.xml` string.
 * Uses typed CST traversal via parseXmlSync — zero regex matching.
 */
export function parseFmuModelDescription(xml: string): {
  modelName: string;
  description: string;
  variables: FmuScalarVariable[];
} {
  const doc = parseXmlSync(xml);
  const root = doc.root;

  const getAttr = (el: XmlElement | null | undefined, name: string): string | undefined => {
    if (!el) return undefined;
    const target = name.toUpperCase();
    return el.attributes.find((a) => localXmlName(a.name).toUpperCase() === target)?.value;
  };

  const modelName = getAttr(root, "modelName") ?? "FMU";
  const description = getAttr(root, "description") ?? "";

  const variables: FmuScalarVariable[] = [];
  if (root) {
    const svElements = findXmlDescendants(root, (e) => matchXmlTag(e, "ScalarVariable"));
    for (const sv of svElements) {
      const varName = getAttr(sv, "name");
      if (!varName) continue;

      const causality = (getAttr(sv, "causality") ?? "local") as FmuScalarVariable["causality"];
      const variability = (getAttr(sv, "variability") ?? "continuous") as FmuScalarVariable["variability"];
      const varDesc = getAttr(sv, "description") ?? "";

      let type: FmuScalarVariable["type"] = "Real";
      let start: number | boolean | string | undefined = undefined;

      const typeChild = sv.children.find((c) => {
        const u = localXmlName(c.name).toUpperCase();
        return u === "REAL" || u === "INTEGER" || u === "BOOLEAN" || u === "STRING" || u === "ENUMERATION";
      });

      if (typeChild) {
        const u = localXmlName(typeChild.name).toUpperCase();
        if (u === "INTEGER") type = "Integer";
        else if (u === "BOOLEAN") type = "Boolean";
        else if (u === "STRING") type = "String";
        else if (u === "ENUMERATION") type = "Enumeration";
        else type = "Real";

        const startAttr = getAttr(typeChild, "start");
        if (startAttr !== undefined) {
          if (type === "Real" || type === "Integer") {
            const parsed = parseFloat(startAttr);
            if (Number.isFinite(parsed)) start = parsed;
          } else if (type === "Boolean") {
            start = startAttr.toLowerCase() === "true" || startAttr === "1";
          } else {
            start = startAttr;
          }
        }
      }

      variables.push({
        name: varName,
        causality,
        variability,
        description: varDesc,
        type,
        ...(start !== undefined ? { start } : {}),
      });
    }
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
