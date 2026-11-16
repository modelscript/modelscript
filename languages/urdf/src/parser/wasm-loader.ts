// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type UrdfWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/urdf/parser.wasm`.
 */
export function getUrdfWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "urdf");
}

/**
 * Instantiates the native `urdf.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createUrdfWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getUrdfWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("urdf", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated URDF WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setUrdfWasmParser(parser: UrdfWasmParser | null | undefined): void {
  registerPreloadedWasmParser("urdf", parser as never);
}

/**
 * Returns the cached or pre-loaded URDF WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getUrdfWasmParser(): UrdfWasmParser {
  return getOrLoadLanguageWasmParser("urdf", import.meta.url, createWasmParserSync);
}

/**
 * Parses URDF/MJCF/Xacro XML via the native `urdf.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseUrdfXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: UrdfWasmParser | null = null;
  try {
    parser = getUrdfWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
