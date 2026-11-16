// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type ReqIfWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/reqif/parser.wasm`.
 */
export function getReqIfWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "reqif");
}

/**
 * Instantiates the native `reqif.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createReqIfWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getReqIfWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("reqif", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated ReqIF WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setReqIfWasmParser(parser: ReqIfWasmParser | null | undefined): void {
  registerPreloadedWasmParser("reqif", parser as never);
}

/**
 * Returns the cached or pre-loaded ReqIF WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getReqIfWasmParser(): ReqIfWasmParser {
  return getOrLoadLanguageWasmParser("reqif", import.meta.url, createWasmParserSync);
}

/**
 * Parses ReqIF XML via the native `reqif.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseReqIfXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: ReqIfWasmParser | null = null;
  try {
    parser = getReqIfWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
