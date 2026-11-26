// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BrowserOpfsDatasetLoader, type RemoteDatasetShardInfo } from "../src/workbench/util/opfs-dataset-loader.js";

describe("BrowserOpfsDatasetLoader (HTTP 206 Range Streaming + Dynamic-m Bucketing)", () => {
  it("streams a shard via multiple HTTP 206 Range chunks and yields m_init-bucketed mini-batches", async () => {
    const rows = [
      {
        example_id: "e3",
        uri: "c.mo",
        dialect: "modelica",
        m_init: 12,
        token_ids: [1],
        group_ids: [1],
        rel_type_ids: [1],
        rel_signs: [1],
        formal_cert: null,
      },
      {
        example_id: "e1",
        uri: "a.mo",
        dialect: "modelica",
        m_init: 2,
        token_ids: [2],
        group_ids: [1],
        rel_type_ids: [1],
        rel_signs: [1],
        formal_cert: null,
      },
      {
        example_id: "e4",
        uri: "d.mo",
        dialect: "modelica",
        m_init: 14,
        token_ids: [3],
        group_ids: [1],
        rel_type_ids: [1],
        rel_signs: [1],
        formal_cert: null,
      },
      {
        example_id: "e2",
        uri: "b.mo",
        dialect: "modelica",
        m_init: 3,
        token_ids: [4],
        group_ids: [1],
        rel_type_ids: [1],
        rel_signs: [1],
        formal_cert: null,
      },
    ];
    const payload = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const fullBytes = new TextEncoder().encode(payload);

    const shard: RemoteDatasetShardInfo = {
      shardId: "deadbeef12345678",
      recipeName: "@ms/test-recipe",
      recipeVersion: "1.0.0",
      datasetKind: "training-recipe",
      dialect: "modelica",
      mMin: 2,
      mMax: 14,
      exampleCount: 4,
      byteSize: fullBytes.byteLength,
      downloadUrl: "/api/v1/memory/datasets/shards/deadbeef12345678",
    };

    const originalFetch = globalThis.fetch;
    let rangeCalls = 0;
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        const rangeHeader = (init?.headers as Record<string, string> | undefined)?.["Range"] ?? "";
        const match = rangeHeader.match(/^bytes=(\d+)-(\d+)$/);
        assert.ok(match, `Expected Range header, got '${rangeHeader}'`);
        rangeCalls++;
        const start = Number(match[1]);
        const end = Math.min(fullBytes.byteLength - 1, Number(match[2]));
        const slice = fullBytes.slice(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: { "Content-Range": `bytes ${start}-${end}/${fullBytes.byteLength}` },
        });
      }) as typeof fetch;

      const loader = new BrowserOpfsDatasetLoader("http://localhost:3001");
      const batches = [];
      // Force multi-chunk streaming with tiny 128-byte range chunks
      const rawText = await loader.ensureShardCached(shard, undefined, 128);
      assert.equal(rawText, payload);
      assert.ok(rangeCalls >= 3, `Expected >= 3 Range calls, got ${rangeCalls}`);

      // Second call hits cache with zero extra fetch calls
      const callsBefore = rangeCalls;
      for await (const batch of loader.streamMiniBatches(shard, 2, 32)) {
        batches.push(batch);
      }
      assert.equal(rangeCalls, callsBefore, "Expected cache hit on second read");
      assert.equal(batches.length, 2);
      assert.equal(batches[0]!.mBatchMax, 3);
      assert.equal(batches[1]!.mBatchMax, 14);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
