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
import { patchWebviewPreHtml, renderWorkbenchHtml } from "../src/routes/ide-workbench.js";
import { LibraryStorage } from "../src/storage.js";

test("Unified Cloud Gateway API Lifecycle", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-gateway-test-"));
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

  await t.test("GET /api/v1/cloud/profiles returns compute profiles with hardware specs", async () => {
    const res = await request(app).get("/api/v1/cloud/profiles");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.profiles));
    assert.ok(res.body.profiles.length >= 3);

    const standard = res.body.profiles.find((p: any) => p.id === "standard");
    assert.ok(standard);
    assert.equal(standard.cpus, 4);
    assert.ok(standard.costCreditsPerHour > 0);

    const gpu = res.body.profiles.find((p: any) => p.id === "gpu-a100");
    assert.ok(gpu);
    assert.equal(gpu.gpus, 1);
  });

  await t.test("GET /api/v1/cloud/balance returns user wallet balance", async () => {
    const res = await request(app).get("/api/v1/cloud/balance");
    assert.equal(res.status, 200);
    assert.ok(res.body.balance !== undefined);
  });

  await t.test("POST /api/v1/cloud/dispatch rejects missing name with 400", async () => {
    const res = await request(app).post("/api/v1/cloud/dispatch").send({
      domain: "modelica",
      sourceContent: "model Test end Test;",
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes("Missing required parameter"));
  });

  await t.test("POST /api/v1/cloud/dispatch rejects insufficient credits with 402", async () => {
    db.setUserCreditBalance(devUser.id, 0.01);
    const res = await request(app).post("/api/v1/cloud/dispatch").send({
      domain: "modelica",
      name: "HighEndClusterSim",
      profile: "hpc-mpi-64",
      sourceContent: "model HighEndClusterSim end HighEndClusterSim;",
    });
    assert.equal(res.status, 402);
    assert.equal(res.body.error, "Payment Required: Insufficient Compute Credits");
    assert.equal(res.body.profile, "hpc-mpi-64");
  });

  await t.test("POST /api/v1/cloud/dispatch accepts valid submission with 202 and returns jobId", async () => {
    db.setUserCreditBalance(devUser.id, 100.0);
    const res = await request(app).post("/api/v1/cloud/dispatch").send({
      domain: "modelica",
      name: "RC_Circuit",
      profile: "standard",
      sourceContent: "model RC_Circuit parameter Real R = 10; end RC_Circuit;",
    });
    assert.equal(res.status, 202);
    assert.ok(res.body.jobId);
    assert.equal(res.body.status, "queued");
    assert.ok(res.body.streamUrl.includes(res.body.jobId));

    const jobId = res.body.jobId;

    // Check job list
    const listRes = await request(app).get("/api/v1/cloud/jobs");
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.jobs));
    const found = listRes.body.jobs.find((j: any) => j.jobId === jobId);
    assert.ok(found);
    assert.equal(found.name, "RC_Circuit");

    // Check single job
    const jobRes = await request(app).get(`/api/v1/cloud/jobs/${jobId}`);
    assert.equal(jobRes.status, 200);
    assert.equal(jobRes.body.jobId, jobId);

    // Cancel job
    const cancelRes = await request(app).post(`/api/v1/cloud/jobs/${jobId}/cancel`);
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.success, true);
  });

  await t.test(
    "IDE workbench and webview pre/index.html allow same-origin parentOrigin and suppress CDN CORS fetches",
    async () => {
      const sampleUnpatched = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-TaWGDzV7c9rUH2q/5ygOyYUHSyHIqBMYfucPh3lnKvU=' 'self';">\nif (hostname === parentOriginHash || hostname.startsWith(parentOriginHash + '.')) { return start(parentOrigin); }`;
      const sampleLocalhostOnly = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'self';">\nif (hostname === "localhost" || hostname === "127.0.0.1" || hostname === parentOriginHash || hostname.startsWith(parentOriginHash + '.')) { return start(parentOrigin); }`;

      for (const sample of [sampleUnpatched, sampleLocalhostOnly]) {
        const patched = patchWebviewPreHtml(sample);
        assert.ok(patched.includes("location.origin === parentOrigin"));
        assert.ok(patched.includes("https://static.cloudflareinsights.com"));
        assert.equal(patchWebviewPreHtml(patched), patched);
      }

      const { status, html } = renderWorkbenchHtml("https", "ansatz.social", null);
      if (status === 200) {
        assert.ok(html.includes("&quot;extensionsGallery&quot;"));
        assert.ok(html.includes("&quot;chatParticipantRegistry&quot;:&quot;&quot;"));
        assert.ok(html.includes("&quot;github.vscode-pull-request-github&quot;:[]"));
      }

      const preRes = await request(app).get("/vscode-static/out/vs/workbench/contrib/webview/browser/pre/index.html");
      if (preRes.status === 200) {
        assert.ok(preRes.text.includes("location.origin === parentOrigin"));
        assert.ok(preRes.text.includes("https://static.cloudflareinsights.com"));
        assert.ok(String(preRes.headers["cache-control"]).includes("no-store"));
      }

      const lspPkgRes = await request(app).get("/lsp/package.json");
      if (lspPkgRes.status === 200) {
        assert.equal(lspPkgRes.headers["cross-origin-opener-policy"], "same-origin");
        assert.equal(lspPkgRes.headers["cross-origin-embedder-policy"], "credentialless");
      }
    },
  );

  await t.test("POST /api/v1/analytics/pageview succeeds without auth in NODE_ENV=production", async () => {
    const prevEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const pageviewRes = await request(app).post("/api/v1/analytics/pageview").send({
        path: "/morsel",
        referrer: "",
      });
      assert.equal(pageviewRes.status, 202);

      const sysmlProjectRes = await request(app).post("/projects").send({
        name: "UnauthorizedProject",
      });
      assert.ok(
        sysmlProjectRes.status === 401 || sysmlProjectRes.status === 402,
        `Expected 401 or 402 for unauthenticated POST /projects in production, got ${sysmlProjectRes.status}`,
      );
    } finally {
      if (prevEnv === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = prevEnv;
      }
    }
  });
});
