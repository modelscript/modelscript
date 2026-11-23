// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CdfDocument } from "../types.js";
import { decodeCdfBinary, isCdfBinaryBuffer } from "./binary-codec.js";
import { parseCdfSkeleton } from "./skt-parser.js";

export * from "./binary-codec.js";
export * from "./skt-parser.js";

/**
 * Unified NASA CDF parser accepting either a `.skt` ASCII string or a binary `.cdf` buffer.
 */
export function parseNasaCdf(input: string | Uint8Array, uri?: string): CdfDocument {
  if (input instanceof Uint8Array) {
    if (isCdfBinaryBuffer(input)) {
      return decodeCdfBinary(input, uri);
    }
    const text = new TextDecoder("utf-8").decode(input);
    return parseCdfSkeleton(text, uri);
  }
  return parseCdfSkeleton(input, uri);
}
