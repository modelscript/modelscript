// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type JsbsimWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/jsbsim/parser.wasm`.
 */
export function getJsbsimWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "jsbsim");
}

/**
 * Instantiates the native `jsbsim` WebAssembly GLR parser asynchronously (browser or Node.js).
 */
export async function createJsbsimWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getJsbsimWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("jsbsim", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated JSBSim WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setJsbsimWasmParser(parser: JsbsimWasmParser | null | undefined): void {
  registerPreloadedWasmParser("jsbsim", parser as never);
}

/**
 * Returns the cached or pre-loaded JSBSim WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getJsbsimWasmParser(): JsbsimWasmParser {
  return getOrLoadLanguageWasmParser("jsbsim", import.meta.url, createWasmParserSync);
}

/**
 * Parses JSBSim XML via the native `parser.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseJsbsimXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: JsbsimWasmParser | null = null;
  try {
    parser = getJsbsimWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
