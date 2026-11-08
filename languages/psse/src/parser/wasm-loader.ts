// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser, createWasmParserSync } from "@modelscript/dsl/bindings";

/**
 * Resolves the URL or absolute file path to the native PSS/E WebAssembly parser binary.
 */
export function getPsseWasmPath(): string {
  const url = new URL("../../dist/parser.wasm", import.meta.url);
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
