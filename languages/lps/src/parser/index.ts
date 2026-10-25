// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Parser Entry Point.
 */

import type { LpsModel } from "../types.js";
import { parseLpsKeyDeck } from "./key-deck-parser.js";
import { parseLpsXml } from "./lps-xml-parser.js";

export { parseLpsKeyDeck } from "./key-deck-parser.js";
export { parseLpsXml } from "./lps-xml-parser.js";
export { serializeLpsKeyDeck, serializeLpsXml } from "./serializer.js";

/**
 * Automatically detects whether content is XML or ASCII keyword deck and returns an LpsModel.
 */
export function parseLps(content: string, filename?: string): LpsModel {
  const trimmed = content.trim();
  if (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<PipelineStudio") ||
    trimmed.startsWith("<TGNET") ||
    trimmed.startsWith("<TLNET") ||
    trimmed.startsWith("<Network") ||
    trimmed.startsWith("<Study") ||
    (filename &&
      (filename.endsWith(".lps") ||
        filename.endsWith(".tgx") ||
        filename.endsWith(".tlx") ||
        filename.endsWith(".xml")))
  ) {
    return parseLpsXml(content);
  }

  // Fallback to keyword deck parser
  return parseLpsKeyDeck(content);
}
