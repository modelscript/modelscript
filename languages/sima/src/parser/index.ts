// SPDX-License-Identifier: AGPL-3.0-or-later

export { parseCardDeck } from "./card-parser.js";
export { parseHydFile } from "./hyd-parser.js";
export { parseSimaXml } from "./sima-xml-parser.js";

import type { SimaModel } from "../types.js";
import { parseCardDeck } from "./card-parser.js";
import { parseSimaXml } from "./sima-xml-parser.js";

/**
 * Universal parser entrypoint for SIMO/RIFLEX and SIMA files.
 */
export function parseSimaFile(text: string, filePath?: string): SimaModel {
  const trimmed = text.trim();
  if (
    trimmed.startsWith("<") &&
    (trimmed.includes("sima") || trimmed.includes("vessel") || trimmed.includes("model"))
  ) {
    return parseSimaXml(text, filePath);
  }
  return parseCardDeck(text, filePath);
}
