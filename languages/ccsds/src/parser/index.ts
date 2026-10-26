// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CcsdsDocument } from "../types.js";
import { parseKvn } from "./kvn-parser.js";
import { parseXtce } from "./xtce-parser.js";

export function parseCcsds(source: string, filename?: string): CcsdsDocument {
  const fn = (filename ?? "").toLowerCase();
  if (fn.endsWith(".xtce") || fn.endsWith(".xml") || source.includes("<SpaceSystem") || source.includes("<?xml")) {
    return parseXtce(source);
  }
  return parseKvn(source);
}

export { parseKvn } from "./kvn-parser.js";
export { parseXtce } from "./xtce-parser.js";
