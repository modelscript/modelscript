// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser, registerPreloadedWasmParser, resolveLanguageWasmPath } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

export type TouchstoneWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/touchstone/parser.wasm`.
 */
export function getTouchstoneWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "touchstone");
}

/**
 * Instantiates the native Touchstone WebAssembly GLR parser asynchronously.
 */
export async function createTouchstoneWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getTouchstoneWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("touchstone", res.parser as never, res.facade as never);
  return res;
}

/**
 * Instantiates the native Touchstone WebAssembly GLR parser synchronously in Node.js.
 */
export function createTouchstoneWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getTouchstoneWasmPath();
  const res = createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
  registerPreloadedWasmParser("touchstone", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated Touchstone WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setTouchstoneWasmParser(parser: TouchstoneWasmParser | null | undefined): void {
  registerPreloadedWasmParser("touchstone", parser as never);
}

/**
 * Returns the cached or pre-loaded Touchstone WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getTouchstoneWasmParser(): TouchstoneWasmParser {
  return getOrLoadLanguageWasmParser("touchstone", import.meta.url, createWasmParserSync);
}
