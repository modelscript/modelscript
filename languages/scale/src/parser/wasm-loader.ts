// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/scale/wasm-parser";

export type ScaleWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

export function getScaleWasmParser(): ScaleWasmParser {
  return getOrLoadLanguageWasmParser("scale", import.meta.url, createWasmParserSync);
}
