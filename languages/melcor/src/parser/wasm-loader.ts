// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/melcor/wasm-parser";

export type MelcorWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getMelcorWasmParser(): MelcorWasmParser {
  return getOrLoadLanguageWasmParser("melcor", import.meta.url, createWasmParserSync);
}
