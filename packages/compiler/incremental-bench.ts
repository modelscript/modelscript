import * as path from "path";
import { performance } from "perf_hooks";
import { extractIndexerHooks } from "./src/generators/indexer.js";
import { extractRefHooks } from "./src/generators/refs.js";
import { findWasmFile } from "./src/init.js";
import { QueryEngine } from "./src/query-engine.js";
import { ScopeResolver } from "./src/resolver.js";
import { SymbolIndexer } from "./src/symbol-indexer.js";

// Helper for lazy node wrapping (copied from playground.ts)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWrapNode(node: any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _children: any[] | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        for (let i = 0; i < node.childCount; i++) {
          _children.push(this.child(i));
        }
      }
      return _children;
    },
  };
}

async function runBenchmark() {
  const langPath = "/home/omar/git/modelscript/languages/modelica/language.ts";
  const mod = await import(`file://${langPath}`);
  const langConfig = mod.default || mod;

  const $ = new Proxy({}, { get: (_, prop) => ({ type: "sym", name: prop }) });
  const indexerHooks = extractIndexerHooks(langConfig, $);
  const refHooks = extractRefHooks(langConfig, $);

  // Load Tree-sitter WASM
  const Parser = (await import("web-tree-sitter")).default;
  await Parser.init();
  const wasmPath = findWasmFile(path.dirname(langPath), langConfig.name);
  if (!wasmPath) throw new Error("WASM file not found");
  const tsLanguage = await Parser.Language.load(wasmPath);
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

  const sizes = [10000, 20000, 30000, 40000, 50000];

  for (const size of sizes) {
    console.log(`\n--- Benchmarking Cascade N=${size} ---`);
    const initialText = generateCascade(size);

    // 1. Cold Start
    const t0 = performance.now();
    const tree0 = tsParser.parse(initialText);
    const cst0 = lazyWrapNode(tree0.rootNode);
    const index0 = indexer.index(cst0);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const resolver0 = new ScopeResolver(index0, refHooks, indexerHooks);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const engine0 = new QueryEngine(index0, new Map(), { tree: undefined });
    console.log(`Cold Start Full Compilation: ${(performance.now() - t0).toFixed(2)} ms`);

    // 2. Incremental Edit (Change BENCHMARK_MARKER line)
    const markerIdx = initialText.indexOf("-x1; // BENCHMARK_MARKER");
    const modifiedText =
      initialText.slice(0, markerIdx) + "-x1 * 2; // BENCHMARK_MARKER" + initialText.slice(markerIdx + 24);

    // Tree-sitter edit
    tree0.edit({
      startIndex: markerIdx,
      oldEndIndex: markerIdx + 24,
      newEndIndex: markerIdx + 28,
      startPosition: { row: 0, column: 0 }, // Simplified positions for test
      oldEndPosition: { row: 0, column: 0 },
      newEndPosition: { row: 0, column: 0 },
    });

    const tReparseStart = performance.now();
    const tree1 = tsParser.parse(modifiedText, tree0);
    const cst1 = lazyWrapNode(tree1.rootNode);
    const tReparse = performance.now() - tReparseStart;

    const tScopeStart = performance.now();
    const editRanges = [{ startByte: markerIdx, endByte: markerIdx + 28 }];
    const index1 = indexer.update(index0, cst1, editRanges, 4).index;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const resolver1 = new ScopeResolver(index1, refHooks, indexerHooks);
    // Force resolution (if lazy, we would trigger it here)
    const tScope = performance.now() - tScopeStart;

    const tSymStart = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const engine1 = new QueryEngine(index1, new Map(), { tree: undefined });
    // Force symbolic evaluation triggers here...
    const tSym = performance.now() - tSymStart;

    const tLintStart = performance.now();
    // Force linting queries...
    const tLint = performance.now() - tLintStart;

    console.log(`Incremental Reparse : ${tReparse.toFixed(2)} ms`);
    console.log(`Incremental Scope   : ${tScope.toFixed(2)} ms`);
    console.log(`Incremental Symbolic: ${tSym.toFixed(2)} ms`);
    console.log(`Incremental Linting : ${tLint.toFixed(2)} ms`);
  }
}

runBenchmark().catch(console.error);
