import type { Memo } from "@modelscript/runtime";
import { LanguageWorkspaceIndex } from "@modelscript/runtime";
import { FederatedQueryCacheStore, MemoryQueryCacheStore } from "@modelscript/runtime/wasm_cache_store.js";
import { WasmQueryEngine } from "@modelscript/runtime/wasm_query_engine.js";
import assert from "node:assert";
import { describe, it } from "node:test";
import { BrowserFileSystem } from "../src/vfs/browser-file-system.js";

describe("Lazy VFS and Federated Cache Remediation", () => {
  it("should lazily decode string contents in BrowserFileSystem", () => {
    const vfs = new BrowserFileSystem();
    const encoder = new TextEncoder();
    const textData = "model Test\n  Real x;\nend Test;";
    const binary = encoder.encode(textData);

    vfs.addFile("/workspace/Test.mo", binary);

    // Verify file exists
    assert.strictEqual(vfs.exists("/workspace/Test.mo"), true);

    // Verify binary is stored directly
    const storedBinary = vfs.readBinary("/workspace/Test.mo");
    assert.strictEqual(storedBinary.byteLength, binary.byteLength);

    // First read triggers lazy decoding
    const decoded = vfs.read("/workspace/Test.mo");
    assert.strictEqual(decoded, textData);

    // Subsequent read returns cached string
    const decoded2 = vfs.read("/workspace/Test.mo");
    assert.strictEqual(decoded2, textData);
  });

  it("should re-allocate symbol IDs upon hydration to prevent collisions", () => {
    const ws = new LanguageWorkspaceIndex();

    // Hydrate first bundle with symbols 1 and 2
    const bundle1 = {
      symbols: new Map([
        [
          1,
          {
            id: 1,
            name: "PackageA",
            kind: "Class",
            ruleName: "class_definition",
            parentId: null,
            startByte: 0,
            endByte: 10,
            exports: [],
            inherits: [],
            metadata: {},
            fieldName: null,
            resourceId: "sources/PackageA/package.mo",
          },
        ],
        [
          2,
          {
            id: 2,
            name: "ModelA",
            kind: "Class",
            ruleName: "class_definition",
            parentId: 1,
            startByte: 0,
            endByte: 10,
            exports: [],
            inherits: [],
            metadata: {},
            fieldName: null,
            resourceId: "sources/PackageA/ModelA.mo",
          },
        ],
      ]),
      byName: new Map([
        ["PackageA", [1]],
        ["ModelA", [2]],
      ]),
      childrenOf: new Map([
        [null, [1]],
        [1, [2]],
      ]),
    };

    // Hydrate second bundle that independently used IDs 1 and 2
    const bundle2 = {
      symbols: new Map([
        [
          1,
          {
            id: 1,
            name: "PackageB",
            kind: "Class",
            ruleName: "class_definition",
            parentId: null,
            startByte: 0,
            endByte: 10,
            exports: [],
            inherits: [],
            metadata: {},
            fieldName: null,
            resourceId: "sources/PackageB/package.mo",
          },
        ],
        [
          2,
          {
            id: 2,
            name: "ModelB",
            kind: "Class",
            ruleName: "class_definition",
            parentId: 1,
            startByte: 0,
            endByte: 10,
            exports: [],
            inherits: [],
            metadata: {},
            fieldName: null,
            resourceId: "sources/PackageB/ModelB.mo",
          },
        ],
      ]),
      byName: new Map([
        ["PackageB", [1]],
        ["ModelB", [2]],
      ]),
      childrenOf: new Map([
        [null, [1]],
        [1, [2]],
      ]),
    };

    ws.hydrate("bundle:PackageA", bundle1);
    ws.hydrate("bundle:PackageB", bundle2);

    const unified = ws.toUnified();

    const symAId = unified.byName.get("PackageA")?.[0];
    const symBId = unified.byName.get("PackageB")?.[0];
    const modelAId = unified.byName.get("ModelA")?.[0];
    const modelBId = unified.byName.get("ModelB")?.[0];

    assert.ok(symAId, "PackageA must be indexed");
    assert.ok(symBId, "PackageB must be indexed");
    assert.ok(modelAId, "ModelA must be indexed");
    assert.ok(modelBId, "ModelB must be indexed");

    // All 4 symbols must have distinct IDs!
    const ids = new Set([symAId, symBId, modelAId, modelBId]);
    assert.strictEqual(ids.size, 4, "All 4 hydrated symbols must have unique IDs");

    const symA = unified.symbols.get(symAId!);
    const symB = unified.symbols.get(symBId!);
    const modelA = unified.symbols.get(modelAId!);
    const modelB = unified.symbols.get(modelBId!);

    // Parent-child relationships must be correctly preserved under new IDs
    assert.strictEqual(modelA!.parentId, symA!.id);
    assert.strictEqual(modelB!.parentId, symB!.id);
    assert.deepStrictEqual(unified.childrenOf.get(symA!.id), [modelA!.id]);
    assert.deepStrictEqual(unified.childrenOf.get(symB!.id), [modelB!.id]);
  });

  it("should chunk large key requests and hydrate memos into WasmQueryEngine", async () => {
    const memStore = new MemoryQueryCacheStore();
    const fetchedBatches: string[][] = [];

    // Save original fetch
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string | URL | Request) => {
        const u = new URL(typeof url === "string" ? url : url.toString());
        const keysParam = u.searchParams.get("keys");
        const keys = keysParam ? keysParam.split(",") : [];
        fetchedBatches.push(keys);

        const memos: Record<string, Memo> = {};
        for (const k of keys) {
          memos[k] = {
            verifiedAt: 1,
            changedAt: 1,
            value: Number(k) * 10,
            revisions: new Map(),
          };
        }
        return new Response(JSON.stringify({ memos }), { status: 200 });
      }) as any;

      const federatedStore = new FederatedQueryCacheStore(memStore, {
        getEndpoints: () => ["http://test-registry.local/memos"],
      });

      // Request 120 keys
      const requestedKeys = Array.from({ length: 120 }, (_, i) => i + 1);
      const results = await federatedStore.getMemos(requestedKeys);

      assert.strictEqual(results.size, 120, "Should retrieve all 120 keys");
      assert.strictEqual(fetchedBatches.length, 3, "120 keys chunked by 50 should produce 3 batches");
      assert.strictEqual(fetchedBatches[0].length, 50);
      assert.strictEqual(fetchedBatches[1].length, 50);
      assert.strictEqual(fetchedBatches[2].length, 20);

      // Verify localStore has been populated
      const localCached = await memStore.getMemo(1);
      assert.strictEqual(localCached?.value, 10);

      // Test WasmQueryEngine hydrateMemos
      const mockIndex = {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      };
      const engine = new WasmQueryEngine(mockIndex, new Map());
      engine.hydrateMemos(results);

      // Verify memos are in engine
      assert.strictEqual(engine.memos.has(1), true);
      assert.strictEqual(engine.memos.get(1)?.value, 10);
      assert.strictEqual(engine.memos.has(120), true);
      assert.strictEqual(engine.memos.get(120)?.value, 1200);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
