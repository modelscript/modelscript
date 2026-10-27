// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser, createWasmParserSync } from "@modelscript/dsl/bindings";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resolves the absolute file path to the native PSS/E WebAssembly parser binary.
 */
export function getPsseWasmPath(): string {
  return fileURLToPath(new URL("../../dist/parser.wasm", import.meta.url));
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
  const target =
    wasmPathOrBytes ?? (typeof process !== "undefined" ? readFileSync(getPsseWasmPath()) : getPsseWasmPath());
  return createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
}
