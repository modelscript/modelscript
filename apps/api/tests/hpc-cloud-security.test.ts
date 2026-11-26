// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { HpcEngine } from "../src/services/hpc/hpc-engine.js";

test("HPC Cloud Security, Tenant Isolation & Backend Selection", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-cloud-security-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("POST /api/v1/cloud/dispatch rejects unknown domain 'bypass' with 400", async () => {
    const res = await request(app)
      .post("/api/v1/cloud/dispatch")
      .send({
        domain: "bypass",
        name: "UnauthorizedDomainJob",
        sourceContent: "model M Real x; equation der(x) = -x; end M;",
      })
      .expect(400);

    assert.ok(
      typeof res.body.error === "string" && res.body.error.includes("Invalid domain 'bypass'"),
      `Expected invalid domain error, got: ${JSON.stringify(res.body)}`,
    );
  });

  await t.test("JobsRepository.createArtifactViewFromJob enforces tenant ownership", () => {
    const userA = db.createUser("tenant_user_a", "user_a@example.com", "hash_a");
    const userB = db.createUser("tenant_user_b", "user_b@example.com", "hash_b");

    const jobId = db.createJob("CAE-SU2-Wing", "SUCCESS", "SIMULATE", "api", null, { solver: "su2" }, userA.id);

    assert.throws(
      () => db.createArtifactViewFromJob(userB.id, jobId, { title: "Stolen View" }),
      /Forbidden.*does not belong to user/i,
      "User B must be rejected from creating an artifact view from User A's job",
    );

    const ownView = db.createArtifactViewFromJob(userA.id, jobId, { title: "Owner View" });
    assert.ok(ownView.artifactId, "User A should be able to create an artifact view from their own job");
  });

  await t.test(
    "HpcEngine respects explicit HPC_BACKEND=local over RAY_DASHBOARD_URL and throws on unknown backend",
    () => {
      const origBackend = process.env["HPC_BACKEND"];
      const origRayUrl = process.env["RAY_DASHBOARD_URL"];
      try {
        process.env["HPC_BACKEND"] = "local";
        process.env["RAY_DASHBOARD_URL"] = "http://ray-head.cluster.internal:8265";

        const localEngine = new HpcEngine();
        assert.strictEqual(
          localEngine.getDriver().type,
          "local",
          "RAY_DASHBOARD_URL must not override explicit HPC_BACKEND=local",
        );

        process.env["HPC_BACKEND"] = "nonexistent-scheduler";
        assert.throws(
          () => new HpcEngine(),
          /Unknown HPC_BACKEND 'nonexistent-scheduler'/i,
          "Unknown HPC_BACKEND must throw an explicit error",
        );
      } finally {
        if (origBackend !== undefined) {
          process.env["HPC_BACKEND"] = origBackend;
        } else {
          delete process.env["HPC_BACKEND"];
        }
        if (origRayUrl !== undefined) {
          process.env["RAY_DASHBOARD_URL"] = origRayUrl;
        } else {
          delete process.env["RAY_DASHBOARD_URL"];
        }
      }
    },
  );
});
