// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type OpenDriveWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/opendrive/parser.wasm`.
 */
export function getOpenDriveWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "opendrive");
}

/**
 * Instantiates the native `opendrive.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createOpenDriveWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getOpenDriveWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("opendrive", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated OpenDRIVE WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setOpenDriveWasmParser(parser: OpenDriveWasmParser | null | undefined): void {
  registerPreloadedWasmParser("opendrive", parser as never);
}

/**
 * Returns the cached or pre-loaded OpenDRIVE WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getOpenDriveWasmParser(): OpenDriveWasmParser {
  return getOrLoadLanguageWasmParser("opendrive", import.meta.url, createWasmParserSync);
}

/**
 * Parses OpenDRIVE XML via the native `opendrive.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseOpenDriveXmlDocument(
  xmlContent: string,
  existingTree?: { rootNode?: unknown } | null,
): XmlDocument {
  let parser: OpenDriveWasmParser | null = null;
  try {
    parser = getOpenDriveWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
