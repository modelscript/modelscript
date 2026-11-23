// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — `.mdzip` Container Unpacker.
 *
 * Uses `@modelscript/runtime`'s `defaultContainerToolkit.zip` to unpack
 * MagicDraw / Cameo `.mdzip` archives, locate the primary UML/SysML XMI payload
 * (`com.nomagic.magicdraw.uml_model.model` / `.shared_model` / `*.mdxml` / `*.xmi`),
 * extract `PROJECT-*.xml` metadata, and detect encrypted or Teamwork Cloud stub archives.
 */

import { defaultContainerToolkit } from "@modelscript/runtime";
import type { MagicDrawArchiveMetadata, MagicDrawBinaryAttachment, MagicDrawBinaryKind } from "../types.js";

export interface ExtractedMdzipPayload {
  xmlText: string;
  sharedModelXml?: string | undefined;
  metadata: MagicDrawArchiveMetadata;
}

const ZIP_MAGIC_0 = 0x50; // 'P'
const ZIP_MAGIC_1 = 0x4b; // 'K'
const ZIP_MAGIC_2 = 0x03;
const ZIP_MAGIC_3 = 0x04;

export function isZipBuffer(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === ZIP_MAGIC_0 &&
    data[1] === ZIP_MAGIC_1 &&
    data[2] === ZIP_MAGIC_2 &&
    data[3] === ZIP_MAGIC_3
  );
}

/**
 * Checks ZIP local file header general-purpose bit flag bit 0 (encryption flag).
 */
function hasEncryptedZipEntry(data: Uint8Array): boolean {
  let offset = 0;
  while (offset + 30 <= data.length) {
    if (data[offset] === 0x50 && data[offset + 1] === 0x4b && data[offset + 2] === 0x03 && data[offset + 3] === 0x04) {
      const flags = (data[offset + 6] ?? 0) | ((data[offset + 7] ?? 0) << 8);
      if ((flags & 0x0001) !== 0) return true;
      const compSize =
        ((data[offset + 18] ?? 0) |
          ((data[offset + 19] ?? 0) << 8) |
          ((data[offset + 20] ?? 0) << 16) |
          ((data[offset + 21] ?? 0) << 24)) >>>
        0;
      const nameLen = (data[offset + 26] ?? 0) | ((data[offset + 27] ?? 0) << 8);
      const extraLen = (data[offset + 28] ?? 0) | ((data[offset + 29] ?? 0) << 8);
      const next = offset + 30 + nameLen + extraLen + compSize;
      if (next <= offset) break;
      offset = next;
    } else {
      break;
    }
  }
  return false;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function scoreModelEntry(entryName: string): number {
  const lower = entryName.toLowerCase();
  if (lower === "com.nomagic.magicdraw.uml_model.model") return 100;
  if (lower.endsWith("/com.nomagic.magicdraw.uml_model.model")) return 95;
  if (lower === "com.nomagic.magicdraw.uml_model.shared_model") return 90;
  if (lower.endsWith(".mdxml")) return 80;
  if (lower.endsWith(".xmi")) return 75;
  if (lower.includes("uml_model") && !lower.endsWith(".xml")) return 70;
  if (lower.endsWith(".xml") && !lower.startsWith("project-") && !lower.includes("persistence")) return 40;
  return 0;
}

function decodeEntryText(zip: typeof defaultContainerToolkit.zip, data: Uint8Array, entryName: string): string {
  const rawBytes = zip.read(data, entryName);
  if (!rawBytes || rawBytes.length === 0) return "";
  if (rawBytes.length >= 2 && rawBytes[0] === 0x1f && rawBytes[1] === 0x8b) {
    try {
      const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process;
      const zlib = proc?.getBuiltinModule?.("node:zlib") as
        { gunzipSync?: (buf: Uint8Array) => Uint8Array } | undefined;
      if (zlib?.gunzipSync) {
        return decodeUtf8(zlib.gunzipSync(rawBytes));
      }
    } catch {
      // Fall through to text decoding
    }
  }
  return decodeUtf8(rawBytes);
}

/**
 * Converts a base64 data URI (`data:...;base64,...`) or binary-latin1 ZIP string (`PK\x03\x04...`)
 * into a `Uint8Array` so LSP/VFS text channels can transparently pass `.mdzip` payloads.
 */
export function tryDecodeZipString(text: string): Uint8Array | null {
  if (!text || text.length < 4) return null;
  if (text.startsWith("data:") && text.includes(";base64,")) {
    const b64 = text.slice(text.indexOf(";base64,") + 8).trim();
    if (typeof Buffer !== "undefined") {
      const buf = Buffer.from(b64, "base64");
      return isZipBuffer(buf) ? new Uint8Array(buf) : null;
    }
    if (typeof atob === "function") {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i) & 0xff;
      }
      return isZipBuffer(bytes) ? bytes : null;
    }
  }
  if (
    text.charCodeAt(0) === ZIP_MAGIC_0 &&
    text.charCodeAt(1) === ZIP_MAGIC_1 &&
    text.charCodeAt(2) === ZIP_MAGIC_2 &&
    text.charCodeAt(3) === ZIP_MAGIC_3
  ) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    return bytes;
  }
  return null;
}

