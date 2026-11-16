// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type SspWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/ssp/parser.wasm`.
 */
export function getSspWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "ssp");
}

/**
 * Instantiates the native `ssp.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createSspWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getSspWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("ssp", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated SSP WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setSspWasmParser(parser: SspWasmParser | null | undefined): void {
  registerPreloadedWasmParser("ssp", parser as never);
}

/**
 * Returns the cached or pre-loaded SSP WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getSspWasmParser(): SspWasmParser {
  return getOrLoadLanguageWasmParser("ssp", import.meta.url, createWasmParserSync);
}

/**
 * Parses SSP XML via the native `ssp.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseSspXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: SspWasmParser | null = null;
  try {
    parser = getSspWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
