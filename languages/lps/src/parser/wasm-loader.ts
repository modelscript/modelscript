// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type LpsWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/lps/parser.wasm`.
 */
export function getLpsWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "lps");
}

/**
 * Instantiates the native `lps` WebAssembly GLR parser asynchronously (browser or Node.js).
 */
export async function createLpsWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getLpsWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("lps", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated LPS WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setLpsWasmParser(parser: LpsWasmParser | null | undefined): void {
  registerPreloadedWasmParser("lps", parser as never);
}

/**
 * Returns the cached or pre-loaded LPS WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getLpsWasmParser(): LpsWasmParser {
  return getOrLoadLanguageWasmParser("lps", import.meta.url, createWasmParserSync);
}

/**
 * Parses PipelineStudio XML via the native `parser.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseLpsXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: LpsWasmParser | null = null;
  try {
    parser = getLpsWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