/**
 * Unpacks a `.mdzip` binary buffer into its primary XMI XML text and archive metadata.
 */
export function extractMdzipArchive(data: Uint8Array): ExtractedMdzipPayload {
  if (!isZipBuffer(data)) {
    // Might be UTF-8 XML passed as Uint8Array
    const asText = decodeUtf8(data).trimStart();
    if (asText.startsWith("<?xml") || asText.startsWith("<xmi:") || asText.startsWith("<uml:")) {
      return {
        xmlText: asText,
        metadata: {
          format: asText.includes("magicdraw") ? "mdxml" : "xmi",
          status: "ok",
          entries: [],
          mountedModules: [],
        },
      };
    }
    return {
      xmlText: "",
      metadata: {
        format: "mdzip",
        status: "corrupt",
        statusMessage: "Input is neither a valid ZIP (.mdzip) archive nor an XML (.mdxml/.xmi) document.",
        entries: [],
        mountedModules: [],
      },
    };
  }

  if (hasEncryptedZipEntry(data)) {
    return {
      xmlText: "",
      metadata: {
        format: "mdzip",
        status: "encrypted",
        statusMessage: "Password-protected / encrypted MagicDraw .mdzip archive cannot be unpacked.",
        entries: [],
        mountedModules: [],
      },
    };
  }

  const zip = defaultContainerToolkit.zip;
  let rawEntries: Array<{ name: string }>;
  try {
    rawEntries = zip.entries(data);
  } catch (err) {
    return {
      xmlText: "",
      metadata: {
        format: "mdzip",
        status: "corrupt",
        statusMessage: `Failed to read .mdzip directory: ${err instanceof Error ? err.message : String(err)}`,
        entries: [],
        mountedModules: [],
      },
    };
  }

  const entryNames = rawEntries.map((e) => e.name);
  let projectName: string | undefined;
  let magicDrawVersion: string | undefined;
  const mountedModules: string[] = [];
  let isTwcStub = false;

  // Inspect PROJECT-* / persistence metadata entries (real Cameo uses PROJECT-<uuid> without .xml)
  for (const name of entryNames) {
    const lower = name.toLowerCase();
    if (lower.startsWith("project-")) {
      const metaText = zip.readText(data, name);
      if (metaText) {
        const projTag = metaText.match(/<PROJECT\b[^>]*>/i)?.[0] ?? "";
        const nameMatch = projTag.match(/\bname="([^"]+)"/i);
        if (nameMatch?.[1]) projectName = nameMatch[1];
        const verMatch = projTag.match(/\bversion="([^"]+)"/i);
        if (verMatch?.[1]) magicDrawVersion = verMatch[1];
        if (/teamworkcloud|twc:\/\/|esi:\/\//i.test(metaText)) {
          isTwcStub = true;
        }
        const mountMatches = metaText.matchAll(/([^\s"']+\.mdzip)/gi);
        for (const m of mountMatches) {
          if (m[1] && !mountedModules.includes(m[1])) {
            mountedModules.push(m[1]);
          }
        }
      }
    }
  }

  // Pick the highest-scoring model entry
  let bestEntry: string | undefined;
  let bestScore = 0;
  for (const name of entryNames) {
    const s = scoreModelEntry(name);
    if (s > bestScore) {
      bestScore = s;
      bestEntry = name;
    }
  }

  if (!bestEntry) {
    return {
      xmlText: "",
      metadata: {
        format: "mdzip",
        status: isTwcStub ? "twc-stub" : "empty",
        statusMessage: isTwcStub
          ? "Archive is a Teamwork Cloud (TWC) remote proxy stub with no local UML/SysML model payload."
          : "No UML/SysML XMI model entry found inside .mdzip archive.",
        projectName,
        magicDrawVersion,
        entries: entryNames,
        mountedModules,
      },
    };
  }

  const xmlText = decodeEntryText(zip, data, bestEntry);
  if (!xmlText.trim()) {
    return {
      xmlText: "",
      metadata: {
        format: "mdzip",
        status: isTwcStub ? "twc-stub" : "empty",
        statusMessage: `Model entry '${bestEntry}' is empty.`,
        projectName,
        magicDrawVersion,
        primaryEntryPath: bestEntry,
        entries: entryNames,
        mountedModules,
      },
    };
  }

  const sharedEntry = entryNames.find(
    (n) => n !== bestEntry && n.toLowerCase().endsWith("com.nomagic.magicdraw.uml_model.shared_model"),
  );
  const sharedModelXml = sharedEntry ? decodeEntryText(zip, data, sharedEntry) : undefined;

  return {
    xmlText,
    sharedModelXml: sharedModelXml?.trim() ? sharedModelXml : undefined,
    metadata: {
      format: "mdzip",
      status: "ok",
      projectName,
      magicDrawVersion,
      primaryEntryPath: bestEntry,
      entries: entryNames,
      mountedModules,
    },
  };
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds an uncompressed (STORE) ZIP archive from named byte entries (browser + Node safe).
 */
export function createRawZipArchive(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // STORE
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const totalLen = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  for (const p of localParts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  for (const p of centralParts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  out.set(eocd, cursor);
  return out;
}

/**
 * Helper to create a valid `.mdzip` archive in memory (useful for tests and fixtures).
 */
export function createMdzipArchive(
  modelXml: string,
  options?: {
    projectName?: string;
    magicDrawVersion?: string;
    entryName?: string;
    extraEntries?: Record<string, string | Uint8Array>;
  },
): Uint8Array {
  const entryName = options?.entryName ?? "com.nomagic.magicdraw.uml_model.model";
  const projectName = options?.projectName ?? "ModelScriptProject";
  const magicDrawVersion = options?.magicDrawVersion ?? "2022x";
  const projectMeta = `<?xml version="1.0" encoding="UTF-8"?>\n<PROJECT name="${projectName}" version="${magicDrawVersion}"/>\n`;

  const files: Array<{ name: string; data: Uint8Array }> = [
    { name: "PROJECT-metadata.xml", data: new TextEncoder().encode(projectMeta) },
    { name: entryName, data: new TextEncoder().encode(modelXml) },
  ];

  if (options?.extraEntries) {
    for (const [name, content] of Object.entries(options.extraEntries)) {
      files.push({
        name,
        data: typeof content === "string" ? new TextEncoder().encode(content) : content,
      });
    }
  }

  return createRawZipArchive(files);
}

/**
 * Magic-byte & header MIME detector for embedded MagicDraw `BINARY-<uuid>` entries.
 */
export function detectBinaryMime(bytes: Uint8Array): {
  kind: MagicDrawBinaryKind;
  mimeType: string;
  extension: string;
} {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { kind: "image", mimeType: "image/png", extension: "png" };
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mimeType: "image/jpeg", extension: "jpg" };
  }
  // GIF: GIF87a / GIF89a
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { kind: "image", mimeType: "image/gif", extension: "gif" };
  }
  // BMP: BM
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { kind: "image", mimeType: "image/bmp", extension: "bmp" };
  }
  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { kind: "image", mimeType: "image/webp", extension: "webp" };
  }
  // PDF: %PDF-
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { kind: "pdf", mimeType: "application/pdf", extension: "pdf" };
  }
  // ZIP: PK\x03\x04
  if (isZipBuffer(bytes)) {
    return { kind: "archive", mimeType: "application/zip", extension: "zip" };
  }

  // Check UTF-8 XML / SVG / mdOwnedViews header
  const head = decodeUtf8(bytes.slice(0, Math.min(bytes.length, 256))).trimStart();
  if (head.includes("<mdOwnedViews")) {
    return { kind: "diagram-view", mimeType: "application/xml", extension: "xml" };
  }
  if (/<svg\b/i.test(head)) {
    return { kind: "svg", mimeType: "image/svg+xml", extension: "svg" };
  }
  if (head.startsWith("<?xml") || head.startsWith("<")) {
    return { kind: "xml", mimeType: "application/xml", extension: "xml" };
  }

  return { kind: "binary", mimeType: "application/octet-stream", extension: "bin" };
}

