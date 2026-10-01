// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { LibraryStorage } from "../src/storage.js";

test("Web Cloud Simulation Lifecycle & Telemetry", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-cloud-sim-test-"));
  const db = new LibraryDatabase(tmpDir);
  const storage = new LibraryStorage(tmpDir);
  const jobQueue = new JobQueue();
  const app = createApp({ database: db, storage, jobQueue });

  t.after(async () => {
    await new Promise((r) => setTimeout(r, 600));
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const devUser = db.createUser("dev", "dev@modelscript.org", "pwd", "Developer");

  await t.test("rejects submission with 400 when modelName is missing", async () => {
    const res = await request(app).post("/api/v1/simulate").send({
      modelSource: "model Test end Test;",
    });

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes("Missing required field: modelName"));
  });

  await t.test("rejects submission with 402 when user has insufficient compute credits", async () => {
    // Drop user balance to 0.05 credits
    db.setUserCreditBalance(devUser.id, 0.05);

    // hpc-mpi-64 costs 150 credits/hr -> min charge 7.5 credits, dev user only has 0.05
    const res = await request(app).post("/api/v1/simulate").send({
      modelName: "TurbulentCFD",
      modelSource: "model TurbulentCFD end TurbulentCFD;",
      profile: "hpc-mpi-64",
    });

    assert.equal(res.status, 402);
    assert.equal(res.body.error, "Payment Required: Insufficient Compute Credits");
    assert.ok(res.body.message.includes("Insufficient compute credits"));
    assert.equal(res.body.balance, 0.05);
    assert.ok(res.body.required >= 7.5);
    assert.equal(res.body.profile, "hpc-mpi-64");
  });

  await t.test("submits simulation job and tracks status in jobQueue", async () => {
    // Restore user balance to 100 credits
    db.setUserCreditBalance(devUser.id, 100.0);

    const res = await request(app).post("/api/v1/simulate").send({
      modelName: "SimpleModel",
      modelSource: "model SimpleModel Real x(start=1.0); equation der(x) = -x; end SimpleModel;",
      profile: "standard",
      numberOfIntervals: 250,
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.jobId);
    assert.ok(res.body.jobId.startsWith("simulate-adhoc-0.0-SimpleModel-"));

    // Check polling status immediately
    const pollRes = await request(app).get(`/api/v1/simulate/${res.body.jobId}`);
    assert.equal(pollRes.status, 200);
    assert.ok(["pending", "processing", "queued", "running", "completed", "failed"].includes(pollRes.body.status));
  });

  await t.test("retrieves completed simulation status and telemetry accounting", async () => {
    // Manually register a completed job in the queue to verify telemetry contract
    const testJobId = "simulate-adhoc-0.0-CompletedModel-123456";
    const csvFile = path.join(tmpDir, "CompletedModel_res.csv");
    fs.writeFileSync(csvFile, "time,x,der(x)\n0.0,1.0,-1.0\n0.5,0.606,-0.606\n1.0,0.367,-0.367\n", "utf8");

    // Enqueue simulated completed job state
    jobQueue.enqueue(testJobId, async () => {});
    const status = jobQueue.getStatus(testJobId);
    assert.ok(status);
    status.status = "completed";
    status.resultPath = csvFile;
    status.profile = "standard";
    status.usage = {
      cpuSeconds: 1.45,
      gpuSeconds: 0,
      costCredits: 0.004,
      exitCode: 0,
    };

    const statusRes = await request(app).get(`/api/v1/simulate/${testJobId}`);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.status, "completed");
    assert.equal(statusRes.body.profile, "standard");
    assert.equal(statusRes.body.usage.cpuSeconds, 1.45);
    assert.equal(statusRes.body.usage.costCredits, 0.004);
    assert.equal(statusRes.body.usage.exitCode, 0);

    // Download CSV results
    const csvRes = await request(app).get(`/api/v1/simulate/${testJobId}/result`);
    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.text.includes("time,x,der(x)"));
    assert.ok(csvRes.text.includes("0.5,0.606,-0.606"));
  });

  await t.test("returns 404 for unknown job ID", async () => {
    const res = await request(app).get("/api/v1/simulate/unknown-job-999");
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "Job not found");
  });
});
