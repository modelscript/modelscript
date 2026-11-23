// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync, type TreeSitterParser } from "../src-gen/bindings.js";

export function getApdlWasmParser(): TreeSitterParser {
  return getOrLoadLanguageWasmParser<TreeSitterParser>("apdl", import.meta.url, createWasmParserSync);
}
