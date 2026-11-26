// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportTrainedWamResidualToCertifiedFmu } from "@modelscript/exchange";
import { certifyModalityExample, computePhysicalEquivalenceFingerprint, StlMonitor } from "@modelscript/runtime";
import { trainWamResidual } from "@modelscript/simulate";
import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";
process.env["OLLAMA_BASE_URL"] = "http://127.0.0.1:1";
delete process.env["OPENAI_API_KEY"];
delete process.env["ANTHROPIC_API_KEY"];

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { getOrCreateDiskAnnService } from "../src/services/diskann-memory.js";
import { getDefaultDatasetSigningKeyPair } from "../src/services/federated-diskann.js";
import { recordProvenanceNode } from "../src/services/provenance-attribution.js";
import { LibraryStorage } from "../src/storage.js";

test("End-to-End AI / Geometry / WAM Lifecycle Flywheel across all 6 categories", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-lifecycle-flywheel-"));
  const dataDir = path.join(tmpDir, "storage");
  const database = new LibraryDatabase(tmpDir);
  const storage = new LibraryStorage(dataDir);
  const app = createApp({ database, storage });

  t.after(() => {
    try {
      database.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  const adminUser = database.createUser("flywheel_admin", "admin@flywheel.test", "hash_pw", "Flywheel Admin");
  assert.ok(adminUser);
  const adminId = adminUser.id;
  database.db.prepare(`UPDATE users SET account_type = 'admin' WHERE id = ?`).run(adminId);
  database.grantUserCredits(adminId, 100, "test_seed", "Seed admin credits");
  const adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, email: adminUser.email, role: "admin", accountType: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  const authorUser = database.createUser("flywheel_author", "author@flywheel.test", "hash_pw", "Flywheel Author");
  assert.ok(authorUser);
  const authorId = authorUser.id;
  database.grantUserCredits(authorId, 50, "test_seed", "Seed author credits");
  const authorToken = jwt.sign(
    { id: authorUser.id, username: authorUser.username, email: authorUser.email, accountType: authorUser.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  const annUser = database.createUser("flywheel_ann", "ann@flywheel.test", "hash_pw", "Flywheel Annotator");
  assert.ok(annUser);
  const annotatorId = annUser.id;
  database.grantUserCredits(annotatorId, 50, "test_seed", "Seed annotator credits");
  const annotatorToken = jwt.sign(
    { id: annUser.id, username: annUser.username, email: annUser.email, accountType: annUser.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  // ── Category 1: Set-Based Modality Certification, Physical Dedup & Overlay Folding ──
  await t.test("Category 1: CAD GD&T ConstrainedZonotope, WAM STL/Passivity & Physical-Equivalence Dedup", () => {
    // Variable renaming + uniform unit scaling (x10) must yield identical physical fingerprint
    const fpA = computePhysicalEquivalenceFingerprint(
      "model CircuitA parameter Real R = 10.0; parameter Real C = 2.0; Real v; equation v = R * C; end CircuitA;",
      "modelica",
    );
    const fpB = computePhysicalEquivalenceFingerprint(
      "model CircuitB parameter Real R = 100.0; parameter Real C = 20.0; Real v; equation v = R * C; end CircuitB;",
      "modelica",
    );
    assert.equal(fpA, fpB, "Uniformly unit-rescaled physical systems must share canonical physical fingerprint");

    // CAD GD&T feasible vs infeasible tolerance cone
    const cadOk = certifyModalityExample({
      source: "width = 10.0; height = 20.0; cube([width, height, 5]);",
      uri: "cad://bracket.scad",
      dialect: "scad",
      gdtConstraints: [{ id: "c1", paramName: "width", min: 9.5, max: 10.5 }],
    });
    assert.equal(cadOk.passed, true);
    assert.equal(cadOk.gdtFeasible, true);

    const cadBad = certifyModalityExample({
      source: "width = 10.0; cube([width, 5, 5]);",
      uri: "cad://bad-bracket.scad",
      dialect: "scad",
      gdtConstraints: [
        { id: "c_lo", paramName: "width", min: 12.0 },
        { id: "c_hi", paramName: "width", max: 8.0 },
      ],
    });
    assert.equal(cadBad.passed, false);
    assert.equal(cadBad.gdtFeasible, false);

    // WAM trajectory STL + passivity gate
    const wamSafe = certifyModalityExample({
      source: "// WAM rollout",
      uri: "wam://arm/rollout1.wam",
      dialect: "wam",
      wamTrajectory: {
        time: [0, 0.1, 0.2, 0.3],
        signals: { torque: [2.0, 2.5, 2.1, 1.8], energy: [10.0, 9.8, 9.5, 9.2] },
        stlFormula: StlMonitor.always([0, 0.3], StlMonitor.predicate("torque", "<=", 5.0)),
        energySignalName: "energy",
      },
    });
    assert.equal(wamSafe.passed, true);
    assert.equal(wamSafe.passivityViolated, false);

    const wamUnsafe = certifyModalityExample({
      source: "// WAM rollout energy blowup",
      uri: "wam://arm/rollout2.wam",
      dialect: "wam",
      wamTrajectory: {
        time: [0, 0.1, 0.2],
        signals: { torque: [2.0, 9.0, 12.0], energy: [10.0, 18.0, 35.0] },
        stlFormula: StlMonitor.always([0, 0.2], StlMonitor.predicate("torque", "<=", 5.0)),
        energySignalName: "energy",
      },
    });
    assert.equal(wamUnsafe.passed, false);
    assert.equal(wamUnsafe.passivityViolated, true);
  });

  // ── Category 2 & 4: WAM Residual -> Certified FMI 3.0 FMU Bridge & Run Dispatch ──
  await t.test("Category 2 & 4: TrainedWamResidual exports to Certified FMI 3.0 FMU and runs dispatch", async () => {
    const trained = trainWamResidual(
      {
        times: [0.0, 0.1, 0.2, 0.3],
        jointNames: ["j1"],
        q: [[0.0], [0.5], [-0.5], [0.2]],
        dq: [[0.0], [0.1], [-0.1], [-0.2]],
        u: [[0.0], [1.0], [-1.0], [0.5]],
        tauResidual: [[0.0], [0.25], [-0.25], [0.1]],
      },
      { hiddenLayers: [6], epochs: 20, learningRate: 0.02, seed: 42 },
    );

    const fmu = exportTrainedWamResidualToCertifiedFmu(trained, {
      modelIdentifier: "test_certified_wam",
      fmiVersion: "3.0",
    });
    assert.ok(fmu.modelDescription3Xml.includes('fmiVersion="3.0"'), "Must emit valid FMI 3.0 XML");
    assert.ok(fmu.controllerCSource.length > 100, "Must emit self-contained C99 WAM controller source");
    assert.equal(fmu.inputs.length, 3);
    assert.equal(fmu.outputs.length, 1);
    assert.equal(fmu.certificate.inputCount, 3);
    assert.equal(fmu.certificate.outputCount, 1);

    // Create and dispatch a Slurm training run
    const createRun = await request(app)
      .post("/api/v1/runs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        recipeName: "@ms/modelica-rlvr",
        recipeVersion: "1.0.0",
        modelName: "Qwen/Qwen3-1.7B",
        backend: "slurm",
        hyperparams: { loraRank: 8, baseModel: "Qwen/Qwen3-1.7B" },
      })
      .expect(201);
    const runUid = createRun.body.run.runUid as string;

    const dispatchRes = await request(app)
      .post(`/api/v1/runs/${runUid}/dispatch`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(200);
    assert.equal(dispatchRes.body.run.status, "running");
    assert.equal(dispatchRes.body.dispatchPlan.mode, "slurm-sbatch");
    assert.match(dispatchRes.body.dispatchPlan.cliCommand, /--export-targets mlc-webgpu,gguf,onnx,peft/);
  });

  // ── Category 5: DiskANN Curation, Quarantine Exclusion, Compaction & Peer Delete ──
  await t.test("Category 5: DiskANN curation endpoints, quarantine exclusion, compaction & peer deletion", async () => {
    const diskann = getOrCreateDiskAnnService(database, path.join(dataDir, "ml-memory"));
    const chunkA = diskann.upsertChunk({
      sourceKind: "package-symbol",
      sourceUri: "pkg://@ms/thermal@1.0.0/HeatPump.mo",
      packageName: "@ms/thermal",
      packageVersion: "1.0.0",
      dialect: "modelica",
      content: "model HeatPump parameter Real COP = 3.5; Real Q_out; equation Q_out = COP * 100.0; end HeatPump;",
      formalVerified: true,
      authorUserId: authorId,
    });
    // Duplicate content under different URI to verify compaction deduplication
    diskann.upsertChunk({
      sourceKind: "package-symbol",
      sourceUri: "pkg://@ms/thermal-fork@1.0.0/HeatPump.mo",
      packageName: "@ms/thermal-fork",
      packageVersion: "1.0.0",
      dialect: "modelica",
      content: "model HeatPump parameter Real COP = 3.5; Real Q_out; equation Q_out = COP * 100.0; end HeatPump;",
      formalVerified: true,
      authorUserId: authorId,
    });

    const listRes = await request(app).get("/api/v1/memory/chunks").expect(200);
    assert.ok(listRes.body.total >= 2);

    // Quarantine chunkA and confirm it is excluded from DiskANN query
    await request(app)
      .post(`/api/v1/memory/chunks/${chunkA}/quarantine`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ quarantined: true })
      .expect(200);

    const qRes = await request(app)
      .post("/api/v1/memory/query")
      .send({ mode: "hybrid", textQuery: "HeatPump COP", topK: 5 })
      .expect(200);
    assert.ok(
      !qRes.body.chunks.some((c: { chunkId: string }) => c.chunkId === chunkA),
      "Quarantined chunk must not be returned by DiskANN query",
    );

    // Restore chunkA and compact index (deduplicating identical content hash)
    await request(app)
      .post(`/api/v1/memory/chunks/${chunkA}/quarantine`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ quarantined: false })
      .expect(200);

    const compactRes = await request(app)
      .post("/api/v1/memory/compact")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    assert.equal(compactRes.body.deduplicatedCount, 1);

    // Add and remove federated peer
    await request(app)
      .post("/api/v1/memory/federated/peers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ peerUrl: "https://peer-unit.ansatz.social", label: "Peer Unit" })
      .expect(201);
    await request(app)
      .delete("/api/v1/memory/federated/peers")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ peerUrl: "https://peer-unit.ansatz.social" })
      .expect(200);
  });

  // ── Category 3 & 6: Persistent Keys, Chat Trace -> Royalties -> Verified Fix -> Living Recipe -> Revocation ──
  await t.test(
    "Category 3 & 6: Chat trace, retrieval royalty, verified fix harvest, arena escalation, living triggers & revocation",
    async () => {
      // Persistent Ed25519 key survives fresh lookup from SQLite
      const kp1 = getDefaultDatasetSigningKeyPair(database);
      const kp2 = getDefaultDatasetSigningKeyPair(database);
      assert.equal(kp1.fingerprintSha256, kp2.fingerprintSha256);

      // Register a living recipe trigger with threshold = 1 verified fix
      await request(app)
        .post("/api/v1/runs/living-triggers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          recipeName: "@ms/modelica-living-v1",
          dialect: "modelica",
          triggerKind: "verified_pair_threshold",
          thresholdCount: 1,
          targetBackend: "pytorch",
        })
        .expect(201);

      // Run an Ansatz AI chat turn (as admin, retrieving authorId's HeatPump chunk!)
      const chatRes = await request(app)
        .post("/api/v1/ai/ansatz/chat")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          computeDial: "auto-escalate",
          context: { dialect: "modelica", fileName: "HeatPump.mo", code: "" },
          messages: [{ role: "user", content: "Explain HeatPump COP equation in Modelica" }],
        })
        .expect(200);

      const sseLines = chatRes.text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => JSON.parse(l.slice(5).trim()) as Record<string, unknown>);
      const traceEvt = sseLines.find((e) => e["type"] === "trace_created");
      assert.ok(traceEvt && typeof traceEvt["traceId"] === "string", "SSE must emit trace_created event");
      const traceId = traceEvt["traceId"] as string;
      assert.ok(Number(traceEvt["creditsCharged"]) > 0, "Hosted AI chat must deduct metered compute credits");

      // Verify authorId earned a retrieval receipt royalty!
      const earningsRes = await request(app)
        .get("/api/v1/ai/attribution/earnings")
        .set("Authorization", `Bearer ${authorToken}`)
        .expect(200);
      assert.ok(earningsRes.body.retrievalReceiptCount >= 1);
      assert.ok(earningsRes.body.totalEarnedCredits > 0);

      // Submit a Gate 1-4 verified manual fix on the chat trace -> auto-harvests to DiskANN + awards +15 cr + readies living recipe
      const fbRes = await request(app)
        .post(`/api/v1/ai/traces/${traceId}/feedback`)
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          userRating: "up",
          editOutcome: "manual_fixed",
          allowTrainingOptIn: true,
          userFixedCode:
            "model VerifiedPump parameter Real COP = 4.0; Real Q; equation Q = COP * 10.0; end VerifiedPump;",
        })
        .expect(200);
      assert.equal(fbRes.body.harvestedToDiskAnn, true);
      assert.equal(fbRes.body.creditsAwarded, 15);
      assert.ok(typeof fbRes.body.provenanceCid === "string");
      assert.ok(fbRes.body.livingRecipeReady.length >= 1);

      // Evaluate living recipe trigger -> auto-spawns queued training run!
      const evalTrigRes = await request(app)
        .post("/api/v1/runs/living-triggers/evaluate")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ dialect: "modelica" })
        .expect(200);
      assert.equal(evalTrigRes.body.spawnedRuns.length, 1);

      // Escalate chat trace to RLHF Arena
      const escRes = await request(app)
        .post(`/api/v1/ai/traces/${traceId}/escalate-arena`)
        .set("Authorization", `Bearer ${authorToken}`)
        .send({ challengeType: "fix_it_bounty" })
        .expect(201);
      assert.ok(escRes.body.challengeId > 0);
      assert.match(escRes.body.annotateUrl, /^\/annotate\/\d+$/);

      // Test domain_steward_roles RBAC on adjudication: grant steward to admin, verify non-steward gets 403
      await request(app)
        .post("/api/v1/rlhf/stewards")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ userId: adminId, domain: "modelica", role: "steward" })
        .expect(201);

      await request(app)
        .post(`/api/v1/rlhf/challenges/${escRes.body.challengeId}/adjudicate`)
        .set("Authorization", `Bearer ${annotatorToken}`)
        .send({ resolution: "archive", notes: "Unauthorized attempt" })
        .expect(403);

      // Test cryptographic revocation cascade on the harvested verified-fix CID
      const revRes = await request(app)
        .post(`/api/v1/ai/provenance/${encodeURIComponent(fbRes.body.provenanceCid)}/revoke`)
        .set("Authorization", `Bearer ${authorToken}`)
        .send({ reason: "Author withdrew consent" })
        .expect(200);
      assert.equal(revRes.body.success, true);
      assert.ok(revRes.body.revokedCids.includes(fbRes.body.provenanceCid));
      assert.ok(revRes.body.quarantinedChunks >= 1);

      // Also verify provenance DAG helper records child model node and flags revocation_pending
      const srcNode = recordProvenanceNode(database, {
        nodeKind: "source-commit",
        refId: "git://revoked/test.mo",
        authorUserId: authorId,
      });
      recordProvenanceNode(database, {
        nodeKind: "model-weights",
        refId: "rev-model@1.0.0",
        parentCids: [srcNode.cid],
        authorUserId: authorId,
      });
      database.db
        .prepare(
          `INSERT INTO model_registry_entries (name, version, kind, promotion_stage, created_by)
         VALUES ('rev-model', '1.0.0', 'lora-adapter', 'draft', ?)`,
        )
        .run(authorId);

      const cascadeRes = await request(app)
        .post(`/api/v1/ai/provenance/${encodeURIComponent(srcNode.cid)}/revoke`)
        .set("Authorization", `Bearer ${authorToken}`)
        .send({ reason: "Downstream model revocation test" })
        .expect(200);
      assert.equal(cascadeRes.body.flaggedModels, 1);
    },
  );
});
