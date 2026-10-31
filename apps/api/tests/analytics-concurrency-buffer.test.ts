// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env["NODE_ENV"] = "test";

import { LibraryDatabase } from "../src/database.js";
import { AnalyticsBuffer } from "../src/services/analytics-buffer.js";

test("AnalyticsBuffer: In-Memory Write Coalescing & High-Concurrency Telemetry", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-buffer-test-"));
  const dbDir = path.join(tmpDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);

  t.after(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const alice = db.createUser("alice", "alice@example.com", "hash", { emailVerified: true });
  const post1 = db.createPost(alice.id, "High concurrency post 1");
  const post2 = db.createPost(alice.id, "High concurrency post 2");

  await t.test("Coalesces 1,000 concurrent post views into in-memory buffer without SQLite contention", async () => {
    const buffer = db.analyticsBuffer;
    const initialPost = db.getPost(post1.id);
    const initialViews = initialPost?.view_count ?? 0;

    // Simulate 1,000 concurrent views across post1 and post2 from various locations
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 600; i++) {
      tasks.push(
        Promise.resolve().then(() => {
          buffer.incrementPostView(post1.id, "US", "CA");
        }),
      );
    }
    for (let i = 0; i < 400; i++) {
      tasks.push(
        Promise.resolve().then(() => {
          buffer.incrementPostView(post2.id, "DE", "BY");
        }),
      );
    }

    await Promise.all(tasks);

    // Buffer has accumulated deltas in RAM
    assert.ok(buffer.hasPostPending(post1.id));
    assert.ok(buffer.hasPostPending(post2.id));
    assert.ok(buffer.pendingCount > 0);

    // Read-through consistency: calling getPost automatically flushes pending buffer deltas
    const updatedPost1 = db.getPost(post1.id);
    assert.strictEqual(updatedPost1?.view_count, initialViews + 600);

    const updatedPost2 = db.getPost(post2.id);
    assert.strictEqual(updatedPost2?.view_count, 400);

    // Verify location stats parity
    const locStats1 = db.getPostLocationStats(post1.id);
    assert.strictEqual(locStats1.length, 1);
    assert.strictEqual(locStats1[0]?.country, "US");
    assert.strictEqual(locStats1[0]?.views, 600);

    const regStats1 = db.getPostRegionStats(post1.id);
    assert.strictEqual(regStats1.length, 1);
    assert.strictEqual(regStats1[0]?.region, "CA");
    assert.strictEqual(regStats1[0]?.views, 600);

    const locStats2 = db.getPostLocationStats(post2.id);
    assert.strictEqual(locStats2.length, 1);
    assert.strictEqual(locStats2[0]?.country, "DE");
    assert.strictEqual(locStats2[0]?.views, 400);
  });

  await t.test("Coalesces unified page views across web and docs surfaces with unique tracking", async () => {
    const buffer = db.analyticsBuffer;

    // 300 hits to /explore (100 unique, 200 repeat) from JP
    for (let i = 0; i < 300; i++) {
      buffer.recordPageView({
        surface: "web",
        path: "/explore",
        isUniqueVisitor: i < 100,
        countryCode: "JP",
        regionCode: "13",
        date: "2026-10-30",
      });
    }

    // 200 hits to /guide/getting-started (50 unique) from GB
    for (let i = 0; i < 200; i++) {
      buffer.recordPageView({
        surface: "docs",
        path: "/guide/getting-started",
        isUniqueVisitor: i < 50,
        countryCode: "GB",
        regionCode: "ENG",
        date: "2026-10-30",
      });
    }

    // getPageAnalyticsSummary flushes buffer automatically before querying
    const summary = db.getPageAnalyticsSummary(7);
    assert.ok(summary.totalViews >= 500);
    assert.ok(summary.uniqueVisitors >= 150);
    assert.ok(summary.webViews >= 300);
    assert.ok(summary.docsViews >= 200);

    const jpStats = summary.locationStats.find((c) => c.country === "JP");
    assert.ok(jpStats && jpStats.views >= 300);

    const gbStats = summary.locationStats.find((c) => c.country === "GB");
    assert.ok(gbStats && gbStats.views >= 200);
  });

  await t.test("Coalesces package download events and flushes cleanly on getPackageStats", async () => {
    const buffer = db.analyticsBuffer;
    const pkgName = "FluidDynamics";

    for (let i = 0; i < 150; i++) {
      buffer.recordPackageDownload(pkgName, "1.0.0", "2026-10-30");
    }
    for (let i = 0; i < 75; i++) {
      buffer.recordPackageDownload(pkgName, "2.0.0", "2026-10-30");
    }

    const stats = db.getPackageStats(pkgName, 7);
    assert.strictEqual(stats.totalDownloads, 225);
    assert.strictEqual(stats.versionBreakdown["1.0.0"], 150);
    assert.strictEqual(stats.versionBreakdown["2.0.0"], 75);
  });

  await t.test("Threshold-triggered automatic flush when pendingCount reaches maxBufferSize", () => {
    let batchFlushed = false;
    const mockTarget = {
      flushAnalyticsBatch: () => {
        batchFlushed = true;
      },
    };

    const thresholdBuffer = new AnalyticsBuffer(mockTarget, {
      maxBufferSize: 20,
      flushIntervalMs: 0,
      autoStart: false,
    });

    // Ingest 19 items: should not flush yet
    for (let i = 1; i <= 19; i++) {
      thresholdBuffer.incrementPostView(i);
    }
    assert.strictEqual(batchFlushed, false);
    assert.strictEqual(thresholdBuffer.pendingCount, 19);

    // 20th item hits maxBufferSize: triggers synchronous flush automatically
    thresholdBuffer.incrementPostView(20);
    assert.strictEqual(batchFlushed, true);
    assert.strictEqual(thresholdBuffer.pendingCount, 0);
  });

  await t.test("Graceful shutdown flushes remaining in-memory deltas via stop()", () => {
    let flushedCount = 0;
    const mockTarget = {
      flushAnalyticsBatch: (batch: any) => {
        flushedCount += batch.postViews.length;
      },
    };

    const shutdownBuffer = new AnalyticsBuffer(mockTarget, {
      maxBufferSize: 500,
      flushIntervalMs: 10000,
      autoStart: true,
    });

    shutdownBuffer.incrementPostView(888);
    shutdownBuffer.incrementPostView(999);
    assert.strictEqual(shutdownBuffer.pendingCount, 2);

    // Invoking stop() clears the timer and executes a final flushSync()
    shutdownBuffer.stop();
    assert.strictEqual(shutdownBuffer.pendingCount, 0);
    assert.strictEqual(flushedCount, 2);
  });

  await t.test("Respects environment variable overrides for flush interval and buffer size", () => {
    const origInterval = process.env["ANALYTICS_FLUSH_INTERVAL_MS"];
    const origSize = process.env["ANALYTICS_MAX_BUFFER_SIZE"];

    try {
      process.env["ANALYTICS_FLUSH_INTERVAL_MS"] = "3500";
      process.env["ANALYTICS_MAX_BUFFER_SIZE"] = "750";

      const envBuffer = new AnalyticsBuffer({ flushAnalyticsBatch: () => {} }, { autoStart: false });
      assert.strictEqual(envBuffer.flushIntervalMs, 3500);
      assert.strictEqual(envBuffer.maxBufferSize, 750);
    } finally {
      if (origInterval === undefined) {
        delete process.env["ANALYTICS_FLUSH_INTERVAL_MS"];
      } else {
        process.env["ANALYTICS_FLUSH_INTERVAL_MS"] = origInterval;
      }
      if (origSize === undefined) {
        delete process.env["ANALYTICS_MAX_BUFFER_SIZE"];
      } else {
        process.env["ANALYTICS_MAX_BUFFER_SIZE"] = origSize;
      }
    }
  });

  await t.test("Skips deleted posts during flushSync without foreign-key poisoning", () => {
    const survivingPost = db.createPost(alice.id, "Surviving post");
    const ephemeralPost = db.createPost(alice.id, "Ephemeral post to be deleted");

    db.incrementPostView(survivingPost.id, "US", "NY");
    db.incrementPostView(ephemeralPost.id, "CA", "ON");

    // Delete the ephemeral post before the buffer flushes
    db.db.prepare("DELETE FROM posts WHERE id = ?").run(ephemeralPost.id);

    // Flush should succeed cleanly without FOREIGN KEY constraint failure
    db.analyticsBuffer.flushSync();
    assert.strictEqual(db.analyticsBuffer.pendingCount, 0);

    const surviving = db.getPost(survivingPost.id);
    assert.strictEqual(surviving?.view_count, 1);
  });
});
