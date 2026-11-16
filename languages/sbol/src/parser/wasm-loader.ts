// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type SbolWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/sbol/parser.wasm`.
 */
export function getSbolWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "sbol");
}

/**
 * Instantiates the native `sbol.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createSbolWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getSbolWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("sbol", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated SBOL WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setSbolWasmParser(parser: SbolWasmParser | null | undefined): void {
  registerPreloadedWasmParser("sbol", parser as never);
}

/**
 * Returns the cached or pre-loaded SBOL WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getSbolWasmParser(): SbolWasmParser {
  return getOrLoadLanguageWasmParser("sbol", import.meta.url, createWasmParserSync);
}

/**
 * Parses SBOL XML via the native `sbol.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseSbolXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: SbolWasmParser | null = null;
  try {
    parser = getSbolWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
