// SPDX-License-Identifier: AGPL-3.0-or-later

import { inflateRaw } from "pako";

/**
 * Lightweight ZIP archive reader (browser-safe, zero Node.js filesystem dependency).
 * Extract a file from raw ZIP bytes by name.
 * Supports STORED (method 0) and DEFLATED (method 8) entries.
 */
export function extractFromZip(zipData: Uint8Array, targetName: string): Uint8Array | null {
  // Find End of Central Directory record
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
