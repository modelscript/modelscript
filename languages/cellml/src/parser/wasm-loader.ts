// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type CellmlWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/cellml/parser.wasm`.
 */
export function getCellmlWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "cellml");
}

/**
 * Instantiates the native `cellml` WebAssembly GLR parser asynchronously (browser or Node.js).
 */
export async function createCellmlWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getCellmlWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("cellml", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated CellML WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setCellmlWasmParser(parser: CellmlWasmParser | null | undefined): void {
  registerPreloadedWasmParser("cellml", parser as never);
}

/**
 * Returns the cached or pre-loaded CellML WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getCellmlWasmParser(): CellmlWasmParser {
  return getOrLoadLanguageWasmParser("cellml", import.meta.url, createWasmParserSync);
}

/**
 * Parses CellML XML via the native `parser.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseCellmlXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: CellmlWasmParser | null = null;
  try {
    parser = getCellmlWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
