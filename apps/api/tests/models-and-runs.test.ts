// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import type { FormalModelEvalReport } from "@modelscript/runtime";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET, setAuthDatabase } from "../src/middleware/auth-middleware.js";
import { trainingRunsAndModelRegistryMigration } from "../src/migrations/0011_training_runs_and_model_registry.js";
import { SqliteMigrationRunner } from "../src/migrations/runner.js";
import { modelsRouter, runsRouter, verifyPromotionAttestationEd25519 } from "../src/routes/models-and-runs.js";

function makeEvalReport(opts: {
  promoted: boolean;
  failureReasons?: string[];
  perCase?: FormalModelEvalReport["perCase"];
  formalGatePassRate?: number;
  nonTrivialPassRate?: number;
  ece?: number;
}): FormalModelEvalReport {
  const perCase = opts.perCase ?? [
    {
      caseId: "case_rc_circuit",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.08,
    },
    {
      caseId: "case_thermal_wall",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.11,
    },
  ];
  return {
    promoted: opts.promoted,
    totalCases: perCase.length,
    formalGatePassRate: opts.formalGatePassRate ?? (opts.promoted ? 1.0 : 0.5),
    nonTrivialPassRate: opts.nonTrivialPassRate ?? (opts.promoted ? 1.0 : 0.5),
    rewardHackingRate: 0,
    diskAnnRecallAtK: 0.95,
    calibration: {
      ece: opts.ece ?? 0.04,
      meanSpreadOnErrors: 0.42,
      meanSpreadOnValid: 0.09,
      separationGap: 0.33,
      sampleCount: perCase.length,
    },
    failureReasons: opts.failureReasons ?? (opts.promoted ? [] : ["Formal gate pass rate below 0.90 threshold."]),
    perCase,
  };
}