/**
 * Parses Cameo's `Binaries.properties` mapping each `BINARY-<uuid>` entry name to its owning resource.
 */
export function parseBinariesProperties(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const owner = line.slice(0, eq).trim();
    const rhs = line.slice(eq + 1).trim();
    for (const tok of rhs.split(",")) {
      const id = tok.trim();
      if (id) map.set(id, owner);
    }
  }
  return map;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Extracts metadata and lazy byte/data-URI readers for embedded `BINARY-<uuid>` attachments
 * inside a `.mdzip` archive (custom stereotype PNG/JPEG/SVG icons, attached PDFs, etc.).
 */
export function extractMdzipBinaries(
  data: Uint8Array,
  options?: { includeDiagramViews?: boolean | undefined },
): MagicDrawBinaryAttachment[] {
  if (!isZipBuffer(data)) return [];
  const zip = defaultContainerToolkit.zip;
  let entries: Array<{ name: string; uncompressedSize?: number }>;
  try {
    entries = zip.entries(data);
  } catch {
    return [];
  }

  const propText = zip.readText(data, "Binaries.properties");
  const ownerMap = propText ? parseBinariesProperties(propText) : new Map<string, string>();
  const includeDiagramViews = options?.includeDiagramViews ?? false;
  const attachments: MagicDrawBinaryAttachment[] = [];

  for (const entry of entries) {
    const isBinaryStream = entry.name.startsWith("BINARY-") || ownerMap.has(entry.name);
    if (!isBinaryStream) continue;

    const raw = zip.read(data, entry.name);
    if (!raw || raw.length === 0) continue;
    const detected = detectBinaryMime(raw);
    if (!includeDiagramViews && detected.kind === "diagram-view") continue;

    const entryName = entry.name;
    attachments.push({
      entryName,
      ownerResource: ownerMap.get(entryName),
      kind: detected.kind,
      mimeType: detected.mimeType,
      extension: detected.extension,
      sizeBytes: raw.length,
      readBytes: () => zip.read(data, entryName) ?? null,
      toDataUri: () => {
        const b = zip.read(data, entryName);
        if (!b) return null;
        return `data:${detected.mimeType};base64,${bytesToBase64(b)}`;
      },
    });
  }

  return attachments;
}
