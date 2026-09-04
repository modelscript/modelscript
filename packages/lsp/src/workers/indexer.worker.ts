import { createWasmParser } from "@modelscript/dsl/bindings";
import type { IndexerBatchError, IndexerBatchRequest, IndexerBatchResponse } from "./indexer-protocol.js";

let parser: any = null;
let sysml2Parser: any = null;
let initialized = false;

async function initParsers(serverDistBase: string) {
  if (initialized) return;

  try {
    const modelicaResult = await createWasmParser(`${serverDistBase}/tree-sitter-modelica.wasm`);
    parser = modelicaResult.parser;
  } catch (e) {
    console.warn("[indexer-worker] Failed to load Modelica parser:", e);
  }

  try {
    const sysmlResult = await createWasmParser(`${serverDistBase}/tree-sitter-sysml2.wasm`);
    sysml2Parser = sysmlResult.parser;
  } catch (e) {
    console.warn("[indexer-worker] Failed to load SysML2 parser:", e);
  }

  initialized = true;
}

self.onmessage = async (e: MessageEvent<IndexerBatchRequest>) => {
  if (e.data.type !== "INDEX_BATCH") return;

  const { batchId, serverDistBase, files, hooks: requestHooks } = e.data;

  try {
    await initParsers(serverDistBase);

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
