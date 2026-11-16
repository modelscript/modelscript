// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type DicomRtWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/dicom-rt/parser.wasm`.
 */
export function getDicomRtWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "dicom-rt");
}

/**
 * Instantiates the native `dicom-rt` WebAssembly GLR parser asynchronously (browser or Node.js).
 */
export async function createDicomRtWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getDicomRtWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("dicom-rt", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated DICOM-RT WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setDicomRtWasmParser(parser: DicomRtWasmParser | null | undefined): void {
  registerPreloadedWasmParser("dicom-rt", parser as never);
}

/**
 * Returns the cached or pre-loaded DICOM-RT WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getDicomRtWasmParser(): DicomRtWasmParser {
  return getOrLoadLanguageWasmParser("dicom-rt", import.meta.url, createWasmParserSync);
}

/**
 * Parses DICOM-RT XML via the native `parser.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseDicomRtXmlDocument(xmlContent: string, existingTree?: { rootNode?: unknown } | null): XmlDocument {
  let parser: DicomRtWasmParser | null = null;
  try {
    parser = getDicomRtWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
