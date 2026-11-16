// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser, registerPreloadedWasmParser, resolveLanguageWasmPath } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

export type AspenWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/aspen/parser.wasm`.
 */
export function getAspenWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "aspen");
}

/**
 * Instantiates the native Aspen WebAssembly GLR parser asynchronously.
 */
export async function createAspenWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getAspenWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("aspen", res.parser as never, res.facade as never);
  return res;
}

/**
 * Instantiates the native Aspen WebAssembly GLR parser synchronously in Node.js.
 */
export function createAspenWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getAspenWasmPath();
  const res = createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
  registerPreloadedWasmParser("aspen", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated Aspen WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setAspenWasmParser(parser: AspenWasmParser | null | undefined): void {
  registerPreloadedWasmParser("aspen", parser as never);
}

/**
 * Returns the cached or pre-loaded Aspen WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getAspenWasmParser(): AspenWasmParser {
  return getOrLoadLanguageWasmParser("aspen", import.meta.url, createWasmParserSync);
}
