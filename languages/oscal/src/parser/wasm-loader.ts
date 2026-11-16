// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type OscalWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/oscal/parser.wasm`.
 */
export function getOscalWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "oscal");
}

/**
 * Instantiates the native `oscal.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createOscalWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getOscalWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("oscal", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated OSCAL WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setOscalWasmParser(parser: OscalWasmParser | null | undefined): void {
  registerPreloadedWasmParser("oscal", parser as never);
}

/**
 * Returns the cached or pre-loaded OSCAL WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getOscalWasmParser(): OscalWasmParser {
  return getOrLoadLanguageWasmParser("oscal", import.meta.url, createWasmParserSync);
}

/**
 * Parses OSCAL XML via the native `oscal.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseOscalXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: OscalWasmParser | null = null;
  try {
    parser = getOscalWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
