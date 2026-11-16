// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type OpenScenarioWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/openscenario/parser.wasm`.
 */
export function getOpenScenarioWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "openscenario");
}

/**
 * Instantiates the native `openscenario.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createOpenScenarioWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getOpenScenarioWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("openscenario", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated OpenSCENARIO WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setOpenScenarioWasmParser(parser: OpenScenarioWasmParser | null | undefined): void {
  registerPreloadedWasmParser("openscenario", parser as never);
}

/**
 * Returns the cached or pre-loaded OpenSCENARIO WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getOpenScenarioWasmParser(): OpenScenarioWasmParser {
  return getOrLoadLanguageWasmParser("openscenario", import.meta.url, createWasmParserSync);
}

/**
 * Parses OpenSCENARIO XML via the native `openscenario.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseOpenScenarioXmlDocument(
  xmlContent: string,
  existingTree?: { rootNode?: unknown } | null,
): XmlDocument {
  let parser: OpenScenarioWasmParser | null = null;
  try {
    parser = getOpenScenarioWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
