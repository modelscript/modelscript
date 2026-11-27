// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { seedPolyglotUsers } from "../src/seed/index.js";
import { LibraryStorage } from "../src/storage.js";
import { seedMlArenaDemoData } from "../src/util/seed-ml-arena.js";

process.env["NODE_ENV"] = "test";

describe("ML & Arena Demo Seeder (dev:flagship)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("populates all ML & Arena hubs idempotently and serves valid data across all endpoints", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-seed-ml-arena-"));
    tempDirs.push(tmpDir);
    const db = new LibraryDatabase(tmpDir);
    const storage = new LibraryStorage(path.join(tmpDir, "storage"));

    try {
      seedPolyglotUsers(db);
      const first = await seedMlArenaDemoData(db, storage.dataDir);
      assert.equal(first.skipped, false);
      assert.equal(first.campaigns, 3);
      assert.equal(first.challenges, 6);
      assert.ok(first.shards >= 6, `expected >= 6 compiled shards, got ${first.shards}`);
      assert.equal(first.models, 4);
      assert.equal(first.runs, 3);
      assert.equal(first.triggers, 3);
      assert.equal(first.memoryChunks, 8);
      assert.equal(first.peers, 2);

      // Second invocation must be idempotent
      const second = await seedMlArenaDemoData(db, storage.dataDir);
      assert.equal(second.skipped, true);

      const app = createApp({
        database: db,
        storage,
        enableWorkers: false,
        seedStdlibOnBoot: false,
        preloadOpenAlex: false,
      });

      const [
        campaignsRes,
        adjRes,
        lbRes,
        shardsRes,
        modelsRes,
        runsRes,
        triggersRes,
        statsRes,
        chunksRes,
        recipeLbRes,
      ] = await Promise.all([
        request(app).get("/api/v1/rlhf/campaigns"),
        request(app).get("/api/v1/rlhf/adjudication"),
        request(app).get("/api/v1/rlhf/leaderboard"),
        request(app).get("/api/v1/memory/datasets/shards"),
        request(app).get("/api/v1/models"),
        request(app).get("/api/v1/runs"),
        request(app).get("/api/v1/runs/living-triggers"),
        request(app).get("/api/v1/memory/stats"),
        request(app).get("/api/v1/memory/chunks"),
        request(app).get("/api/v1/memory/leaderboards"),
      ]);

      assert.equal(campaignsRes.status, 200);
      assert.equal(campaignsRes.body.campaigns.length, 3);

      assert.equal(adjRes.status, 200);
      assert.equal(adjRes.body.challenges.length, 2);

      assert.equal(lbRes.status, 200);
      assert.ok(lbRes.body.leaderboard.length >= 3);

      assert.equal(shardsRes.status, 200);
      assert.ok(shardsRes.body.shards.length >= 6);
      const firstShardId = shardsRes.body.shards[0].shardId as string;
      const streamRes = await request(app).get(`/api/v1/memory/datasets/shards/${encodeURIComponent(firstShardId)}`);
      assert.equal(streamRes.status, 200);
      assert.ok(streamRes.text.trim().length > 0, "Seeded shard JSONL should stream non-empty rows");

      assert.equal(modelsRes.status, 200);
      assert.equal(modelsRes.body.models.length, 4);

      assert.equal(runsRes.status, 200);
      assert.equal(runsRes.body.runs.length, 3);

      assert.equal(triggersRes.status, 200);
      assert.equal(triggersRes.body.triggers.length, 3);

      assert.equal(statsRes.status, 200);
      assert.equal(statsRes.body.totalChunks, 8);
      assert.equal(statsRes.body.quarantinedChunks, 1);

      assert.equal(chunksRes.status, 200);
      assert.equal(chunksRes.body.chunks.length, 8);

      assert.equal(recipeLbRes.status, 200);
      assert.equal(recipeLbRes.body.entries.length, 3);
    } finally {
      db.close();
    }
  });
});
