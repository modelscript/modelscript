// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type FebioWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/febio/parser.wasm`.
 */
export function getFebioWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "febio");
}

/**
 * Instantiates the native `febio` WebAssembly GLR parser asynchronously (browser or Node.js).
 */
export async function createFebioWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getFebioWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("febio", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated FEBio WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setFebioWasmParser(parser: FebioWasmParser | null | undefined): void {
  registerPreloadedWasmParser("febio", parser as never);
}

/**
 * Returns the cached or pre-loaded FEBio WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getFebioWasmParser(): FebioWasmParser {
  return getOrLoadLanguageWasmParser("febio", import.meta.url, createWasmParserSync);
}

/**
 * Parses FEBio / SOFA XML via the native `parser.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseFebioXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: FebioWasmParser | null = null;
  try {
    parser = getFebioWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
