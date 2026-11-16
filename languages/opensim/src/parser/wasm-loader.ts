// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type OpenSimWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/opensim/parser.wasm`.
 */
export function getOpenSimWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "opensim");
}

/**
 * Instantiates the native `opensim.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createOpenSimWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getOpenSimWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("opensim", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated OpenSim WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setOpenSimWasmParser(parser: OpenSimWasmParser | null | undefined): void {
  registerPreloadedWasmParser("opensim", parser as never);
}

/**
 * Returns the cached or pre-loaded OpenSim WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getOpenSimWasmParser(): OpenSimWasmParser {
  return getOrLoadLanguageWasmParser("opensim", import.meta.url, createWasmParserSync);
}

/**
 * Parses OpenSim XML via the native `opensim.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseOpenSimXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: OpenSimWasmParser | null = null;
  try {
    parser = getOpenSimWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
