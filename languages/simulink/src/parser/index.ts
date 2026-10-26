// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SimulinkModel } from "../types.js";
import { parseMdl } from "./mdl-parser.js";
import { parseSlx } from "./slx-parser.js";

export * from "./mdl-parser.js";
export * from "./slx-parser.js";

/**
 * Universal Simulink parser that auto-detects .slx (ZIP/XML) vs .mdl (ASCII) formats.
 */
export function parseSimulink(input: string | Uint8Array | Buffer, filename?: string): SimulinkModel {
  if (typeof input !== "string") {
    // Binary buffer -> SLX
    return parseSlx(input);
  }

  // If filename ends with .slx, treat as binary if converted, or check zip magic bytes "PK\x03\x04"
  if (filename?.toLowerCase().endsWith(".slx") || input.startsWith("PK\x03\x04")) {
    const buffer = Buffer.from(input, "binary");
    return parseSlx(buffer);
  }

  // ASCII .mdl character scanner
  return parseMdl(input);
}
