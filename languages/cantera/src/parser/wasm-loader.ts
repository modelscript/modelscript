// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/cantera/wasm-parser";
import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";

export type CanteraWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getCanteraWasmParser(): CanteraWasmParser {
  return getOrLoadLanguageWasmParser("cantera", import.meta.url, createWasmParserSync);
}
