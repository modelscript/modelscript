// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Unified FITS Textual Header & Binary HDU Parser Entry Point.
 */

import type { FitsDocument } from "../types.js";
import { decodeFitsBinary } from "./binary-hdu.js";
import { parseFitsHeaderText } from "./header-parser.js";

export * from "./binary-hdu.js";
export * from "./header-parser.js";

/**
 * Parses either a textual FITS header string or a binary 2880-byte FITS `Uint8Array`.
 */
export function parseFits(input: string | Uint8Array, uri?: string): FitsDocument {
  if (input instanceof Uint8Array) {
    return decodeFitsBinary(input, uri);
  }
  return parseFitsHeaderText(input, uri);
}
