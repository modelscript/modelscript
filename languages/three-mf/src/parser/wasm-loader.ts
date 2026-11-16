// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type ThreeMfWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/three-mf/parser.wasm`.
 */
export function getThreeMfWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "three-mf");
}

/**
 * Instantiates the native `three-mf.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createThreeMfWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getThreeMfWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("three-mf", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated 3MF WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setThreeMfWasmParser(parser: ThreeMfWasmParser | null | undefined): void {
  registerPreloadedWasmParser("three-mf", parser as never);
}

/**
 * Returns the cached or pre-loaded 3MF WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getThreeMfWasmParser(): ThreeMfWasmParser {
  return getOrLoadLanguageWasmParser("three-mf", import.meta.url, createWasmParserSync);
}

/**
 * Parses 3MF XML via the native `three-mf.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseThreeMfXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: ThreeMfWasmParser | null = null;
  try {
    parser = getThreeMfWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