test("Model Registry, Live Training Runs Telemetry, Formal-Proof-Gated Promotion & Chunked Multipart Weights API", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "models-and-runs-test-"));
  const storageDir = path.join(tmpDir, "storage");
  const db = new LibraryDatabase(tmpDir);

  // Apply migration 0011 directly so this test is self-contained before app.ts/index.ts wiring
  const migrationRunner = new SqliteMigrationRunner(db.db);
  migrationRunner.runPendingSync([trainingRunsAndModelRegistryMigration]);

  setAuthDatabase(db);

  const app = express();
  app.locals["database"] = db;
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/v1/runs", runsRouter(db));
  app.use("/api/v1/models", modelsRouter(db, storageDir));

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  const user = db.createUser("ml_operator", "ml-op@modelscript.test", "hash_pw", "ML Operator");
  assert.ok(user);
  const authHeader = `Bearer ${jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`;

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Live Training Runs Telemetry
  // ───────────────────────────────────────────────────────────────────────────
  await t.test("Training runs lifecycle: create, filter list, live metric streaming, status transitions", async () => {
    // Requires auth to create a run
    await request(app).post("/api/v1/runs").send({ recipeName: "@ms/rc-zonotope", backend: "pytorch" }).expect(401);

    // Create PyTorch run
    const createRes = await request(app)
      .post("/api/v1/runs")
      .set("Authorization", authHeader)
      .send({
        recipeName: "@ms/rc-zonotope",
        recipeVersion: "1.2.0",
        modelName: "modelscript-small-rc",
        backend: "pytorch",
        hyperparams: { lr: 3e-4, mCap: 32, loraRank: 16 },
        shardIds: ["shard_aaa", "shard_bbb"],
      })
      .expect(201);

    const runUid = createRes.body.run.runUid as string;
    assert.ok(runUid.startsWith("run_"));
    assert.equal(createRes.body.run.status, "queued");
    assert.equal(createRes.body.run.backend, "pytorch");
    assert.deepEqual(createRes.body.run.shardIds, ["shard_aaa", "shard_bbb"]);

    // Create a second WebGPU run to verify filtering
    await request(app)
      .post("/api/v1/runs")
      .set("Authorization", authHeader)
      .send({
        recipeName: "@ms/cad-scad",
        backend: "webgpu",
        status: "running",
      })
      .expect(201);

    // Transition first run to running
    const runningRes = await request(app)
      .post(`/api/v1/runs/${runUid}/status`)
      .set("Authorization", authHeader)
      .send({ status: "running", latestCheckpointKey: "checkpoints/rc/step-0.bin" })
      .expect(200);
    assert.equal(runningRes.body.run.status, "running");
    assert.ok(runningRes.body.run.startedAt);
    assert.equal(runningRes.body.run.latestCheckpointKey, "checkpoints/rc/step-0.bin");

    // Stream step metrics out of order to verify ORDER BY step ASC
    await request(app)
      .post(`/api/v1/runs/${runUid}/metrics`)
      .set("Authorization", authHeader)
      .send({
        step: 20,
        epoch: 0.4,
        center_loss: 1.12,
        worst_case_loss: 1.38,
        m_active: 14,
        max_spread_delta_t: 0.17,
        pruned_count: 5,
        merged_count: 2,
        expanded_count: 3,
        girard_cap_count: 1,
        gate1_to_4_pass_rate: 0.94,
        ece: 0.06,
        wq_recall_at_k: 0.91,
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/runs/${runUid}/metrics`)
      .set("Authorization", authHeader)
      .send({
        step: 10,
        epoch: 0.2,
        centerLoss: 1.85,
        worstCaseLoss: 2.24,
        mActive: 18,
        maxSpreadDeltaT: 0.29,
        prunedCount: 2,
        mergedCount: 1,
        expandedCount: 4,
        girardCapCount: 2,
        gate1To4PassRate: 0.82,
        ece: 0.12,
        wqRecallAtK: 0.84,
      })
      .expect(201);

    // Complete run with final evalReport and checkpoint
    const evalReport = makeEvalReport({ promoted: true });
    const completeRes = await request(app)
      .post(`/api/v1/runs/${runUid}/status`)
      .set("Authorization", authHeader)
      .send({
        status: "completed",
        latestCheckpointKey: "checkpoints/rc/step-20.bin",
        evalReport,
      })
      .expect(200);

    assert.equal(completeRes.body.run.status, "completed");
    assert.ok(completeRes.body.run.finishedAt);
    assert.equal(completeRes.body.run.latestCheckpointKey, "checkpoints/rc/step-20.bin");
    assert.equal(completeRes.body.run.evalReport.promoted, true);

    // Inspect run + ordered metrics[]
    const inspectRes = await request(app).get(`/api/v1/runs/${runUid}`).expect(200);
    assert.equal(inspectRes.body.run.runUid, runUid);
    assert.equal(inspectRes.body.metrics.length, 2);
    assert.equal(inspectRes.body.metrics[0].step, 10);
    assert.equal(inspectRes.body.metrics[0].centerLoss, 1.85);
    assert.equal(inspectRes.body.metrics[1].step, 20);
    assert.equal(inspectRes.body.metrics[1].centerLoss, 1.12);
    assert.equal(inspectRes.body.metrics[1].girardCapCount, 1);
    assert.equal(inspectRes.body.metrics[1].wqRecallAtK, 0.91);

    // Filter listing by status, recipeName, backend
    const listFiltered = await request(app)
      .get("/api/v1/runs?status=completed&recipeName=@ms/rc-zonotope&backend=pytorch")
      .expect(200);
    assert.equal(listFiltered.body.total, 1);
    assert.equal(listFiltered.body.runs[0].runUid, runUid);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Model Registry & Formal-Proof-Gated Promotion + Regression Blocking
  // ───────────────────────────────────────────────────────────────────────────
  await t.test(
    "Model registration compatibility checks & formal-proof-gated promotion with diffEvalReports",
    async () => {
      // Register v1.0.0 model-core
      const coreV1Res = await request(app)
        .post("/api/v1/models")
        .set("Authorization", authHeader)
        .send({
          name: "zonotope-core",
          version: "1.0.0",
          kind: "model-core",
          recipeName: "@ms/rc-zonotope",
          recipeVersion: "1.0.0",
          parameterScale: "1.5B",
          retrieverEmbeddingDim: 256,
          memoryContract: { embedderId: "diskann-v1", embeddingDim: 256 },
        })
        .expect(201);
      assert.equal(coreV1Res.body.model.promotionStage, "draft");

      // Register compatible lora-adapter referencing zonotope-core@1.0.0
      const loraOkRes = await request(app)
        .post("/api/v1/models")
        .set("Authorization", authHeader)
        .send({
          name: "zonotope-thermal-lora",
          version: "1.0.0",
          kind: "lora-adapter",
          baseModelRef: "zonotope-core@1.0.0",
          parameterScale: "1.5B",
          loraRank: 16,
        })
        .expect(201);
      assert.equal(loraOkRes.body.compatibilityCheck.compatible, true);
      assert.equal(loraOkRes.body.compatibilityCheck.resolvedBaseModel.name, "zonotope-core");

      // Reject incompatible lora-adapter (mismatched parameterScale vs base model-core)
      await request(app)
        .post("/api/v1/models")
        .set("Authorization", authHeader)
        .send({
          name: "zonotope-bad-lora",
          version: "1.0.0",
          kind: "lora-adapter",
          baseModelRef: "zonotope-core@1.0.0",
          parameterScale: "7B",
          loraRank: 8,
        })
        .expect(400);

      // Reject projection-head with retrieverEmbeddingDim <= 0
      await request(app)
        .post("/api/v1/models")
        .set("Authorization", authHeader)
        .send({
          name: "zonotope-bad-proj",
          version: "1.0.0",
          kind: "projection-head",
          projectionLayerIndex: 12,
          retrieverEmbeddingDim: 0,
        })
        .expect(400);

      // Register valid projection-head
      await request(app)
        .post("/api/v1/models")
        .set("Authorization", authHeader)
        .send({
          name: "zonotope-wq-proj",
          version: "1.0.0",
          kind: "projection-head",
          baseModelRef: "zonotope-core@1.0.0",
          projectionLayerIndex: 12,
          retrieverEmbeddingDim: 256,
        })
        .expect(201);

      // Reject unpromoted evalReport with 422 + failureReasons
      const failingEval = makeEvalReport({
        promoted: false,
        failureReasons: ["Formal gate pass rate 0.50 < 0.90."],
      });
      const rejectRes = await request(app)
        .post("/api/v1/models/zonotope-core/1.0.0/promote")
        .set("Authorization", authHeader)
        .send({ targetStage: "production", evalReport: failingEval })
        .expect(422);
      assert.equal(rejectRes.body.promoted, false);
      assert.ok(Array.isArray(rejectRes.body.failureReasons));
      assert.ok(rejectRes.body.failureReasons[0].includes("0.50"));

      // Promote v1.0.0 to production with passing FormalModelEvalReport -> Ed25519 proof persisted
      const v1PassingEval = makeEvalReport({ promoted: true });
      const promoteV1Res = await request(app)
        .post("/api/v1/models/zonotope-core/1.0.0/promote")
        .set("Authorization", authHeader)
        .send({
          targetStage: "production",
          evalReport: v1PassingEval,
          zonotopeCert: { maxSpreadDeltaT: 0.11, mCap: 32 },
        })
        .expect(200);

      assert.equal(promoteV1Res.body.model.promotionStage, "production");
      assert.equal(promoteV1Res.body.proof.cryptosuite, "eddsa-jcs-2022");
      assert.ok(promoteV1Res.body.model.ed25519Proof);
      const sigCheck = verifyPromotionAttestationEd25519(promoteV1Res.body.model.ed25519Proof);
      assert.equal(sigCheck.valid, true, `Expected valid Ed25519 promotion proof, got: ${sigCheck.error}`);

      // Register v2.0.0 of zonotope-core
      await request(app)
        .post("/api/v1/models")
        .set("Authorization", authHeader)
        .send({
          name: "zonotope-core",
          version: "2.0.0",
          kind: "model-core",
          parameterScale: "1.5B",
          retrieverEmbeddingDim: 256,
        })
        .expect(201);

      // Block v2.0.0 promotion to production when diffEvalReports detects flippedPassToFail > 0 (422)
      const v2RegressingEval = makeEvalReport({
        promoted: true,
        perCase: [
          {
            caseId: "case_rc_circuit",
            formalPassed: false, // Regressed from pass -> fail!
            behavioralPassed: true,
            rewardHacking: false,
            rewardHackingReasons: [],
            outputSpreadDeltaT: 0.22,
          },
          {
            caseId: "case_thermal_wall",
            formalPassed: true,
            behavioralPassed: true,
            rewardHacking: false,
            rewardHackingReasons: [],
            outputSpreadDeltaT: 0.09,
          },
        ],
      });
      const blockedV2Res = await request(app)
        .post("/api/v1/models/zonotope-core/2.0.0/promote")
        .set("Authorization", authHeader)
        .send({ targetStage: "production", evalReport: v2RegressingEval })
        .expect(422);

      assert.equal(blockedV2Res.body.previousProductionVersion, "1.0.0");
      assert.deepEqual(blockedV2Res.body.regressionDiff.flippedPassToFail, ["case_rc_circuit"]);

      // Approve non-regressing v2.0.0 promotion to production
      const v2CleanEval = makeEvalReport({
        promoted: true,
        perCase: [
          {
            caseId: "case_rc_circuit",
            formalPassed: true,
            behavioralPassed: true,
            rewardHacking: false,
            rewardHackingReasons: [],
            outputSpreadDeltaT: 0.06,
          },
          {
            caseId: "case_thermal_wall",
            formalPassed: true,
            behavioralPassed: true,
            rewardHacking: false,
            rewardHackingReasons: [],
            outputSpreadDeltaT: 0.07,
          },
          {
            caseId: "case_pid_loop",
            formalPassed: true,
            behavioralPassed: true,
            rewardHacking: false,
            rewardHackingReasons: [],
            outputSpreadDeltaT: 0.05,
          },
        ],
      });
      const promoteV2Res = await request(app)
        .post("/api/v1/models/zonotope-core/2.0.0/promote")
        .set("Authorization", authHeader)
        .send({ targetStage: "production", evalReport: v2CleanEval })
        .expect(200);

      assert.equal(promoteV2Res.body.model.promotionStage, "production");
      assert.deepEqual(promoteV2Res.body.regressionDiff.flippedPassToFail, []);
      assert.equal(verifyPromotionAttestationEd25519(promoteV2Res.body.model.ed25519Proof).valid, true);

      // Filter model listing
      const prodList = await request(app)
        .get("/api/v1/models?kind=model-core&promotionStage=production&name=zonotope-core")
        .expect(200);
      assert.equal(prodList.body.total, 2);
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Multi-Chunk Weight Upload, SHA-256 Verification & HTTP 206 Range Download
  // ───────────────────────────────────────────────────────────────────────────
  await t.test("Chunked multipart weight upload, SHA-256 verification, ETag & HTTP 206 Range download", async () => {
    const rawWeights = Buffer.alloc(12_000);
    for (let i = 0; i < rawWeights.length; i++) {
      rawWeights[i] = (i * 31 + 7) & 0xff;
    }
    const expectedSha256 = crypto.createHash("sha256").update(rawWeights).digest("hex");

    const chunk0 = rawWeights.subarray(0, 4000);
    const chunk1 = rawWeights.subarray(4000, 8000);
    const chunk2 = rawWeights.subarray(8000, 12000);
    const uploadId = "upload-core-v2-001";

    // Upload chunks intentionally out of order (2, 0, 1)
    await request(app)
      .post("/api/v1/models/zonotope-core/2.0.0/weights/upload-chunk")
      .set("Authorization", authHeader)
      .send({ uploadId, chunkIndex: 2, dataBase64: chunk2.toString("base64") })
      .expect(200);

    await request(app)
      .post("/api/v1/models/zonotope-core/2.0.0/weights/upload-chunk")
      .set("Authorization", authHeader)
      .send({ uploadId, chunkIndex: 0, dataBase64: chunk0.toString("base64") })
      .expect(200);

    await request(app)
      .post("/api/v1/models/zonotope-core/2.0.0/weights/upload-chunk")
      .set("Authorization", authHeader)
      .send({ uploadId, chunkIndex: 1, dataBase64: chunk1.toString("base64") })
      .expect(200);

    // Wrong expectedSha256 must fail with 400 without corrupting weights
    const badShaRes = await request(app)
      .post("/api/v1/models/zonotope-core/2.0.0/weights/complete")
      .set("Authorization", authHeader)
      .send({ uploadId, expectedSha256: "0".repeat(64) })
      .expect(400);
    assert.equal(badShaRes.body.actualSha256, expectedSha256);

    // Complete upload with correct expectedSha256
    const completeRes = await request(app)
      .post("/api/v1/models/zonotope-core/2.0.0/weights/complete")
      .set("Authorization", authHeader)
      .send({ uploadId, expectedSha256, totalChunks: 3 })
      .expect(200);

    assert.equal(completeRes.body.weightSha256, expectedSha256);
    assert.equal(completeRes.body.weightBytes, rawWeights.length);
    assert.equal(completeRes.body.storageKey, "model-weights/zonotope-core-2.0.0.bin");
    assert.equal(completeRes.body.chunksAssembled, 3);

    // Inspect model card confirms weight metadata persisted
    const cardRes = await request(app).get("/api/v1/models/zonotope-core/2.0.0").expect(200);
    assert.equal(cardRes.body.model.weightSha256, expectedSha256);
    assert.equal(cardRes.body.model.weightBytes, rawWeights.length);

    // Full download (200) + ETag check
    const fullRes = await request(app)
      .get("/api/v1/models/zonotope-core/2.0.0/weights")
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    assert.equal(fullRes.headers["etag"], `"${expectedSha256}"`);
    assert.equal(fullRes.headers["accept-ranges"], "bytes");
    assert.equal(Buffer.compare(fullRes.body as Buffer, rawWeights), 0);

    // HTTP 206 Partial Content Range download
    const rangeRes = await request(app)
      .get("/api/v1/models/zonotope-core/2.0.0/weights")
      .set("Range", "bytes=100-355")
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(206);

    assert.equal(rangeRes.headers["content-range"], `bytes 100-355/${rawWeights.length}`);
    assert.equal(rangeRes.headers["content-length"], "256");
    assert.equal(rangeRes.headers["etag"], `"${expectedSha256}"`);
    assert.equal(Buffer.compare(rangeRes.body as Buffer, rawWeights.subarray(100, 356)), 0);

    // Out-of-bounds range returns 416
    await request(app)
      .get("/api/v1/models/zonotope-core/2.0.0/weights")
      .set("Range", "bytes=999999-1000010")
      .expect(416);
  });
});
