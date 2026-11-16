// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser, registerPreloadedWasmParser, resolveLanguageWasmPath } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

export type SmilesWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/smiles/parser.wasm`.
 */
export function getSmilesWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "smiles");
}

/**
 * Instantiates the native SMILES WebAssembly GLR parser asynchronously.
 */
export async function createSmilesWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getSmilesWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("smiles", res.parser as never, res.facade as never);
  return res;
}

/**
 * Instantiates the native SMILES WebAssembly GLR parser synchronously in Node.js.
 */
export function createSmilesWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getSmilesWasmPath();
  const res = createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
  registerPreloadedWasmParser("smiles", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated SMILES WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setSmilesWasmParser(parser: SmilesWasmParser | null | undefined): void {
  registerPreloadedWasmParser("smiles", parser as never);
}

/**
 * Returns the cached or pre-loaded SMILES WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getSmilesWasmParser(): SmilesWasmParser {
  return getOrLoadLanguageWasmParser("smiles", import.meta.url, createWasmParserSync);
}
