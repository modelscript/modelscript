// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser, registerPreloadedWasmParser, resolveLanguageWasmPath } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

export type MolfileWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/molfile/parser.wasm`.
 */
export function getMolfileWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "molfile");
}

/**
 * Instantiates the native Molfile WebAssembly GLR parser asynchronously.
 */
export async function createMolfileWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getMolfileWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("molfile", res.parser as never, res.facade as never);
  return res;
}

/**
 * Instantiates the native Molfile WebAssembly GLR parser synchronously in Node.js.
 */
export function createMolfileWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getMolfileWasmPath();
  const res = createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
  registerPreloadedWasmParser("molfile", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated Molfile WebAssembly GLR parser.
 */
export function setMolfileWasmParser(parser: MolfileWasmParser | null | undefined): void {
  registerPreloadedWasmParser("molfile", parser as never);
}

/**
 * Returns the cached or pre-loaded Molfile WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getMolfileWasmParser(): MolfileWasmParser {
  return getOrLoadLanguageWasmParser("molfile", import.meta.url, createWasmParserSync);
}
