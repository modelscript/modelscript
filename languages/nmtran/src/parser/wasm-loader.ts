// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync, type TreeSitterParser } from "../../src-gen/bindings.js";

export function getNmtranWasmParser(): TreeSitterParser {
  return getOrLoadLanguageWasmParser<TreeSitterParser>("nmtran", import.meta.url, createWasmParserSync);
}
