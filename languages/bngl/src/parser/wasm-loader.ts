// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/bngl/wasm-parser";
import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";

export type BnglWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getBnglWasmParser(): BnglWasmParser {
  return getOrLoadLanguageWasmParser("bngl", import.meta.url, createWasmParserSync);
}
