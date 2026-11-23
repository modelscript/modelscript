// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BufrMessage } from "../types.js";
import { decodeBufrBinary } from "./binary-codec.js";
import { parseBufrText } from "./text-parser.js";

export * from "./binary-codec.js";
export * from "./text-parser.js";

/**
 * Unified BUFR parser accepting either a textual BUFR string or binary `Uint8Array`.
 */
export function parseBufr(input: string | Uint8Array, name?: string): BufrMessage {
  if (input instanceof Uint8Array) {
    return decodeBufrBinary(input);
  }
  return parseBufrText(input, name);
}
