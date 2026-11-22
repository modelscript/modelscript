// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type MagicDrawWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/magicdraw/parser.wasm`.
 */
export function getMagicDrawWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "magicdraw");
}

/**
 * Instantiates the native `magicdraw.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createMagicDrawWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getMagicDrawWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("magicdraw", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated MagicDraw WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setMagicDrawWasmParser(parser: MagicDrawWasmParser | null | undefined): void {
  registerPreloadedWasmParser("magicdraw", parser as never);
}

/**
 * Returns the cached or pre-loaded MagicDraw WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getMagicDrawWasmParser(): MagicDrawWasmParser {
  return getOrLoadLanguageWasmParser("magicdraw", import.meta.url, createWasmParserSync);
}

/**
 * Parses MagicDraw / XMI XML via the native `magicdraw.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseMagicDrawXmlDocument(
  xmlContent: string,
  existingTree?: { rootNode?: unknown } | null,
): XmlDocument {
  let parser: MagicDrawWasmParser | null = null;
  try {
    parser = getMagicDrawWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
