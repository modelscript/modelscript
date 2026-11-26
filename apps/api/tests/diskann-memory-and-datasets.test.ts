// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

test("Milestone #2: DiskANN NVMe Memory, Semver Pinning, RBAC Isolation, Latent Query & Dataset Shard Compilation", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diskann-memory-test-"));
  const storageDir = path.join(tmpDir, "storage");
  const db = new LibraryDatabase(tmpDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, libraryStorage: storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  const user = db.createUser("ml_engineer", "ml@modelscript.test", "hash_pw", "ML Engineer");
  assert.ok(user);
  const authHeader = `Bearer ${jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`;

  await t.test("indexes packages via git diff and enforces exact semver lockfile pinning", async () => {
    await request(app)
      .post("/api/v1/memory/index/git-diff")
      .set("Authorization", authHeader)
      .send({
        packageName: "@ms/thermal-pack",
        packageVersion: "1.0.0",
        gitSha: "abc111",
        formalVerified: true,
        changes: [
          {
            path: "docs/HeatCapacitor.md",
            status: "A",
            content:
              "---\nsymbols: [HeatCapacitor, HeatPort_a]\n---\nHeatCapacitor v1.0.0 uses port HeatPort_a for legacy thermal conduction.",
          },
          {
            path: "ontology/thermal.owl",
            status: "A",
            content: "SubClassOf(:HeatCapacitor :ThermalStorage)",
          },
        ],
      })
      .expect(200);

    await request(app)
      .post("/api/v1/memory/index/git-diff")
      .set("Authorization", authHeader)
      .send({
        packageName: "@ms/thermal-pack",
        packageVersion: "2.0.0",
        gitSha: "def222",
        formalVerified: true,
        changes: [
          {
            path: "docs/HeatCapacitor.md",
            status: "A",
            content:
              "---\nsymbols: [HeatCapacitor, ThermalPort]\n---\nHeatCapacitor v2.0.0 migrated to ThermalPort with nonlinear Cp(T).",
          },
        ],
      })
      .expect(200);

    // Query pinned strictly to v1.0.0 -> must NEVER return v2.0.0 chunks
    const pinV1 = await request(app)
      .post("/api/v1/memory/query")
      .send({
        mode: "hybrid",
        textQuery: "HeatCapacitor HeatPort_a legacy thermal conduction",
        packagePins: { "@ms/thermal-pack": "1.0.0" },
        includeSocialPosts: false,
        topK: 5,
      })
      .expect(200);

    assert.equal(pinV1.body.backend, "diskann");
    assert.equal(pinV1.body.chunks.length, 2);
    for (const ch of pinV1.body.chunks) {
      assert.equal(ch.packageVersion, "1.0.0");
    }
    assert.match(pinV1.body.chunks[0].content, /HeatPort_a/);

    // Incremental git-diff deletion removes v1.0.0 doc cleanly
    const delRes = await request(app)
      .post("/api/v1/memory/index/git-diff")
      .set("Authorization", authHeader)
      .send({
        packageName: "@ms/thermal-pack",
        packageVersion: "1.0.0",
        changes: [{ path: "docs/HeatCapacitor.md", status: "D" }],
      })
      .expect(200);
    assert.equal(delRes.body.deletedChunks, 1);
  });

  await t.test("supports latent W_q vector queries over verified social RLHF fixes", async () => {
    const latentVec = Array.from({ length: 256 }, (_, i) => (i === 7 ? 0.9 : i === 13 ? 0.43589 : 0));

    await request(app)
      .post("/api/v1/memory/index/social")
      .set("Authorization", authHeader)
      .send({
        sourceKind: "rlhf-verified-fix",
        sourceUri: "social://rlhf/fix/42",
        dialect: "scad",
        content: "Verified CAD fix: clamp fillet_radius <= 0.45 * wall_thickness to prevent non-manifold shells.",
        symbolTags: ["fillet_radius", "wall_thickness"],
        formalVerified: true,
        embedding: latentVec,
      })
      .expect(201);

    const latentRes = await request(app)
      .post("/api/v1/memory/query")
      .send({
        mode: "latent",
        latentVector: latentVec,
        includeSocialPosts: true,
        topK: 3,
      })
      .expect(200);

    assert.equal(latentRes.body.backend, "diskann");
    assert.ok(latentRes.body.chunks.length >= 1);
    assert.equal(latentRes.body.chunks[0].sourceUri, "social://rlhf/fix/42");
    assert.equal(latentRes.body.chunks[0].formalVerified, true);
    assert.ok(latentRes.body.chunks[0].score > 0.95);
    assert.ok(latentRes.body.latencyMs < 50, `Expected low latency, got ${latentRes.body.latencyMs}ms`);
  });

  await t.test("enforces strict RBAC tenant isolation on private org chunks", async () => {
    await request(app)
      .post("/api/v1/memory/index/social")
      .set("Authorization", authHeader)
      .set("x-modelscript-org-id", "42")
      .send({
        sourceKind: "social-post",
        sourceUri: "org://42/secret-turbine-blade",
        dialect: "step",
        content: "Proprietary Org42 turbine cooling channel clearance is 0.12mm.",
        tenantScope: "org",
        orgId: 42,
      })
      .expect(201);

    // Public or wrong org must NOT retrieve org 42's chunk
    const wrongOrg = await request(app)
      .post("/api/v1/memory/query")
      .set("x-modelscript-org-id", "99")
      .send({ mode: "hybrid", textQuery: "Proprietary Org42 turbine cooling channel", topK: 10 })
      .expect(200);
    assert.equal(
      wrongOrg.body.chunks.some((c: { sourceUri: string }) => c.sourceUri === "org://42/secret-turbine-blade"),
      false,
    );

    // Matching org 42 retrieves it cleanly
    const rightOrg = await request(app)
      .post("/api/v1/memory/query")
      .set("x-modelscript-org-id", "42")
      .send({ mode: "hybrid", textQuery: "Proprietary Org42 turbine cooling channel", topK: 10 })
      .expect(200);
    assert.equal(
      rightOrg.body.chunks.some((c: { sourceUri: string }) => c.sourceUri === "org://42/secret-turbine-blade"),
      true,
    );
  });

  await t.test(
    "compiles deterministic m_init-bucketed dataset shards with governance & HTTP Range streaming",
    async () => {
      // 1. Governance block check (allowPretrain: false -> 403)
      await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/blocked-corpus",
          datasetKind: "dataset-pretrain",
          aiGovernance: { allowRag: true, allowPretrain: false, allowPosttrain: false, tenantScope: "public" },
          files: [{ uri: "a.mo", dialect: "modelica", source: "model A Real x; equation x = 1; end A;" }],
        })
        .expect(403);

      // 2. Compile mixed valid + invalid corpus into m_init-bucketed shards
      const files = [
        { uri: "broken.mo", dialect: "modelica", source: "model Broken Real x; end WrongEnd;" },
        { uri: "tiny1.mo", dialect: "modelica", source: "model T1 Real x; equation x = 1; end T1;" },
        { uri: "tiny2.scad", dialect: "scad", source: "wall_thickness = 2.0; cube([10, 10, wall_thickness]);" },
        {
          uri: "complex1.mo",
          dialect: "modelica",
          source: "model C1 Real a; Real b; Real c; Real d; Real e; equation a=b; b=c; c=d; d=e; e=1; end C1;",
        },
        {
          uri: "complex2.mo",
          dialect: "modelica",
          source:
            "model C2 Real p; Real q; Real r; Real s; Real t; Real u; equation p=q; q=r; r=s; s=t; t=u; u=0; end C2;",
        },
      ];

      const comp1 = await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/small-llm-engineering-recipe",
          recipeVersion: "1.0.0",
          datasetKind: "training-recipe",
          examplesPerShard: 2,
          mCap: 32,
          files,
        })
        .expect(201);

      assert.equal(comp1.body.verifiedExamples, 4);
      assert.equal(comp1.body.rejectedExamples, 1);
      assert.equal(comp1.body.shards.length, 2);
      assert.ok(comp1.body.shards[0].mMax <= comp1.body.shards[1].mMin);

      // Deterministic re-run must produce identical SHA-256 shard IDs
      const comp2 = await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/small-llm-engineering-recipe",
          recipeVersion: "1.0.0",
          datasetKind: "training-recipe",
          examplesPerShard: 2,
          mCap: 32,
          files: [...files].reverse(),
        })
        .expect(201);

      assert.equal(comp2.body.shards[0].shardId, comp1.body.shards[0].shardId);
      assert.equal(comp2.body.shards[1].shardId, comp1.body.shards[1].shardId);

      // HTTP Range (206 Partial Content) streaming for Browser OPFS DataLoader
      const shardId = comp1.body.shards[0].shardId as string;
      const rangeRes = await request(app)
        .get(`/api/v1/memory/datasets/shards/${shardId}`)
        .set("Range", "bytes=0-63")
        .expect(206);

      assert.equal(Buffer.byteLength(rangeRes.text, "utf8"), 64);
      assert.match(rangeRes.headers["content-range"] || "", /^bytes 0-63\//);

      // DiskANN stats check
      const statsRes = await request(app).get("/api/v1/memory/stats").expect(200);
      assert.equal(statsRes.body.backend, "diskann");
      assert.ok(statsRes.body.totalChunks >= 3);
      assert.ok(statsRes.body.ramInt8Bytes > 0);
      assert.ok(statsRes.body.nvmeFp32Bytes >= statsRes.body.ramInt8Bytes * 4);
    },
  );
});
