// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GdsiiLibrary } from "../types.js";
import {
  GdsiiRecordType,
  decodeGdsiiBinary,
  decodeIbmReal64,
  encodeGdsiiBinary,
  encodeIbmReal64,
  readGdsiiRecords,
  type RawGdsiiRecord,
} from "./binary-stream.js";
import { formatGdsiiAscii, parseGdsiiAscii } from "./gdt-parser.js";

export {
  GdsiiRecordType,
  decodeGdsiiBinary,
  decodeIbmReal64,
  encodeGdsiiBinary,
  encodeIbmReal64,
  formatGdsiiAscii,
  parseGdsiiAscii,
  readGdsiiRecords,
  type RawGdsiiRecord,
};

/**
 * Unified GDSII parser accepting either GDT/ASCII text or binary GDSII stream bytes.
 */
export function parseGdsii(input: string | Uint8Array): GdsiiLibrary {
  if (typeof input === "string") {
    return parseGdsiiAscii(input);
  }
  return decodeGdsiiBinary(input);
}
