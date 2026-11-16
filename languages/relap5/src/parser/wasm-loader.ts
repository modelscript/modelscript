// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/relap5/wasm-parser";

export type Relap5WasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getRelap5WasmParser(): Relap5WasmParser {
  return getOrLoadLanguageWasmParser("relap5", import.meta.url, createWasmParserSync);
}
