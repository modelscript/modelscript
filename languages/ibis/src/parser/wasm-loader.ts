// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser, registerPreloadedWasmParser, resolveLanguageWasmPath } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

export type IbisWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/ibis/parser.wasm`.
 */
export function getIbisWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "ibis");
}

/**
 * Instantiates the native IBIS WebAssembly GLR parser asynchronously.
 */
export async function createIbisWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getIbisWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("ibis", res.parser as never, res.facade as never);
  return res;
}

/**
 * Instantiates the native IBIS WebAssembly GLR parser synchronously in Node.js.
 */
export function createIbisWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getIbisWasmPath();
  const res = createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
  registerPreloadedWasmParser("ibis", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated IBIS WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setIbisWasmParser(parser: IbisWasmParser | null | undefined): void {
  registerPreloadedWasmParser("ibis", parser as never);
}

/**
 * Returns the cached or pre-loaded IBIS WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getIbisWasmParser(): IbisWasmParser {
  return getOrLoadLanguageWasmParser("ibis", import.meta.url, createWasmParserSync);
}
