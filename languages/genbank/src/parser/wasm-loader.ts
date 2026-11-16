// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/genbank/wasm-parser";

export type GenbankWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getGenbankWasmParser(): GenbankWasmParser {
  return getOrLoadLanguageWasmParser("genbank", import.meta.url, createWasmParserSync);
}
