// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type SedmlWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/sedml/parser.wasm`.
 */
export function getSedmlWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "sedml");
}

/**
 * Instantiates the native `sedml.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createSedmlWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getSedmlWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("sedml", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated SED-ML WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setSedmlWasmParser(parser: SedmlWasmParser | null | undefined): void {
  registerPreloadedWasmParser("sedml", parser as never);
}

/**
 * Returns the cached or pre-loaded SED-ML WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getSedmlWasmParser(): SedmlWasmParser {
  return getOrLoadLanguageWasmParser("sedml", import.meta.url, createWasmParserSync);
}

/**
 * Parses SED-ML XML via the native `sedml.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseSedmlXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: SedmlWasmParser | null = null;
  try {
    parser = getSedmlWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
