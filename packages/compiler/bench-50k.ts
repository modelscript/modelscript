import * as path from "path";
import { performance } from "perf_hooks";
import { extractIndexerHooks } from "./src/generators/indexer.js";
import { extractRefHooks } from "./src/generators/refs.js";
import { findWasmFile } from "./src/init.js";
import { QueryEngine } from "./src/query-engine.js";
import { ScopeResolver } from "./src/resolver.js";
import { SymbolIndexer } from "./src/symbol-indexer.js";

function lazyWrapNode(node: any): any {
  let _children: any[] | null = null;
  const _childCache = new Map<number, any>();
  return {
    get type() {
      return node.type;
    },
    get text() {
      return node.text;
    },
    get startByte() {
      return node.startIndex;
    },
    get endByte() {
      return node.endIndex;
    },
    get hasChanges() {
      return node.hasChanges;
    },
    get childCount() {
      return node.childCount;
    },
    child(i: number) {
      if (i < 0 || i >= node.childCount) return null;
      let cached = _childCache.get(i);
      if (!cached) {
        cached = lazyWrapNode(node.child(i));
        _childCache.set(i, cached);
      }
      return cached;
    },
    childForFieldName(name: string) {
      const child = node.childForFieldName(name);
      return child ? lazyWrapNode(child) : null;
    },
    get children() {
      if (!_children) {
        _children = [];
        for (let i = 0; i < node.childCount; i++) _children.push(this.child(i));
      }
      return _children;
    },
  };
}

async function run() {
  const langPath = "/home/omar/git/modelscript/languages/modelica/language.ts";
  const mod = await import(`file://${langPath}`);
  const langConfig = mod.default || mod;

  const $ = new Proxy({}, { get: (_, prop) => ({ type: "sym", name: prop }) });
  const indexerHooks = extractIndexerHooks(langConfig, $);
  const refHooks = extractRefHooks(langConfig, $);

  const Parser = (await import("web-tree-sitter")).default;
  await Parser.init();
  const wasmPath = findWasmFile(path.dirname(langPath), langConfig.name);
  const tsLanguage = await Parser.Language.load(wasmPath!);
  const tsParser = new Parser();
  tsParser.setLanguage(tsLanguage);

  const indexer = new SymbolIndexer(indexerHooks);

  function generateCascade(n: number) {
    const lines = [`model Cascade_${n}`];
    for (let i = 1; i <= n; i++) lines.push(`  Real x${i}(start=1.0);`);
    lines.push("equation");
    lines.push("  der(x1) = -x1; // BENCHMARK_MARKER");
    for (let i = 2; i <= n; i++) lines.push(`  der(x${i}) = x${i - 1} - x${i};`);
    lines.push(`end Cascade_${n};`);
    return lines.join("\n");
  }

  const size = 50000;
  console.log(`\n--- Benchmarking Cascade N=${size} ---`);
  const initialText = generateCascade(size);
  const t0 = performance.now();
  const tree0 = tsParser.parse(initialText);
  const cst0 = lazyWrapNode(tree0.rootNode);
  const index0 = indexer.index(cst0);
  const resolver0 = new ScopeResolver(index0, refHooks, indexerHooks);
  const engine0 = new QueryEngine(index0, new Map(), { tree: undefined });
  console.log(`Cold Start Full Compilation: ${(performance.now() - t0).toFixed(2)} ms`);
}
run().catch(console.error);
