// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Hdf4Document } from "../types.js";
import { decodeHdf4Binary, encodeHdf4Binary, isHdf4Binary, type EncodeHdf4BinaryOptions } from "./binary-codec.js";
import { formatHdf4Ddl, parseHdf4Ddl } from "./ddl-parser.js";

/**
 * Unified HDF4 parser accepting either textual HDF4 DDL or raw binary NCSA HDF4 bytes.
 */
export function parseHdf4(input: string | Uint8Array): Hdf4Document {
  if (input instanceof Uint8Array) {
    return decodeHdf4Binary(input);
  }
  return parseHdf4Ddl(input);
}

export { decodeHdf4Binary, encodeHdf4Binary, formatHdf4Ddl, isHdf4Binary, parseHdf4Ddl, type EncodeHdf4BinaryOptions };
