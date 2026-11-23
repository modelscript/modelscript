// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import type { ApdlParsedDeck } from "../types.js";
import { getApdlWasmParser } from "../wasm-loader.js";
import { parseApdl } from "./deck-parser.js";

export { parseApdl, splitApdlFields } from "./deck-parser.js";

/**
 * Parses an APDL script with both the structured APDL parser and the native WASM GLR parser.
 */
export function parseApdlWithWasm(source: string): {
  deck: ApdlParsedDeck;
  wasmSyntaxErrors: Array<{
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    message: string;
  }>;
} {
  const deck = parseApdl(source);
  const tree = getApdlWasmParser().parse(source);
  const wasmSyntaxErrors = collectWasmSyntaxErrors(tree?.rootNode);
  return { deck, wasmSyntaxErrors };
}
