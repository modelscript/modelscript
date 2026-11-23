// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NetcdfDataset } from "../types.js";
import { decodeNetcdfBinary, encodeNetcdfBinary, isNetcdfBinary } from "./binary-codec.js";
import { formatCdl, parseCdl } from "./cdl-parser.js";

/**
 * Unified parser accepting either CDL ASCII text (`string`) or NetCDF Classic binary (`Uint8Array`).
 */
export function parseNetcdf(input: string | Uint8Array, datasetName?: string): NetcdfDataset {
  if (input instanceof Uint8Array) {
    return decodeNetcdfBinary(input, datasetName);
  }
  return parseCdl(input);
}

export { decodeNetcdfBinary, encodeNetcdfBinary, formatCdl, isNetcdfBinary, parseCdl };
