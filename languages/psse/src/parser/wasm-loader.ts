// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOrLoadLanguageWasmParser,
  getPreloadedWasmParser,
  registerPreloadedWasmParser,
  resolveLanguageWasmPath,
} from "@modelscript/dsl/bindings";
import { createWasmParser, createWasmParserSync } from "../../src-gen/bindings.js";

export type PsseWasmParser = ReturnType<typeof createWasmParserSync>["parser"];

let cachedPsseParser: PsseWasmParser | undefined;
let pendingPsseParserPromise: Promise<PsseWasmParser> | undefined;

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

/**
 * Resolves the URL or absolute file path to the native PSS/E WebAssembly parser binary.
 */
export function getPsseWasmPath(): string {
  return resolveLanguageWasmPath(import.meta.url, "psse");
}

/**
 * Instantiates the native WebAssembly GLR parser asynchronously and registers it globally.
 */
export async function createPsseWasmParser(wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer) {
  const target = wasmUrlOrBytes ?? getPsseWasmPath();
  const res = await createWasmParser(target as Parameters<typeof createWasmParser>[0]);
  cachedPsseParser = res.parser;
  registerPreloadedWasmParser("psse", res.parser as never, res.facade as never);
  return res;
}

/**
 * Instantiates the native WebAssembly GLR parser synchronously in Node.js and registers it globally.
 */
export function createPsseWasmParserSync(wasmPathOrBytes?: string | Uint8Array) {
  const target = wasmPathOrBytes ?? getPsseWasmPath();
  const res = createWasmParserSync(target as Parameters<typeof createWasmParserSync>[0]);
  cachedPsseParser = res.parser;
  registerPreloadedWasmParser("psse", res.parser as never, res.facade as never);
  return res;
}

/**
 * Registers a pre-instantiated PSS/E WebAssembly parser (e.g. loaded asynchronously in browser workers or UI panels).
 */
export function setPsseWasmParser(parser: PsseWasmParser | null | undefined): void {
  cachedPsseParser = parser ?? undefined;
  registerPreloadedWasmParser("psse", (parser ?? null) as never);
}

/**
 * Returns true if `getPsseWasmParser()` can succeed synchronously without throwing
 * (either a parser is already preloaded, or we are running in Node.js where sync loading is supported).
 */
export function isPsseWasmParserReady(): boolean {
  if (cachedPsseParser) return true;
  if (getPreloadedWasmParser("psse")) return true;
  return isNodeRuntime();
}

/**
 * Asynchronously ensures the native PSS/E WebAssembly GLR parser is loaded and registered.
 * Safe to call in browser main-thread UI components, WebWorkers, and Node.js.
 */
export async function ensurePsseWasmParser(
  wasmUrlOrBytes?: string | Uint8Array | ArrayBuffer,
): Promise<PsseWasmParser> {
  if (cachedPsseParser) return cachedPsseParser;
  const preloaded = getPreloadedWasmParser("psse") as PsseWasmParser | undefined;
  if (preloaded) {
    cachedPsseParser = preloaded;
    return preloaded;
  }
  if (pendingPsseParserPromise && wasmUrlOrBytes === undefined) {
    return pendingPsseParserPromise;
  }

  const loadPromise = (async () => {
    const candidates: Array<string | Uint8Array | ArrayBuffer> = [];
    if (wasmUrlOrBytes !== undefined) {
      candidates.push(wasmUrlOrBytes);
    } else if (!isNodeRuntime()) {
      const g = globalThis as { __MODELSCRIPT_LSP_BASE__?: string };
      if (typeof g.__MODELSCRIPT_LSP_BASE__ === "string" && g.__MODELSCRIPT_LSP_BASE__.trim()) {
        candidates.push(`${g.__MODELSCRIPT_LSP_BASE__.replace(/\/+$/, "")}/psse.wasm`);
      }
      candidates.push("/lsp/server/dist/psse.wasm");
      candidates.push("/static/devextensions/server/dist/psse.wasm");
      try {
        candidates.push(getPsseWasmPath());
      } catch {
        // Ignore if import.meta.url cannot resolve a relative path in bundled contexts
      }
    } else {
      candidates.push(getPsseWasmPath());
    }

    const seen = new Set<string>();
    let lastError: unknown;
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
      }
      try {
        const { parser } = await createPsseWasmParser(candidate);
        return parser;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Failed to load PSS/E WASM parser"));
  })();

  if (wasmUrlOrBytes === undefined) {
    pendingPsseParserPromise = loadPromise;
    loadPromise.catch(() => {
      if (pendingPsseParserPromise === loadPromise) {
        pendingPsseParserPromise = undefined;
      }
    });
  }

  return loadPromise;
}

/**
 * Returns the cached or pre-loaded PSS/E WebAssembly parser, falling back to synchronous Node loading.
 */
export function getPsseWasmParser(): PsseWasmParser {
  if (cachedPsseParser) return cachedPsseParser;
  const preloaded = getPreloadedWasmParser("psse") as PsseWasmParser | undefined;
  if (preloaded) {
    cachedPsseParser = preloaded;
    return cachedPsseParser;
  }
  cachedPsseParser = getOrLoadLanguageWasmParser("psse", import.meta.url, createWasmParserSync);
  return cachedPsseParser;
}
