// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { ArchiveQueue } from "../src/services/archive-queue.js";

describe("GDPR / CCPA Archive Async Queue & Batch Concurrency", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-batch-test-"));
  const dbDir = path.join(tmpDir, "db");
  const stagingDir = path.join(tmpDir, "archives-staging");
  const cliOutputDir = path.join(tmpDir, "cli-output");

  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(cliOutputDir, { recursive: true });

  const database = new LibraryDatabase(dbDir);
  const queue = new ArchiveQueue({
    maxConcurrency: 2,
    storageDir: stagingDir,
    ttlMs: 3600 * 1000,
  });

  const app = createApp({ database });

  // Provision 5 test users
  const users: { id: number; username: string; email: string }[] = [];
  try {
    for (let i = 1; i <= 5; i++) {
      const u = database.createUser(`user_${i}`, `user_${i}@modelscript.test`, `hash_${i}`, { emailVerified: true });
      users.push(u);
      database.createPost(u.id, `Hello from user_${i} on ModelScript!`);
    }
  } catch (err: any) {
    console.error("SETUP ERROR:", err);
    throw err;
  }

  test("ArchiveQueue enforces concurrency limit and drains async jobs", async () => {
    assert.strictEqual(queue.getConcurrency(), 2);

    // Enqueue 5 jobs
    const jobs = users.map((u) => queue.enqueue(database, u.id, u.username, "zip"));
    assert.strictEqual(jobs.length, 5);

    // Verify initial positions in queue
    assert.strictEqual(jobs[0]?.status === "queued" || jobs[0]?.status === "processing", true);

    // Wait for all 5 jobs to complete
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const allDone = jobs.every((j) => {
        const current = queue.getJob(j.id);
        return current?.status === "completed";
      });
      if (allDone) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Verify all jobs finished successfully
    for (const j of jobs) {
      const finalJob = queue.getJob(j.id);
      assert.strictEqual(finalJob?.status, "completed");
      assert.ok(finalJob.fileSizeBytes && finalJob.fileSizeBytes > 0);
      assert.ok(finalJob.filePath && fs.existsSync(finalJob.filePath));

      // Verify the generated zip is valid and contains offline viewer
      const zip = new AdmZip(finalJob.filePath);
      const entries = zip.getEntries().map((e) => e.entryName);
      assert.ok(entries.includes("index.html"), "Should include offline HTML viewer");
      assert.ok(entries.includes("data/manifest.json"), "Should include manifest.json");
      assert.ok(entries.includes("data/profile.json"), "Should include profile.json");
      assert.ok(entries.includes("data/posts.json"), "Should include posts.json");
    }
  });

  test("API async endpoints (POST /me/export, GET /me/export/status, GET /me/export/download)", async () => {
    const testUser = users[0]!;
    const token = jwt.sign({ id: testUser.id, username: testUser.username, email: testUser.email }, JWT_SECRET, {
      expiresIn: "1h",
    });

    // 1. Enqueue job
    const postRes = await request(app)
      .post("/api/v1/users/me/export")
      .set("Authorization", `Bearer ${token}`)
      .send({ format: "zip" })
      .expect(202);

    assert.strictEqual(postRes.body.success, true);
    assert.ok(postRes.body.job.id);
    assert.ok(postRes.body.job.concurrency >= 1);

    const jobId = postRes.body.job.id;

    // 2. Poll status until completed
    let statusRes: any;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      statusRes = await request(app)
        .get(`/api/v1/users/me/export/status?jobId=${jobId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      if (statusRes.body.job?.status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.strictEqual(statusRes.body.job.status, "completed");
    assert.ok(statusRes.body.job.downloadUrl);
    assert.ok(statusRes.body.concurrency >= 1);

    // 3. Download the staged archive
    const downloadRes = await request(app)
      .get(`/api/v1/users/me/export/download?jobId=${jobId}`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    assert.strictEqual(downloadRes.headers["content-type"], "application/zip");
    assert.ok(Buffer.isBuffer(downloadRes.body) && downloadRes.body.length > 0);
  });

  test("CLI batch script exports all users with concurrency limits", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const scriptPath = path.resolve(repoRoot, "scripts/export-user-data.ts");

    // Run batch exporter with --all and --concurrency 2
    const stdout = execFileSync(
      "npx",
      ["tsx", scriptPath, "--all", "--concurrency", "2", "--output-dir", cliOutputDir, "--sqlite", dbDir, "--quiet"],
      {
        cwd: repoRoot,
        encoding: "utf-8",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );

    assert.ok(stdout.includes("ModelScript GDPR / CCPA Data Archive Batch Processor"));
    assert.ok(stdout.includes("Concurrency:"));
    assert.ok(stdout.includes("Batch Export Summary"));
    assert.ok(stdout.includes("Successful:"));

    // Verify all 5 archives exist in cliOutputDir
    for (const u of users) {
      const archiveFile = path.join(cliOutputDir, `modelscript-archive-${u.username}.zip`);
      assert.ok(fs.existsSync(archiveFile), `Archive should exist: ${archiveFile}`);

      const zip = new AdmZip(archiveFile);
      const entries = zip.getEntries().map((e) => e.entryName);
      assert.ok(entries.includes("index.html"));
      assert.ok(entries.includes("data/manifest.json"));
      assert.ok(entries.includes("data/compliance.json"));
    }
  });
});
