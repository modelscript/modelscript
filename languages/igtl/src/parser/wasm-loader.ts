// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type IgtlWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/igtl/parser.wasm`.
 */
export function getIgtlWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "igtl");
}

/**
 * Instantiates the native `igtl` WebAssembly GLR parser asynchronously (browser or Node.js).
 */
export async function createIgtlWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getIgtlWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("igtl", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated OpenIGTLink WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setIgtlWasmParser(parser: IgtlWasmParser | null | undefined): void {
  registerPreloadedWasmParser("igtl", parser as never);
}

/**
 * Returns the cached or pre-loaded OpenIGTLink WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getIgtlWasmParser(): IgtlWasmParser {
  return getOrLoadLanguageWasmParser("igtl", import.meta.url, createWasmParserSync);
}

/**
 * Parses OpenIGTLink / PLUS XML via the native `parser.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseIgtlXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: IgtlWasmParser | null = null;
  try {
    parser = getIgtlWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
