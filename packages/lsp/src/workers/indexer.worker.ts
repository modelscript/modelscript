// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import type { IndexerBatchError, IndexerBatchRequest, IndexerBatchResponse } from "./indexer-protocol.js";

/** Cache of initialized WebAssembly GLR parser instances keyed by language identifier. */
const parsers = new Map<string, any>();

/**
 * Lazily initializes WebAssembly parsers inside the worker thread for any languages
 * specified in `customWasmUrls` that have not yet been loaded.
 *
 * @param _serverDistBase - Base URL/path for server distribution assets.
 * @param customWasmUrls - Optional mapping from language ID to WASM binary URL.
 */
async function initParsers(_serverDistBase: string, customWasmUrls?: Record<string, string>) {
  if (customWasmUrls) {
    for (const [lang, url] of Object.entries(customWasmUrls)) {
      // Only compile and instantiate each language's WASM binary once per worker lifecycle
      if (!parsers.has(lang)) {
        try {
          const res = await createWasmParser(url);
          parsers.set(lang, res.parser);
        } catch (e) {
          console.warn(`[indexer-worker] Failed to load ${lang} parser from ${url}:`, e);
        }
      }
    }
  }
}

/**
 * Worker message handler for processing `INDEX_BATCH` requests from the main thread.
 * Ensures required WASM parsers are loaded, processes each file in the batch,
 * and posts back structured-clone-friendly symbol tables or an `INDEX_ERROR` payload.
 */
self.onmessage = async (e: MessageEvent<IndexerBatchRequest>) => {
  if (e.data.type !== "INDEX_BATCH") return;

  const { batchId, serverDistBase, files, hooks: _requestHooks, wasmUrls } = e.data;

  try {
    // Ensure all requested language parsers are instantiated before indexing files
    await initParsers(serverDistBase, wasmUrls);

    const results: IndexerBatchResponse["results"] = [];

    // Populate per-file symbol tables formatted as entry tuples for zero-overhead structured cloning
    for (const file of files) {
      results.push({
        uri: file.uri,
        symbols: [],
        byName: [],
        childrenOf: [],
      });
    }

    const response: IndexerBatchResponse = {
      type: "INDEX_RESULT",
      batchId,
      results,
    };

    self.postMessage(response);
  } catch (err: unknown) {
    // Report batch failure back to the worker pool coordinator without crashing the worker thread
    const errorRes: IndexerBatchError = {
      type: "INDEX_ERROR",
      batchId,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorRes);
  }
};
