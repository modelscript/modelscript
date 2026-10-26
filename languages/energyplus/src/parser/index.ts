// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EnergyPlusDocument } from "../types.js";
import { parseEpJson } from "./epjson-parser.js";
import { parseIdf } from "./idf-parser.js";

export { parseEpJson } from "./epjson-parser.js";
export { parseIdf } from "./idf-parser.js";

export function parseEnergyPlus(source: string, filename?: string): EnergyPlusDocument {
  const trimmed = source.trimStart();
  if (trimmed.startsWith("{")) {
    return parseEpJson(source, filename);
  }
  return parseIdf(source, filename);
}
