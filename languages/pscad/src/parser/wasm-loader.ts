// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type PscadWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/pscad/parser.wasm`.
 */
export function getPscadWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "pscad");
}

/**
 * Instantiates the native `pscad.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createPscadWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getPscadWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("pscad", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated PSCAD WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setPscadWasmParser(parser: PscadWasmParser | null | undefined): void {
  registerPreloadedWasmParser("pscad", parser as never);
}

/**
 * Returns the cached or pre-loaded PSCAD WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getPscadWasmParser(): PscadWasmParser {
  return getOrLoadLanguageWasmParser("pscad", import.meta.url, createWasmParserSync);
}

/**
 * Parses PSCAD XML via the native `pscad.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB libraries or detailed tag-mismatch diagnostics.
 */
export function parsePscadXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: PscadWasmParser | null = null;
  try {
    parser = getPscadWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
