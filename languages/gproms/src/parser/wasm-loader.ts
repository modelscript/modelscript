// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser, registerPreloadedWasmParser, resolveLanguageWasmPath } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

export type GpromsWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/gproms/parser.wasm`.
 */
export function getGpromsWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "gproms");
}

/**
 * Instantiates the native gPROMS WebAssembly GLR parser asynchronously.
 */
export async function createGpromsWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getGpromsWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("gproms", res.parser as never, res.facade as never);
  return res;
}

/**
 * Instantiates the native gPROMS WebAssembly GLR parser synchronously in Node.js.
 */
export function createGpromsWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getGpromsWasmPath();
  const res = createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
  registerPreloadedWasmParser("gproms", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated gPROMS WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setGpromsWasmParser(parser: GpromsWasmParser | null | undefined): void {
  registerPreloadedWasmParser("gproms", parser as never);
}

/**
 * Returns the cached or pre-loaded gPROMS WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getGpromsWasmParser(): GpromsWasmParser {
  return getOrLoadLanguageWasmParser("gproms", import.meta.url, createWasmParserSync);
}
