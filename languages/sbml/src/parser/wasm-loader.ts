// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type SbmlWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/sbml/parser.wasm`.
 */
export function getSbmlWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "sbml");
}

/**
 * Instantiates the native `sbml.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createSbmlWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getSbmlWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("sbml", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated SBML WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setSbmlWasmParser(parser: SbmlWasmParser | null | undefined): void {
  registerPreloadedWasmParser("sbml", parser as never);
}

/**
 * Returns the cached or pre-loaded SBML WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getSbmlWasmParser(): SbmlWasmParser {
  return getOrLoadLanguageWasmParser("sbml", import.meta.url, createWasmParserSync);
}

/**
 * Parses SBML XML via the native `sbml.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseSbmlXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: SbmlWasmParser | null = null;
  try {
    parser = getSbmlWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
