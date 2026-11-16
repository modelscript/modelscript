// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/phreeqc/wasm-parser";

export type PhreeqcWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getPhreeqcWasmParser(): PhreeqcWasmParser {
  return getOrLoadLanguageWasmParser("phreeqc", import.meta.url, createWasmParserSync);
}
