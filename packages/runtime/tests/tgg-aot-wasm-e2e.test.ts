// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggEq, tggInvertible, tggRule } from "@modelscript/dsl";
import { compileTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PolyglotTransformer } from "../src/interop/polyglot-transformer.js";
import { WasmCorrespondenceBridge, type WasmPolyglotExports } from "../src/interop/wasm-polyglot-bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeRoot, "../..");

describe("TGG AOT AssemblyScript -> Live WASM End-to-End", () => {
  it("compiles compileTGGRules() output with asc to a live .wasm module and executes forward/propagate/retract via PolyglotTransformer", async () => {
    const rules = [
      tggRule({
        name: "ThermalBlockRule",
        sourceLang: "sysml2",
        targetLang: "modelica",
        source: ($, v) => $.PartDefinition({ name: v("n"), tempC: v("tc") }),
        target: ($, v) => $.ClassDefinition({ name: v("n"), tempK: v("tk") }),
        where: (v) => [tggInvertible("tk = tc + 273.15", "tc = tk - 273.15"), tggEq(v("n"), v("n"))],
      }),
    ];

    const compiled = compileTGGRules(rules, {
      syntaxTypes: {
        PartDefinition: 101,
        ClassDefinition: 202,
      },
    });

    const workDir = path.join(runtimeRoot, ".cache", "tgg-aot-e2e");
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(path.join(workDir, "indexing"), { recursive: true });

    const relFromWork = (targetAbs: string) =>
      path.relative(workDir, targetAbs).replace(/\\/g, "/").replace(/\.ts$/, "");

    // Re-export real production AssemblyScript kernels: CorrespondenceIndex, ArenaStringPool, tgg_reconciler
    fs.writeFileSync(
      path.join(workDir, "correspondence.ts"),
      `export * from "${relFromWork(path.join(runtimeRoot, "src/wasm/indexing/correspondence.ts"))}";\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(workDir, "indexing", "correspondence.ts"),
      `export * from "../correspondence";\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(workDir, "string_pool.ts"),
      `export * from "${relFromWork(path.join(runtimeRoot, "src/wasm/core/string_pool.ts"))}";\n`,
      "utf8",
    );
    // Copy real production tgg_reconciler.ts (resolving ../indexing/correspondence -> ./indexing/correspondence)
    const reconcilerSrc = fs.readFileSync(
      path.join(repoRoot, "packages/dsl/src/codegen/runtime/polyglot/tgg_reconciler.ts"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(workDir, "tgg_reconciler.ts"),
      reconcilerSrc.replace('"../indexing/correspondence"', '"./correspondence"'),
      "utf8",
    );

    // Lightweight in-WASM arena + graph.model harness implementing the exact ABI expected by compileTGGRules()
    fs.writeFileSync(
      path.join(workDir, "arena.ts"),
      `
const nodeTypes = new Map<u32, u16>();
const nodeFirstChild = new Map<u32, u32>();
const nodeNextSibling = new Map<u32, u32>();
let nextNodeId: u32 = 1;

export function ast_createNode(kind: u16): u32 {
  const id = nextNodeId++;
  nodeTypes.set(id, kind);
  return id;
}
export function getNodeType(nodeId: u32): u16 {
  return nodeTypes.has(nodeId) ? nodeTypes.get(nodeId) : 0;
}
export function getNodeFirstChild(nodeId: u32): u32 {
  return nodeFirstChild.has(nodeId) ? nodeFirstChild.get(nodeId) : 0;
}
export function getNodeNextSibling(nodeId: u32): u32 {
  return nodeNextSibling.has(nodeId) ? nodeNextSibling.get(nodeId) : 0;
}
export function atomicChunkAlloc(bytes: u32): usize {
  return heap.alloc(bytes);
}
`,
      "utf8",
    );

    fs.writeFileSync(
      path.join(workDir, "polyglot_arena.ts"),
      `
export class PolyglotArena {
  public stringPoolPtr: usize = 0;
  public registerNode(langId: u32, nodeId: u32): void {}
}
`,
      "utf8",
    );

    fs.writeFileSync(
      path.join(workDir, "graph.ts"),
      `
import { ast_createNode } from "./arena";

const u32Props = new Map<u64, u32>();
const f64Props = new Map<u64, f64>();

@inline
function propKey(nodeId: u32, propHash: u32): u64 {
  return ((nodeId as u64) << 32) | (propHash as u64);
}

export class ModelAPI {
  public create(kind: u16): u32 {
    return ast_createNode(kind);
  }
  public delete(nodeId: u32): void {}
  public appendChild(parentId: u32, childId: u32): void {}
  public clone(nodeId: u32, deep: bool): u32 { return nodeId; }
  public compute(nodeId: u32, queryHash: u32): u32 { return 0; }
  public resolveHash(nodeId: u32, segHash: u32): u32 { return 0; }
  public getProperty<T>(nodeId: u32, propHash: u32): T {
    const key = propKey(nodeId, propHash);
    if (isFloat<T>()) {
      return (f64Props.has(key) ? f64Props.get(key) : NaN) as T;
    }
    return (u32Props.has(key) ? u32Props.get(key) : 0) as T;
  }
  public setProperty<T>(nodeId: u32, propHash: u32, val: T): void {
    const key = propKey(nodeId, propHash);
    if (isFloat<T>()) {
      f64Props.set(key, val as f64);
    } else {
      u32Props.set(key, val as u32);
    }
  }
}

export class GraphNamespace {
  public model: ModelAPI = new ModelAPI();
}

export const graph = new GraphNamespace();
`,
      "utf8",
    );

    fs.writeFileSync(path.join(workDir, "tgg_kernel.ts"), compiled.sourceCode, "utf8");

    const entrySource = `
export * from "./tgg_kernel";
export {
  createCorrespondenceIndex,
  corr_addLink,
  corr_addLinkWithParent,
  corr_findBySource,
  corr_findByTarget,
  corr_markStale,
  corr_markStaleCascading,
  corr_retractBySource,
  corr_retractByTarget,
  corr_getStaleQueueCount,
  corr_getStaleQueueSlot,
  corr_clearStaleQueue,
  corr_reset,
} from "./correspondence";
import { PolyglotArena } from "./polyglot_arena";
import { graph } from "./graph";
import { getNodeType } from "./arena";

export function test_createArena(): usize {
  return changetype<usize>(new PolyglotArena());
}
export function test_createNode(kind: u16): u32 {
  return graph.model.create(kind);
}
export function test_getNodeType(nodeId: u32): u16 {
  return getNodeType(nodeId);
}
export function test_setPropF64(nodeId: u32, propHash: u32, val: f64): void {
  graph.model.setProperty<f64>(nodeId, propHash, val);
}
export function test_getPropF64(nodeId: u32, propHash: u32): f64 {
  return graph.model.getProperty<f64>(nodeId, propHash);
}
export function test_setPropU32(nodeId: u32, propHash: u32, val: u32): void {
  graph.model.setProperty<u32>(nodeId, propHash, val);
}
export function test_getPropU32(nodeId: u32, propHash: u32): u32 {
  return graph.model.getProperty<u32>(nodeId, propHash);
}
`;
    const entryPath = path.join(workDir, "entry.ts");
    const wasmOutPath = path.join(workDir, "tgg_kernel.wasm");
    fs.writeFileSync(entryPath, entrySource, "utf8");

    const ascBin = path.join(repoRoot, "node_modules/.bin", process.platform === "win32" ? "asc.cmd" : "asc");
    execFileSync(ascBin, [entryPath, "-o", wasmOutPath, "--debug", "--exportRuntime", "--runtime", "stub"], {
      cwd: workDir,
      stdio: "pipe",
      timeout: 60_000,
    });

    const wasmBytes = fs.readFileSync(wasmOutPath);
    const { instance } = await WebAssembly.instantiate(wasmBytes, {
      env: {
        abort: (msg: number, file: number, line: number, col: number) => {
          throw new Error(`WASM abort at ${line}:${col} (${msg}, ${file})`);
        },
      },
    });

    const exp = instance.exports as unknown as WasmPolyglotExports & {
      test_createArena: () => number;
      test_createNode: (kind: number) => number;
      test_getNodeType: (nodeId: number) => number;
      test_setPropF64: (nodeId: number, propHash: number, val: number) => void;
      test_getPropF64: (nodeId: number, propHash: number) => number;
      test_setPropU32: (nodeId: number, propHash: number, val: number) => void;
      test_getPropU32: (nodeId: number, propHash: number) => number;
    };

    const corrPtr = exp.createCorrespondenceIndex!(64);
    const arenaPtr = exp.test_createArena();
    const corrBridge = new WasmCorrespondenceBridge(exp, corrPtr);

    const transformer = new PolyglotTransformer();
    transformer.attachWasmTggModule(exp, { corrBridge, arenaPtr });
    assert.strictEqual(transformer.hasWasmTggModule(), true);

    // DJB2 hash matching compile_tgg.ts
    const djb2 = (s: string) => {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      return h >>> 0;
    };

    const srcNode = exp.test_createNode(101);
    exp.test_setPropU32(srcNode, djb2("name"), 4242);
    exp.test_setPropF64(srcNode, djb2("tempC"), 25.0);

    // 1. Live WASM forward dispatch: PartDefinition(101) -> ClassDefinition(202)
    const tgtNode = transformer.dispatchWasmForward(101, srcNode);
    assert.ok(tgtNode && tgtNode > 0, `Expected non-zero target node from WASM forward dispatch, got ${tgtNode}`);
    assert.strictEqual(exp.test_getNodeType(tgtNode!), 202, "Target node should have syntaxType 202");
    assert.strictEqual(exp.test_getPropU32(tgtNode!, djb2("name")), 4242, "String/ID property 'name' copied");
    assert.ok(
      Math.abs(exp.test_getPropF64(tgtNode!, djb2("tempK")) - 298.15) < 1e-6,
      `Expected tempK = 298.15, got ${exp.test_getPropF64(tgtNode!, djb2("tempK"))}`,
    );

    // 2. Live WASM incremental stale propagation (forward: tempC 25 -> 100 => tempK 373.15)
    exp.test_setPropF64(srcNode, djb2("tempC"), 100.0);
    corrBridge.markStale(srcNode);
    const propagatedFwd = transformer.propagateWasmStale(0);
    assert.ok(propagatedFwd !== null && propagatedFwd >= 1, "Forward propagateWasmStale should update stale link");
    assert.ok(
      Math.abs(exp.test_getPropF64(tgtNode!, djb2("tempK")) - 373.15) < 1e-6,
      `Expected propagated tempK = 373.15, got ${exp.test_getPropF64(tgtNode!, djb2("tempK"))}`,
    );

    // 3. Live WASM backward propagation (direction=1: tempK 300.15 => tempC 27.0)
    exp.test_setPropF64(tgtNode!, djb2("tempK"), 300.15);
    corrBridge.markStale(srcNode);
    const propagatedBwd = transformer.propagateWasmStale(1);
    assert.ok(propagatedBwd !== null && propagatedBwd >= 1, "Backward propagateWasmStale(1) should update stale link");
    assert.ok(
      Math.abs(exp.test_getPropF64(srcNode, djb2("tempC")) - 27.0) < 1e-6,
      `Expected backward-propagated tempC = 27.0, got ${exp.test_getPropF64(srcNode, djb2("tempC"))}`,
    );

    // 4. Live WASM retraction
    const retracted = transformer.dispatchWasmRetract(101, srcNode);
    assert.ok(retracted !== null && retracted >= 1, "dispatchWasmRetract should retract correspondence link");
    assert.strictEqual(corrBridge.findBySource(srcNode), 0, "Correspondence link must be cleared after retraction");
  });
});
