// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue, reconcilePendingJobs } from "../src/jobs.js";
import { LibraryStorage } from "../src/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stubWorkerScript = path.resolve(__dirname, "fixtures/resilience-workers.cjs");

describe("JobQueue boot-time reconciliation (reconcilePendingJobs)", () => {
  test("re-enqueues unindexed published releases and skips already indexed releases", async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-reconcile-test-"));
    const dbDir = path.join(tmpDir, "db");
    const storageDir = path.join(tmpDir, "storage");
    const db = new LibraryDatabase(dbDir);
    const storage = new LibraryStorage(storageDir);
    const queue = new JobQueue({ concurrency: 1 });

    t.after(() => {
      queue.clear();
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const createZip = (pkgName: string) => {
      const zip = new AdmZip();
      zip.addFile("package.mo", Buffer.from(`package ${pkgName}\nend ${pkgName};\n`));
      return zip.toBuffer();
    };

    // 1. Unindexed package release (stored in storage + DB, 0 classes)
    await storage.store("UnindexedLib", "1.0.0", createZip("UnindexedLib"));
    db.saveLibraryRelease({
      libraryName: "UnindexedLib",
      libraryVersion: "1.0.0",
      contentHash: "sha256:aaa",
      signature: null,
      publishedBy: null,
    });

    // 2. Indexed package release (stored in storage + DB, has indexed class)
    await storage.store("IndexedLib", "2.0.0", createZip("IndexedLib"));
    db.saveLibraryRelease({
      libraryName: "IndexedLib",
      libraryVersion: "2.0.0",
      contentHash: "sha256:bbb",
      signature: null,
      publishedBy: null,
    });
    db.storeLibraryMetadata("IndexedLib", "2.0.0", [
      {
        className: "IndexedLib.ModelA",
        classKind: "model",
        description: "Already indexed",
        documentation: null,
        baseClasses: [],
        components: [],
      },
    ]);

    // Spy on enqueueProcess so we don't need to run real Modelica indexing
    const enqueuedCalls: Array<{ key: string; data: Record<string, unknown> }> = [];
    const origEnqueueProcess = queue.enqueueProcess.bind(queue);
    queue.enqueueProcess = (key, scriptPath, data, options) => {
      enqueuedCalls.push({ key, data });
      // Use stub worker that succeeds immediately
      origEnqueueProcess(key, scriptPath, { mode: "success" }, options);
    };

    const result = await reconcilePendingJobs(db, storage, queue, {
      workerScript: stubWorkerScript,
      priority: "low",
    });

    assert.strictEqual(result.scanned, 2);
    assert.deepStrictEqual(result.enqueued, ["UnindexedLib@1.0.0"]);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(enqueuedCalls.length, 1);
    assert.strictEqual(enqueuedCalls[0]?.key, "UnindexedLib@1.0.0");
    assert.strictEqual(enqueuedCalls[0]?.data["name"], "UnindexedLib");
    assert.strictEqual(enqueuedCalls[0]?.data["version"], "1.0.0");
  });
});
