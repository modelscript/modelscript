// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/adams/wasm-parser";
import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";

export type AdamsWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getAdamsWasmParser(): AdamsWasmParser {
  return getOrLoadLanguageWasmParser("adams", import.meta.url, createWasmParserSync);
}
