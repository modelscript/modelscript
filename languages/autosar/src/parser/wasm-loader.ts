// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type AutosarWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/autosar/parser.wasm`.
 */
export function getAutosarWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "autosar");
}

/**
 * Instantiates the native `autosar` WebAssembly GLR parser asynchronously (browser or Node.js).
 */
export async function createAutosarWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getAutosarWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("autosar", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated AUTOSAR WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setAutosarWasmParser(parser: AutosarWasmParser | null | undefined): void {
  registerPreloadedWasmParser("autosar", parser as never);
}

/**
 * Returns the cached or pre-loaded AUTOSAR WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getAutosarWasmParser(): AutosarWasmParser {
  return getOrLoadLanguageWasmParser("autosar", import.meta.url, createWasmParserSync);
}

/**
 * Parses AUTOSAR ARXML via the native `parser.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseAutosarXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: AutosarWasmParser | null = null;
  try {
    parser = getAutosarWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
