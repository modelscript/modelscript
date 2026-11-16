// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { parseXmlWithWasmParser, type XmlDocument } from "@modelscript/dsl/xml";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

type SimulinkWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

/**
 * Resolves the filesystem path or URL to `@modelscript/simulink/parser.wasm`.
 */
export function getSimulinkWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "simulink");
}

/**
 * Instantiates the native `simulink.wasm` GLR parser asynchronously (browser or Node.js).
 */
export async function createSimulinkWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getSimulinkWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  registerPreloadedWasmParser("simulink", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated Simulink WebAssembly GLR parser (e.g. from browser LSP `ParserService`).
 */
export function setSimulinkWasmParser(parser: SimulinkWasmParser | null | undefined): void {
  registerPreloadedWasmParser("simulink", parser as never);
}

/**
 * Returns the cached or pre-loaded Simulink WebAssembly GLR parser, lazily loading `parser.wasm` in Node.js.
 */
export function getSimulinkWasmParser(): SimulinkWasmParser {
  return getOrLoadLanguageWasmParser("simulink", import.meta.url, createWasmParserSync);
}

/**
 * Parses Simulink SLX XML via the native `simulink.wasm` GLR parser (`<= 2 MB`),
 * falling back to `parseXmlSync` for > 2 MB files or detailed tag-mismatch diagnostics.
 */
export function parseSimulinkXmlDocument(
  xmlContent: string,
  existingTree?: { rootNode?: unknown } | null,
): XmlDocument {
  let parser: SimulinkWasmParser | null = null;
  try {
    parser = getSimulinkWasmParser();
  } catch {
    parser = null;
  }
  return parseXmlWithWasmParser(xmlContent, parser as never, existingTree as never);
}
