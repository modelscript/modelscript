// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU archive storage and extraction.
 *
 * Manages uploaded FMU archives on disk:
 * - Stores the original .fmu (ZIP) file
 * - Extracts modelDescription.xml for metadata parsing
 * - Provides access to embedded model.json for FMU-JS participants
 * - Manages lifecycle (list, get, delete)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { inflateRawSync } from "zlib";
import type { FmiModelDescription, FmiTerminal } from "./model-description.js";
import { parseModelDescription, parseTerminalsAndIcons } from "./model-description.js";

/** Metadata about a stored FMU. */
export interface StoredFmu {
  /** Unique ID (derived from filename or user-specified). */
  id: string;
  /** Original upload filename. */
  filename: string;
  /** Parsed model description. */
  modelDescription: FmiModelDescription;
  /** Parsed FMI 3.0 terminals and icons (if present). */
  terminalsAndIcons?: FmiTerminal[] | undefined;
  /** File size in bytes. */
  sizeBytes: number;
  /** Upload timestamp. */
  uploadedAt: string;
}

/**
 * FMU file storage manager.
 *
 * Stores FMUs in a directory structure:
 *   {storageDir}/{id}/
 *     archive.fmu          - Original FMU archive
 *     modelDescription.xml - Extracted metadata
 *     metadata.json        - Parsed metadata + upload info
 */
export class FmuStorage {
  private readonly storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir ?? join(process.cwd(), "data", "fmus");
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Store an uploaded FMU archive.
   *
   * @param id       Unique identifier for this FMU
   * @param filename Original filename
   * @param data     Raw FMU archive bytes
   * @returns Parsed metadata
   */
  store(id: string, filename: string, data: Buffer): StoredFmu {
    const dir = join(this.storageDir, id);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write the archive
    writeFileSync(join(dir, "archive.fmu"), data);

    // Extract modelDescription.xml from the ZIP
    // FMU is a ZIP file — modelDescription.xml is always at the root
    const xmlContent = extractFileFromZip(data, "modelDescription.xml");
    if (!xmlContent) {
      // Clean up on failure
      rmSync(dir, { recursive: true, force: true });
      throw new Error("Invalid FMU archive: modelDescription.xml not found");
    }

    writeFileSync(join(dir, "modelDescription.xml"), xmlContent);

    // Parse the model description
    const modelDescription = parseModelDescription(xmlContent);

    // Try to extract FMI 3.0 terminalsAndIcons.xml
    let terminalsAndIcons: FmiTerminal[] | undefined;
    const terminalsXml = extractFileFromZip(data, "terminalsAndIcons/terminalsAndIcons.xml");
    if (terminalsXml) {
      writeFileSync(join(dir, "terminalsAndIcons.xml"), terminalsXml);
      terminalsAndIcons = parseTerminalsAndIcons(terminalsXml);
    }

    // Store metadata
    const stored: StoredFmu = {
      id,
      filename,
      modelDescription,
      terminalsAndIcons,
      sizeBytes: data.length,
      uploadedAt: new Date().toISOString(),
    };

    writeFileSync(join(dir, "metadata.json"), JSON.stringify(stored, null, 2));

    return stored;
  }

  /** List all stored FMUs. */
  list(): StoredFmu[] {
    if (!existsSync(this.storageDir)) return [];
    const entries = readdirSync(this.storageDir, { withFileTypes: true });
    const results: StoredFmu[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metadataPath = join(this.storageDir, entry.name, "metadata.json");
      if (existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as StoredFmu;
          results.push(metadata);
        } catch {
          // Skip corrupted entries
        }
      }
    }

    return results;
  }

  /** Get a stored FMU by ID. */
  get(id: string): StoredFmu | null {
    const metadataPath = join(this.storageDir, id, "metadata.json");
    if (!existsSync(metadataPath)) return null;
    try {
      return JSON.parse(readFileSync(metadataPath, "utf-8")) as StoredFmu;
    } catch {
      return null;
    }
  }

  /** Get the raw FMU archive bytes. */
  getArchive(id: string): Buffer | null {
    const archivePath = join(this.storageDir, id, "archive.fmu");
    if (!existsSync(archivePath)) return null;
    return readFileSync(archivePath);
  }

  /** Get the modelDescription.xml content. */
  getModelDescription(id: string): string | null {
    const xmlPath = join(this.storageDir, id, "modelDescription.xml");
    if (!existsSync(xmlPath)) return null;
    return readFileSync(xmlPath, "utf-8");
  }

  /** Get the embedded model.json (serialized DAE) content if it exists. */
  getModelJson(id: string): string | null {
    const archive = this.getArchive(id);
    if (!archive) return null;
    return extractFileFromZip(archive, "resources/model.json");
  }

  /** Extract a specific file from the FMU ZIP archive. */
  getExtractedFile(id: string, filename: string): string | null {
    const archive = this.getArchive(id);
    if (!archive) return null;
    return extractFileFromZip(archive, filename);
  }

  /** Get the terminalsAndIcons.xml content (if it exists). */
  getTerminalsAndIcons(id: string): string | null {
    const xmlPath = join(this.storageDir, id, "terminalsAndIcons.xml");
    if (!existsSync(xmlPath)) return null;
    return readFileSync(xmlPath, "utf-8");
  }

  /** Delete a stored FMU. */
  delete(id: string): boolean {
    const dir = join(this.storageDir, id);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }
}

// ── ZIP extraction helpers ──────────────────────────────────────

/**
 * Extract a single file from a ZIP archive by name.
 *
 * Minimal ZIP parser — reads the central directory to find the file,
 * then extracts its content. Supports STORED and DEFLATED methods.
 * No external dependency required.
 */
export function extractFileFromZip(zipData: Buffer, targetName: string): string | null {
  // Find End of Central Directory record
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const cdOffset = zipData.readUInt32LE(eocdOffset + 16);
  const cdSize = zipData.readUInt32LE(eocdOffset + 12);
  const cdEnd = cdOffset + cdSize;

  // Scan central directory for the target file
  let pos = cdOffset;
  while (pos < cdEnd) {
    if (zipData.readUInt32LE(pos) !== 0x02014b50) break;

    const compressionMethod = zipData.readUInt16LE(pos + 10);
    const compressedSize = zipData.readUInt32LE(pos + 20);
    const fileNameLength = zipData.readUInt16LE(pos + 28);
    const extraLength = zipData.readUInt16LE(pos + 30);
    const commentLength = zipData.readUInt16LE(pos + 32);
    const localHeaderOffset = zipData.readUInt32LE(pos + 42);
    const fileName = zipData.subarray(pos + 46, pos + 46 + fileNameLength).toString("utf-8");

    if (fileName === targetName) {
      // Read from local file header
      const localPos = localHeaderOffset;
      if (zipData.readUInt32LE(localPos) !== 0x04034b50) return null;

      const localFileNameLen = zipData.readUInt16LE(localPos + 26);
      const localExtraLen = zipData.readUInt16LE(localPos + 28);
      const dataStart = localPos + 30 + localFileNameLen + localExtraLen;

      if (compressionMethod === 0) {
        // Stored (no compression)
        return zipData.subarray(dataStart, dataStart + compressedSize).toString("utf-8");
      } else if (compressionMethod === 8) {
        // Deflated — use zlib
        try {
          const inflated = inflateRawSync(zipData.subarray(dataStart, dataStart + compressedSize));
          return inflated.toString("utf-8");
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
