/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
import { SymbolIndexer } from "@modelscript/compiler";
import { Language, Parser } from "web-tree-sitter";
// @ts-ignore
import { INDEXER_HOOKS as modelicaIndexerHooks } from "@modelscript/modelica/indexer_config";
// @ts-ignore
import type { IndexerBatchError, IndexerBatchRequest, IndexerBatchResponse } from "@modelscript/compiler";
import { INDEXER_HOOKS as sysml2IndexerHooks } from "@modelscript/sysml2/config";

let parser: Parser | null = null;
let sysml2Parser: Parser | null = null;
let initialized = false;

async function initParsers(serverDistBase: string) {
  if (initialized) return;
  await Parser.init({
    locateFile: (file: string) => {
      return `${serverDistBase}/${file}`;
    },
  });

  const Modelica = await Language.load(`${serverDistBase}/tree-sitter-modelica.wasm`);
  parser = new Parser();
  parser.setLanguage(Modelica);

  try {
    const SysML2 = await Language.load(`${serverDistBase}/tree-sitter-sysml2.wasm`);
    sysml2Parser = new Parser();
    sysml2Parser.setLanguage(SysML2);
  } catch (e) {
    console.warn("[indexer-worker] Failed to load SysML2 parser:", e);
  }

  initialized = true;
}

self.onmessage = async (e: MessageEvent<IndexerBatchRequest>) => {
  if (e.data.type !== "INDEX_BATCH") return;

  const { batchId, serverDistBase, files } = e.data;

  try {
    await initParsers(serverDistBase);

    const results: IndexerBatchResponse["results"] = [];

    for (const file of files) {
      const isSysml = file.uri.endsWith(".sysml");
      const activeParser = isSysml ? sysml2Parser : parser;
      const hooks = isSysml ? sysml2IndexerHooks : modelicaIndexerHooks;

      if (!activeParser) continue;

      const tree = activeParser.parse(file.text);
      if (!tree) continue;

      const indexer = new SymbolIndexer(hooks);
      // We pass a local ID generator starting from 1
      let localIdCounter = 1;
      const { index: rawIndex } = indexer.update(null as any, tree.rootNode, [], 0, () => localIdCounter++);

      // Clean up the WASM tree to prevent memory leaks in the worker!
      tree.delete();

      // Convert Maps to Arrays for structured cloning
      results.push({
        uri: file.uri,
        symbols: Array.from(rawIndex.symbols.entries()),
        byName: Array.from(rawIndex.byName.entries()),
        childrenOf: Array.from(rawIndex.childrenOf.entries()),
      });
    }

    const response: IndexerBatchResponse = {
      type: "INDEX_RESULT",
      batchId,
      results,
    };

    self.postMessage(response);
  } catch (err: any) {
    const errorRes: IndexerBatchError = {
      type: "INDEX_ERROR",
      batchId,
      error: err.message || String(err),
    };
    self.postMessage(errorRes);
  }
};
