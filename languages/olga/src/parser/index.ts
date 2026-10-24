// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OlgaModel } from "../types.js";
import { parseKeyDeck } from "./key-parser.js";
import { parseOpi } from "./opi-parser.js";

export * from "./key-parser.js";
export * from "./opi-parser.js";
export * from "./pvt-table-parser.js";

/**
 * Universal OLGA model parser.
 * Automatically inspects the source text to determine whether it is an
 * XML GUI project (.opi / .xml) or a keyword deck (.key / .genkey / .inp),
 * parsing it into a normalized OlgaModel structure.
 */
export function parseOlga(source: string): OlgaModel {
  const trimmed = source.trim();
  if (trimmed.startsWith("<")) {
    return parseOpi(source);
  }
  return parseKeyDeck(source);
}
