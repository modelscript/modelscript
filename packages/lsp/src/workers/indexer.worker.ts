import { createWasmParser } from "@modelscript/dsl/bindings";
import type { IndexerBatchError, IndexerBatchRequest, IndexerBatchResponse } from "./indexer-protocol.js";

const parsers = new Map<string, any>();

async function initParsers(serverDistBase: string, customWasmUrls?: Record<string, string>) {
  if (customWasmUrls) {
    for (const [lang, url] of Object.entries(customWasmUrls)) {
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

  if (!parsers.has("modelica")) {
    try {
      const modelicaResult = await createWasmParser(`${serverDistBase}/tree-sitter-modelica.wasm`);
      parsers.set("modelica", modelicaResult.parser);
    } catch (e) {
      console.warn("[indexer-worker] Failed to load Modelica parser:", e);
    }
  }

  if (!parsers.has("sysml2")) {
    try {
      const sysmlResult = await createWasmParser(`${serverDistBase}/tree-sitter-sysml2.wasm`);
      parsers.set("sysml2", sysmlResult.parser);
    } catch (e) {
      console.warn("[indexer-worker] Failed to load SysML2 parser:", e);
    }
  }
}

self.onmessage = async (e: MessageEvent<IndexerBatchRequest>) => {
  if (e.data.type !== "INDEX_BATCH") return;

  const { batchId, serverDistBase, files, hooks: requestHooks, wasmUrls } = e.data;

  try {
    await initParsers(serverDistBase, wasmUrls);

    const results: IndexerBatchResponse["results"] = [];

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
    const errorRes: IndexerBatchError = {
      type: "INDEX_ERROR",
      batchId,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorRes);
  }
};
