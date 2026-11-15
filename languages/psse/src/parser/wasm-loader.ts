// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser, createWasmParserSync } from "@modelscript/dsl/bindings";

/**
 * Resolves the URL or absolute file path to the native PSS/E WebAssembly parser binary.
 */
export function getPsseWasmPath(): string {
  const rel = import.meta.url.includes("/dist/src/")
    ? "../../parser.wasm"
    : import.meta.url.includes("/dist/")
      ? "../parser.wasm"
      : "../../dist/parser.wasm";
  const url = new URL(rel, import.meta.url);
  if (url.protocol === "file:") {
    const pathname = decodeURIComponent(url.pathname);
    return typeof process !== "undefined" && process?.platform === "win32" && pathname.startsWith("/")
      ? pathname.slice(1)
      : pathname;
  }
  return url.href;
}

/**
 * Instantiates the native WebAssembly GLR parser asynchronously.
 */
export async function createPsseWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getPsseWasmPath();
  return createWasmParser(target as Parameters<typeof createWasmParser>[0]);
}

/**
 * Instantiates the native WebAssembly GLR parser synchronously in Node.js.
 */
export function createPsseWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getPsseWasmPath();
  return createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
}

type PsseWasmParser = ReturnType<typeof createPsseWasmParserSync>["parser"];
let cachedPsseParser: PsseWasmParser | undefined;

/**
 * Registers a pre-instantiated PSS/E WebAssembly parser (e.g. loaded asynchronously in browser workers).
 */
export function setPsseWasmParser(parser: PsseWasmParser | null | undefined): void {
  cachedPsseParser = parser ?? undefined;
}

/**
 * Returns the cached PSS/E WebAssembly parser, checking `globalThis.psseParser` before falling back to synchronous Node loading.
 */
export function getPsseWasmParser(): PsseWasmParser {
  if (cachedPsseParser) return cachedPsseParser;
  const globalParser = (globalThis as { psseParser?: PsseWasmParser }).psseParser;
  if (globalParser) {
    cachedPsseParser = globalParser;
    return cachedPsseParser;
  }
  cachedPsseParser = createPsseWasmParserSync().parser;
  return cachedPsseParser;
}
