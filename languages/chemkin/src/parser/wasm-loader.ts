// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/chemkin/wasm-parser";
import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";

export type ChemkinWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getChemkinWasmParser(): ChemkinWasmParser {
  return getOrLoadLanguageWasmParser("chemkin", import.meta.url, createWasmParserSync);
}
