// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StlFacet, StlMeshDocument, StlParseError, StlSolid } from "../types.js";

export const BINARY_STL_HEADER_BYTES = 80;
export const BINARY_STL_COUNT_BYTES = 4;
export const BINARY_STL_RECORD_BYTES = 50;
export const BINARY_STL_MIN_BYTES = BINARY_STL_HEADER_BYTES + BINARY_STL_COUNT_BYTES;

/**
 * Heuristic detector for Binary STL vs ASCII STL.
 *
 * A binary STL file has an 80-byte header, a 4-byte little-endian uint32 triangle count N,
 * and exactly `84 + 50 * N` bytes. Note that some binary STL files start with the ASCII
 * characters `"solid "` in their 80-byte header, so byte-size parity is checked first.
 */
export function isBinaryStl(data: Uint8Array): boolean {
  if (data.byteLength < BINARY_STL_MIN_BYTES) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const triCount = view.getUint32(BINARY_STL_HEADER_BYTES, true);
  const expectedSize = BINARY_STL_MIN_BYTES + triCount * BINARY_STL_RECORD_BYTES;
  if (expectedSize === data.byteLength) {
    return true;
  }
  // Check for NUL bytes or non-ASCII control characters in the first 256 bytes
  const probeLen = Math.min(data.byteLength, 256);
  for (let i = 0; i < probeLen; i++) {
    const b = data[i] ?? 0;
    if (b === 0 || (b < 0x09 && b !== 0x00) || (b > 0x0d && b < 0x20)) {
      return true;
    }
  }
  return false;
}

function decodeHeaderAscii(bytes: Uint8Array): string {
  let end = Math.min(bytes.byteLength, BINARY_STL_HEADER_BYTES);
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) {
    end--;
  }
  let out = "";
  for (let i = 0; i < end; i++) {
    const b = bytes[i] ?? 0;
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7e) {
      out += String.fromCharCode(b);
    }
  }
  return out.trim();
}

/**
 * Parses an IEEE-754 little-endian Binary STL buffer:
 * - 80-byte ASCII header
 * - uint32 little-endian triangle count
 * - N x 50-byte facet records (12 float32 values: normal + 3 vertices, plus uint16 attribute byte count)
 */
export function parseBinaryStl(input: Uint8Array | ArrayBuffer): StlMeshDocument {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const errors: StlParseError[] = [];

  if (bytes.byteLength < BINARY_STL_MIN_BYTES) {
    errors.push({
      message: `Binary STL truncated: expected at least ${BINARY_STL_MIN_BYTES} bytes, got ${bytes.byteLength}`,
      line: 1,
      column: 1,
      code: "STL1001",
      offset: 0,
    });
    return {
      format: "binary",
      header: "",
      solids: [],
      facets: [],
      errors,
      byteLength: bytes.byteLength,
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = decodeHeaderAscii(bytes);
  const declaredCount = view.getUint32(BINARY_STL_HEADER_BYTES, true);
  const expectedBytes = BINARY_STL_MIN_BYTES + declaredCount * BINARY_STL_RECORD_BYTES;
  const availableRecords = Math.floor((bytes.byteLength - BINARY_STL_MIN_BYTES) / BINARY_STL_RECORD_BYTES);

  if (bytes.byteLength < expectedBytes) {
    errors.push({
      message: `Binary STL truncated: header declares ${declaredCount} facet(s) (${expectedBytes} bytes), but buffer has ${bytes.byteLength} bytes (${availableRecords} complete facet(s))`,
      line: 1,
      column: 1,
      code: "STL1001",
      offset: bytes.byteLength,
    });
  } else if (bytes.byteLength > expectedBytes) {
    errors.push({
      message: `Binary STL trailing bytes: expected ${expectedBytes} bytes for ${declaredCount} facet(s), got ${bytes.byteLength} bytes`,
      line: 1,
      column: 1,
      code: "STL5004",
      offset: expectedBytes,
    });
  }

  const count = Math.min(declaredCount, availableRecords);
  const facets: StlFacet[] = new Array<StlFacet>(count);
  let pos = BINARY_STL_MIN_BYTES;

  for (let i = 0; i < count; i++) {
    const nx = view.getFloat32(pos + 0, true);
    const ny = view.getFloat32(pos + 4, true);
    const nz = view.getFloat32(pos + 8, true);

    const v0x = view.getFloat32(pos + 12, true);
    const v0y = view.getFloat32(pos + 16, true);
    const v0z = view.getFloat32(pos + 20, true);

    const v1x = view.getFloat32(pos + 24, true);
    const v1y = view.getFloat32(pos + 28, true);
    const v1z = view.getFloat32(pos + 32, true);

    const v2x = view.getFloat32(pos + 36, true);
    const v2y = view.getFloat32(pos + 40, true);
    const v2z = view.getFloat32(pos + 44, true);

    const attr = view.getUint16(pos + 48, true);

    facets[i] = {
      normal: [nx, ny, nz],
      vertices: [
        [v0x, v0y, v0z],
        [v1x, v1y, v1z],
        [v2x, v2y, v2z],
      ],
      attributeByteCount: attr,
      startOffset: pos,
      endOffset: pos + BINARY_STL_RECORD_BYTES,
    };
    pos += BINARY_STL_RECORD_BYTES;
  }

  const solid: StlSolid = {
    name: header || "binary_solid",
    closed: true,
    facets,
    startOffset: 0,
    endOffset: bytes.byteLength,
  };

  return {
    format: "binary",
    header,
    solids: [solid],
    facets,
    errors,
    declaredFacetCount: declaredCount,
    byteLength: bytes.byteLength,
  };
}

/**
 * Encodes an `StlMeshDocument` into IEEE-754 little-endian Binary STL bytes.
 */
export function encodeBinaryStl(doc: StlMeshDocument, headerText?: string): Uint8Array {
  const facets = doc.facets;
  const totalBytes = BINARY_STL_MIN_BYTES + facets.length * BINARY_STL_RECORD_BYTES;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  // Avoid starting binary header with "solid" per 3D Systems convention
  let hdr = headerText ?? doc.header ?? doc.solids[0]?.name ?? "ModelScript Binary STL";
  if (/^solid\b/i.test(hdr.trim())) {
    hdr = `Binary STL: ${hdr.trim()}`;
  }
  for (let i = 0; i < Math.min(hdr.length, BINARY_STL_HEADER_BYTES); i++) {
    out[i] = hdr.charCodeAt(i) & 0x7f;
  }

  view.setUint32(BINARY_STL_HEADER_BYTES, facets.length >>> 0, true);

  let pos = BINARY_STL_MIN_BYTES;
  for (const f of facets) {
    view.setFloat32(pos + 0, f.normal[0], true);
    view.setFloat32(pos + 4, f.normal[1], true);
    view.setFloat32(pos + 8, f.normal[2], true);

    view.setFloat32(pos + 12, f.vertices[0][0], true);
    view.setFloat32(pos + 16, f.vertices[0][1], true);
    view.setFloat32(pos + 20, f.vertices[0][2], true);

    view.setFloat32(pos + 24, f.vertices[1][0], true);
    view.setFloat32(pos + 28, f.vertices[1][1], true);
    view.setFloat32(pos + 32, f.vertices[1][2], true);

    view.setFloat32(pos + 36, f.vertices[2][0], true);
    view.setFloat32(pos + 40, f.vertices[2][1], true);
    view.setFloat32(pos + 44, f.vertices[2][2], true);

    view.setUint16(pos + 48, (f.attributeByteCount ?? 0) & 0xffff, true);
    pos += BINARY_STL_RECORD_BYTES;
  }

  return out;
}
