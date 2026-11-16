// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type PlcopenWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/plcopen/parser.wasm`.
 */
export function getPlcopenWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "plcopen");
}

/**
 * Instantiates the native `plcopen.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createPlcopenWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getPlcopenWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("plcopen", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated PLCopen WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setPlcopenWasmParser(parser: PlcopenWasmParser | null | undefined): void {
  registerPreloadedWasmParser("plcopen", parser as never);
}

/**
 * Returns the cached or pre-loaded PLCopen WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getPlcopenWasmParser(): PlcopenWasmParser {
  return getOrLoadLanguageWasmParser("plcopen", import.meta.url, createWasmParserSync);
}

/**
 * Parses PLCopen XML via the native `plcopen.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parsePlcopenXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: PlcopenWasmParser | null = null;
  try {
    parser = getPlcopenWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
