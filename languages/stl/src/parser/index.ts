// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StlMeshDocument } from "../types.js";
import { formatAsciiStl, parseAsciiStl } from "./ascii-parser.js";
import {
  BINARY_STL_COUNT_BYTES,
  BINARY_STL_HEADER_BYTES,
  BINARY_STL_MIN_BYTES,
  BINARY_STL_RECORD_BYTES,
  encodeBinaryStl,
  isBinaryStl,
  parseBinaryStl,
} from "./binary-codec.js";

export {
  BINARY_STL_COUNT_BYTES,
  BINARY_STL_HEADER_BYTES,
  BINARY_STL_MIN_BYTES,
  BINARY_STL_RECORD_BYTES,
  encodeBinaryStl,
  formatAsciiStl,
  isBinaryStl,
  parseAsciiStl,
  parseBinaryStl,
};

/**
 * Unified STL parser supporting both ASCII STL text and Binary STL buffers.
 */
export function parseStl(input: string | Uint8Array | ArrayBuffer): StlMeshDocument {
  if (typeof input === "string") {
    return parseAsciiStl(input);
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isBinaryStl(bytes)) {
    return parseBinaryStl(bytes);
  }
  const decoded = new TextDecoder("utf-8").decode(bytes);
  return parseAsciiStl(decoded);
}
