// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser, registerPreloadedWasmParser, resolveLanguageWasmPath } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

export type PdbWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/pdb/parser.wasm`.
 */
export function getPdbWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "pdb");
}

/**
 * Instantiates the native PDB WebAssembly GLR parser asynchronously.
 */
export async function createPdbWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getPdbWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("pdb", res.parser as never, res.facade as never);
  return res;
}

/**
 * Instantiates the native PDB WebAssembly GLR parser synchronously in Node.js.
 */
export function createPdbWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getPdbWasmPath();
  const res = createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
  registerPreloadedWasmParser("pdb", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated PDB WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setPdbWasmParser(parser: PdbWasmParser | null | undefined): void {
  registerPreloadedWasmParser("pdb", parser as never);
}

/**
 * Returns the cached or pre-loaded PDB WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getPdbWasmParser(): PdbWasmParser {
  return getOrLoadLanguageWasmParser("pdb", import.meta.url, createWasmParserSync);
}
