// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Container & Archive Toolkit for ModelScript.
 *
 * Provides platform-agnostic (Browser, Worker, Node.js, WASM) zero-copy
 * extraction, compression, XML parsing, and manifest projection utilities
 * for containerized formats (.ssp, .fmu, .molib, .jar, etc.).
 */

import type {
  ContainerDeclaration,
  ContainerEntryMeta,
  ContainerExtractionResult,
  ContainerToolkit,
} from "@modelscript/dsl/dsl/language.js";
import { deflateRaw, inflateRaw } from "pako";

// ── In-Memory ZIP Reader ─────────────────────────────────────────────

/**
 * Parse central directory entries from a raw ZIP byte buffer.
 */
export function readZipEntries(zipData: Uint8Array): ContainerEntryMeta[] {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const entries: ContainerEntryMeta[] = [];

  // 1. Locate End of Central Directory (EOCD) signature (0x06054b50)
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return entries;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;
  const decoder = new TextDecoder("utf-8");

  let pos = cdOffset;
  while (pos < cdEnd && pos + 46 <= zipData.length) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const nameBytes = zipData.subarray(pos + 46, pos + 46 + fileNameLength);
    const name = decoder.decode(nameBytes);
    const isDirectory = name.endsWith("/") || (zipData[pos + 38] & 0x10) !== 0;

    entries.push({
      name,
      size: uncompressedSize,
      compressedSize,
      isDirectory,
      compressionMethod,
      offset: localHeaderOffset,
    });

    pos += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Extract a single entry's binary content from a ZIP byte buffer.
 */
export function readZipEntry(zipData: Uint8Array, targetPath: string): Uint8Array | null {
  const normalizedTarget = targetPath.replace(/^[./\\]+/, "");
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);

  // Find in central directory
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
  const decoder = new TextDecoder("utf-8");

  let pos = cdOffset;
  while (pos < cdEnd && pos + 46 <= zipData.length) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const nameBytes = zipData.subarray(pos + 46, pos + 46 + fileNameLength);
    const name = decoder.decode(nameBytes).replace(/^[./\\]+/, "");

    if (name === normalizedTarget) {
      // Read local header to get payload start
      if (localHeaderOffset + 30 > zipData.length) return null;
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;

      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;

      if (dataEnd > zipData.length) return null;
      const compressedData = zipData.subarray(dataStart, dataEnd);

      if (compressionMethod === 0) {
        return compressedData;
      } else if (compressionMethod === 8) {
        try {
          return inflateRaw(compressedData);
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

/**
 * Extract a single entry's text content from a ZIP byte buffer.
 */
export function readZipTextEntry(zipData: Uint8Array, targetPath: string, encoding = "utf-8"): string | null {
  const binary = readZipEntry(zipData, targetPath);
  if (!binary) return null;
  return new TextDecoder(encoding).decode(binary);
}

// ── In-Memory ZIP Writer ─────────────────────────────────────────────

/**
 * Build a standard ZIP archive byte buffer from a map of relative paths to contents.
 */
export function createZipArchive(
  files: Map<string, Uint8Array | string> | Record<string, Uint8Array | string>,
): Uint8Array {
  const encoder = new TextEncoder();
  const fileEntries: { name: string; uncompressed: Uint8Array; compressed: Uint8Array; crc: number }[] = [];

  const entriesMap = files instanceof Map ? files.entries() : Object.entries(files);

  for (const [name, content] of entriesMap) {
    const uncompressed = typeof content === "string" ? encoder.encode(content) : content;
    const compressed = deflateRaw(uncompressed);
    const crc = computeCrc32(uncompressed);
    fileEntries.push({ name, uncompressed, compressed, crc });
  }

  // Calculate sizes
  let totalLocalSize = 0;
  let totalCdSize = 0;

  for (const entry of fileEntries) {
    const nameBytes = encoder.encode(entry.name);
    totalLocalSize += 30 + nameBytes.length + entry.compressed.length;
    totalCdSize += 46 + nameBytes.length;
  }

  const totalSize = totalLocalSize + totalCdSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let localOffset = 0;
  let cdOffset = totalLocalSize;
  const localOffsets: number[] = [];

  // Write local file headers and payloads
  for (const entry of fileEntries) {
    localOffsets.push(localOffset);
    const nameBytes = encoder.encode(entry.name);

    view.setUint32(localOffset, 0x04034b50, true); // Local header signature
    view.setUint16(localOffset + 4, 20, true); // Version needed (2.0)
    view.setUint16(localOffset + 6, 0, true); // General purpose bit flag
    view.setUint16(localOffset + 8, 8, true); // Compression method (Deflate)
    view.setUint16(localOffset + 10, 0, true); // Last mod file time
    view.setUint16(localOffset + 12, 0, true); // Last mod file date
    view.setUint32(localOffset + 14, entry.crc, true); // CRC-32
    view.setUint32(localOffset + 18, entry.compressed.length, true); // Compressed size
    view.setUint32(localOffset + 22, entry.uncompressed.length, true); // Uncompressed size
    view.setUint16(localOffset + 26, nameBytes.length, true); // File name length
    view.setUint16(localOffset + 28, 0, true); // Extra field length

    out.set(nameBytes, localOffset + 30);
    out.set(entry.compressed, localOffset + 30 + nameBytes.length);

    localOffset += 30 + nameBytes.length + entry.compressed.length;
  }

  // Write central directory records
  for (let i = 0; i < fileEntries.length; i++) {
    const entry = fileEntries[i];
    const nameBytes = encoder.encode(entry.name);
    const entryLocalOffset = localOffsets[i];

    view.setUint32(cdOffset, 0x02014b50, true); // Central directory signature
    view.setUint16(cdOffset + 4, 20, true); // Version made by
    view.setUint16(cdOffset + 6, 20, true); // Version needed
    view.setUint16(cdOffset + 8, 0, true); // Bit flag
    view.setUint16(cdOffset + 10, 8, true); // Compression method
    view.setUint16(cdOffset + 12, 0, true); // Mod time
    view.setUint16(cdOffset + 14, 0, true); // Mod date
    view.setUint32(cdOffset + 16, entry.crc, true); // CRC-32
    view.setUint32(cdOffset + 20, entry.compressed.length, true); // Compressed size
    view.setUint32(cdOffset + 24, entry.uncompressed.length, true); // Uncompressed size
    view.setUint16(cdOffset + 28, nameBytes.length, true); // Name length
    view.setUint16(cdOffset + 30, 0, true); // Extra field length
    view.setUint16(cdOffset + 32, 0, true); // Comment length
    view.setUint16(cdOffset + 34, 0, true); // Disk number
    view.setUint16(cdOffset + 36, 0, true); // Internal attributes
    view.setUint32(cdOffset + 38, 0, true); // External attributes
    view.setUint32(cdOffset + 42, entryLocalOffset, true); // Local header offset

    out.set(nameBytes, cdOffset + 46);
    cdOffset += 46 + nameBytes.length;
  }

  // Write End of Central Directory Record (EOCD)
  view.setUint32(cdOffset, 0x06054b50, true); // EOCD signature
  view.setUint16(cdOffset + 4, 0, true); // Disk number
  view.setUint16(cdOffset + 6, 0, true); // Start disk
  view.setUint16(cdOffset + 8, fileEntries.length, true); // Entries on this disk
  view.setUint16(cdOffset + 10, fileEntries.length, true); // Total entries
  view.setUint32(cdOffset + 12, totalCdSize, true); // Size of central directory
  view.setUint32(cdOffset + 16, totalLocalSize, true); // Offset of central directory
  view.setUint16(cdOffset + 20, 0, true); // Comment length

  return out;
}

// ── DOM-Free XML Helpers ─────────────────────────────────────────────

/** Extract attribute value from tag in XML string. */
export function extractXmlAttr(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, "i");
  const match = xml.match(regex);
  return match?.[1] ?? null;
}

/** Extract attribute value from raw attribute string. */
export function extractXmlAttrFromStr(attrStr: string, attrName: string): string | null {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, "i");
  const match = attrStr.match(regex);
  return match?.[1] ?? null;
}

/** Extract matching XML tags with attribute strings and bodies. */
export function extractXmlTags(xml: string, tag: string): { attrs: string; body: string }[] {
  const results: { attrs: string; body: string }[] = [];
  const regex = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>|<${tag}\\b([^>]*)\\/>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";
    results.push({ attrs, body });
  }
  return results;
}

/** Lightweight XML tag parser into a key-value structure. */
export function parseXmlSimple(xml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const rootMatch = xml.match(/<([a-zA-Z0-9_:-]+)\s*([^>]*)>/);
  if (!rootMatch) return result;

  const rootTag = rootMatch[1];
  const rootAttrs = rootMatch[2];
  result["@tag"] = rootTag;

  // Extract attributes
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(rootAttrs)) !== null) {
    result[attrMatch[1]] = attrMatch[2];
  }

  return result;
}

