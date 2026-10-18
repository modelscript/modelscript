// SPDX-License-Identifier: AGPL-3.0-or-later

import { inflateRaw } from "pako";
import type { LibraryListItem } from "../api";

export interface ExtractedZipMetadata {
  name?: string | undefined;
  version?: string | undefined;
  description?: string | undefined;
  license?: string | undefined;
  files: string[];
  hasManifest: boolean;
}

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isValidSemver(version: string): boolean {
  return SEMVER_REGEX.test(version.trim());
}

/**
 * Inspects a ZIP byte buffer in-memory to list entries and extract metadata
 * from `package.json` or `package.mo` (at root or single top-level directory).
 */
export function inspectPackageZip(zipData: Uint8Array): ExtractedZipMetadata {
  const result: ExtractedZipMetadata = {
    files: [],
    hasManifest: false,
  };

  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData[i] === 0x50 && zipData[i + 1] === 0x4b && zipData[i + 2] === 0x05 && zipData[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return result;

  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;

  const readEntryText = (
    localHeaderOffset: number,
    compressionMethod: number,
    compressedSize: number,
  ): string | null => {
    if (localHeaderOffset + 30 > zipData.byteLength) return null;
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;
    const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
    if (dataStart + compressedSize > zipData.byteLength) return null;

    let rawBytes: Uint8Array | null = null;
    if (compressionMethod === 0) {
      rawBytes = zipData.subarray(dataStart, dataStart + compressedSize);
    } else if (compressionMethod === 8) {
      try {
        rawBytes = inflateRaw(zipData.subarray(dataStart, dataStart + compressedSize));
      } catch {
        return null;
      }
    }
    if (!rawBytes) return null;
    return new TextDecoder().decode(rawBytes);
  };

  let packageJsonText: string | null = null;
  let packageMoText: string | null = null;

  let pos = cdOffset;
  while (pos < cdEnd && pos + 46 <= zipData.byteLength) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const fileName = new TextDecoder().decode(zipData.subarray(pos + 46, pos + 46 + fileNameLength));

    if (!fileName.endsWith("/")) {
      result.files.push(fileName);
    }

    const normalized = fileName.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const isRootOrTopDir = parts.length === 1 || parts.length === 2;
    const baseName = parts[parts.length - 1];

    if (isRootOrTopDir && baseName === "package.json" && !packageJsonText) {
      packageJsonText = readEntryText(localHeaderOffset, compressionMethod, compressedSize);
    } else if (isRootOrTopDir && baseName === "package.mo" && !packageMoText) {
      packageMoText = readEntryText(localHeaderOffset, compressionMethod, compressedSize);
    }

    pos += 46 + fileNameLength + extraLength + commentLength;
  }

  if (packageJsonText) {
    result.hasManifest = true;
    try {
      const parsed = JSON.parse(packageJsonText) as Record<string, unknown>;
      if (typeof parsed.name === "string" && parsed.name.trim()) result.name = parsed.name.trim();
      if (typeof parsed.version === "string" && parsed.version.trim()) result.version = parsed.version.trim();
      if (typeof parsed.description === "string" && parsed.description.trim()) {
        result.description = parsed.description.trim();
      }
      if (typeof parsed.license === "string" && parsed.license.trim()) result.license = parsed.license.trim();
    } catch {
      // Ignore malformed JSON
    }
  }

  if (packageMoText) {
    result.hasManifest = true;
    const pkgMatch = packageMoText.match(/\bpackage\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+"([^"]*)")?/);
    if (pkgMatch) {
      if (!result.name && pkgMatch[1]) {
        result.name = pkgMatch[1];
      }
      if (!result.description && pkgMatch[2]) {
        result.description = pkgMatch[2];
      }
    }
    const verMatch = packageMoText.match(/\bversion\s*=\s*"([^"]+)"/);
    if (!result.version && verMatch?.[1]) {
      result.version = verMatch[1];
    }
  }

  return result;
}

export type SortOption = "downloads" | "recent" | "name";

export function filterAndSortLibraries(
  libraries: LibraryListItem[],
  options: {
    activeTab: "all" | "my";
    username?: string | undefined;
    domainFilter: string;
    sortBy: SortOption;
  },
): LibraryListItem[] {
  const filtered = libraries.filter((lib) => {
    if (options.activeTab === "my") {
      if (!options.username) return false;
      const matchesUser =
        lib.author === options.username ||
        lib.scope === options.username ||
        lib.name.startsWith(`@${options.username}/`) ||
        lib.name.startsWith(`${options.username}/`);
      if (!matchesUser) return false;
    }
    if (options.domainFilter !== "all") {
      const domains = lib.domains || ["modelica"];
      if (!domains.includes(options.domainFilter)) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (options.sortBy === "downloads") {
      const diff = (b.totalDownloads ?? 0) - (a.totalDownloads ?? 0);
      if (diff !== 0) return diff;
    } else if (options.sortBy === "recent") {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      if (tb !== ta) return tb - ta;
    }
    return a.name.localeCompare(b.name);
  });
}
