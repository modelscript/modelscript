// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import {
  FederatedQueryCacheStore,
  IndexedDBQueryCacheStore,
  MemoryQueryCacheStore,
} from "../src/runtime/wasm_cache_store.js";
import type { Memo } from "../src/runtime/wasm_query_engine.js";

console.log("Testing WASM Salsa Query Cache Stores & Federated Endpoints...");

// Test 1: MemoryQueryCacheStore CRUD
{
  const store = new MemoryQueryCacheStore();
  const memo1: Memo = { value: "result1", revision: 1, verifiedAt: 1, dependencies: [] };
  const memo2: Memo = { value: "result2", revision: 2, verifiedAt: 2, dependencies: [1] };

  await store.setMemo(10, memo1);
  await store.setMemo(20, memo2);

  const m1 = await store.getMemo(10);
  assert.deepStrictEqual(m1, memo1);

  const batch = await store.getMemos([10, 20, 30]);
  assert.strictEqual(batch.size, 2);
  assert.deepStrictEqual(batch.get(10), memo1);
  assert.deepStrictEqual(batch.get(20), memo2);
  assert.strictEqual(batch.has(30), false);

  await store.deleteMemo(10);
  assert.strictEqual(await store.getMemo(10), undefined);

  await store.clearMemos();
  assert.strictEqual((await store.getMemos([20])).size, 0);

  console.log("  ✔ MemoryQueryCacheStore operations passed");
}

// Test 2: FederatedQueryCacheStore caching & missing key delegation
{
  const localStore = new MemoryQueryCacheStore();
  const memoLocal: Memo = { value: "localVal", revision: 1, verifiedAt: 1, dependencies: [] };
  await localStore.setMemo(100, memoLocal);

  const provider = {
    getEndpoints: () => [], // No remote endpoints in offline test
  };

  const federated = new FederatedQueryCacheStore(localStore, provider);

  // Local hit
  const hit = await federated.getMemo(100);
  assert.deepStrictEqual(hit, memoLocal);

  // Missing key with empty endpoints
  const miss = await federated.getMemo(999);
  assert.strictEqual(miss, undefined);

  // Batch get
  const batch = await federated.getMemos([100, 999]);
  assert.strictEqual(batch.size, 1);
  assert.deepStrictEqual(batch.get(100), memoLocal);

  console.log("  ✔ FederatedQueryCacheStore local hit & fallback passed");
}

// Test 3: IndexedDBQueryCacheStore instantiation
{
  const idbStore = new IndexedDBQueryCacheStore("test-db");
  assert.ok(idbStore);
  console.log("  ✔ IndexedDBQueryCacheStore class interface passed");
}

console.log("=== All WASM Cache Store Tests Passed Cleanly ===");