// ── Glob & Path Matcher ──────────────────────────────────────────────

/** Match file paths against simple glob or RegExp. */
export function matchPath(filePath: string, pattern: string | RegExp): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(filePath);
  }
  const normalizedPath = filePath.replace(/\\/g, "/");
  let regexStr = pattern.replace(/\\/g, "/");
  regexStr = regexStr.replace(/\./g, "\\.");
  regexStr = regexStr.replace(/\*\*/g, "§§GLOBSTAR§§");
  regexStr = regexStr.replace(/\*/g, "[^/]*");
  regexStr = regexStr.replace(/§§GLOBSTAR§§\//g, "(?:.*/)?");
  regexStr = regexStr.replace(/§§GLOBSTAR§§/g, ".*");
  return new RegExp(`^${regexStr}$`).test(normalizedPath);
}

// ── Standard CRC32 ───────────────────────────────────────────────────

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Default Container Toolkit ────────────────────────────────────────

/**
 * Standard implementation of the ContainerToolkit passed to extractors.
 */
export const defaultContainerToolkit: ContainerToolkit = {
  zip: {
    entries: readZipEntries,
    read: readZipEntry,
    readText: readZipTextEntry,
  },
  xml: {
    extractAttr: extractXmlAttr,
    extractAttrFromStr: extractXmlAttrFromStr,
    extractTags: extractXmlTags,
    parse: parseXmlSimple,
  },
  inflate: (compressed: Uint8Array) => inflateRaw(compressed),
  deflate: (data: Uint8Array) => deflateRaw(data),
  text: {
    decode: (bytes: Uint8Array, encoding = "utf-8") => new TextDecoder(encoding).decode(bytes),
    encode: (str: string) => new TextEncoder().encode(str),
  },
  glob: {
    match: matchPath,
  },
};

/**
 * Process a container archive byte buffer using a language's ContainerDeclaration.
 */
export async function extractContainerArchive(
  data: Uint8Array,
  declaration: ContainerDeclaration,
  toolkit: ContainerToolkit = defaultContainerToolkit,
): Promise<ContainerExtractionResult | null> {
  return await declaration.extract(data, toolkit);
}
