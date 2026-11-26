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
import { generateDatasetSigningKeyPair } from "../src/services/federated-diskann.js";
import { LibraryStorage } from "../src/storage.js";

test("Gap #1 & #4: Memory-Shard Contracts, Federated Attestations, Domain Leaderboards & Fix-It Credits", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-shard-leaderboard-test-"));
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

  const user = db.createUser("ml_researcher", "researcher@modelscript.test", "hash_pw", "ML Researcher");
  assert.ok(user);
  const authHeader = `Bearer ${jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`;

  const trustedSigner = generateDatasetSigningKeyPair();
  const untrustedSigner = generateDatasetSigningKeyPair();

  await t.test(
    "registers memory-shard, signs/verifies manifest, and enforces validateMemoryShardCompatibility",
    async () => {
      const memoryContract = {
        embedderId: "ansatz-embed-v1",
        embedderHash: "sha256:embed-v1-canonical-hash",
        dimension: 256,
        quantization: "int8-diskann" as const,
        sourcePackages: [
          {
            originNode: "ansatz.social",
            packageName: "@modelica/msl-memory",
            version: "4.0.0",
            signerPubkey: trustedSigner.publicKeyMultibase,
          },
        ],
      };

      // 1. Register memory-shard via POST /datasets/compile
      const regRes = await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@modelica/msl-memory",
          recipeVersion: "4.0.0",
          datasetKind: "memory-shard",
          originNode: "ansatz.social",
          signerPubkey: trustedSigner.publicKeyMultibase,
          memoryContract,
          aiGovernance: {
            allowRag: true,
            allowPretrain: false,
            allowPosttrain: false,
            tenantScope: "public",
          },
          files: [
            {
              uri: "docs/ThermalResistor.md",
              dialect: "markdown",
              source: "ThermalResistor models linear heat conduction Q_flow = G * dT.",
            },
          ],
        })
        .expect(201);

      assert.equal(regRes.body.datasetKind, "memory-shard");
      assert.equal(regRes.body.memoryContract.embedderId, "ansatz-embed-v1");
      assert.ok(regRes.body.shardId && regRes.body.shardId.length === 64);
      assert.ok(regRes.body.indexedChunks >= 1);

      // 2. Listing via GET /datasets/shards?datasetKind=memory-shard returns the shard
      const listRes = await request(app)
        .get("/api/v1/memory/datasets/shards")
        .query({ datasetKind: "memory-shard" })
        .expect(200);
      assert.equal(listRes.body.total, 1);
      assert.equal(listRes.body.shards[0].datasetKind, "memory-shard");
      assert.equal(listRes.body.shards[0].memoryContract.embedderId, "ansatz-embed-v1");

      // 3. Ed25519 sign & verify a memory-shard manifest
      const signRes = await request(app)
        .post("/api/v1/memory/federated/sign-manifest")
        .set("Authorization", authHeader)
        .send({
          manifest: {
            datasetKind: "memory-shard",
            recipeName: "@modelica/msl-memory",
            recipeVersion: "4.0.0",
            memoryContract,
          },
          privateKeyPem: trustedSigner.privateKeyPem,
        })
        .expect(200);
      assert.equal(signRes.body.proof.cryptosuite, "eddsa-jcs-2022");

      const verifyRes = await request(app)
        .post("/api/v1/memory/federated/verify-manifest")
        .send({
          manifest: signRes.body.manifest,
          proof: signRes.body.proof,
          trustedPublicKeys: [trustedSigner.publicKeyMultibase],
        })
        .expect(200);
      assert.equal(verifyRes.body.valid, true);
      assert.equal(verifyRes.body.datasetKind, "memory-shard");

      // 4. Latent query with matching embedderId, embedderHash, dimension & trusted memoryPins PASSES
      const latentVec = Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0));
      const okQuery = await request(app)
        .post("/api/v1/memory/query")
        .send({
          mode: "latent",
          latentVector: latentVec,
          embedderId: "ansatz-embed-v1",
          embedderHash: "sha256:embed-v1-canonical-hash",
          memoryPins: [
            {
              originNode: "ansatz.social",
              packageName: "@modelica/msl-memory",
              version: "4.0.0",
              signerPubkey: trustedSigner.publicKeyMultibase,
            },
          ],
          topK: 5,
        })
        .expect(200);
      assert.equal(okQuery.body.backend, "diskann");
      assert.equal(okQuery.body.embedderId, "ansatz-embed-v1");
      assert.equal(okQuery.body.shardCompatibility.compatibleShards.length, 1);
      assert.equal(okQuery.body.shardCompatibility.incompatibleShards.length, 0);

      // 5. Mismatched embedderId is REJECTED (400)
      const badEmbedder = await request(app)
        .post("/api/v1/memory/query")
        .send({
          mode: "latent",
          latentVector: latentVec,
          embedderId: "incompatible-embed-v9",
          topK: 5,
        })
        .expect(400);
      assert.ok(
        badEmbedder.body.reasons.some((r: string) => r.includes("Embedder mismatch")),
        `Expected embedder mismatch diagnostic, got: ${JSON.stringify(badEmbedder.body)}`,
      );

      // 6. Untrusted signerPubkey in memoryPins is REJECTED (400)
      const untrustedPin = await request(app)
        .post("/api/v1/memory/query")
        .send({
          mode: "latent",
          latentVector: latentVec,
          embedderId: "ansatz-embed-v1",
          memoryPins: [
            {
              originNode: "ansatz.social",
              packageName: "@modelica/msl-memory",
              version: "4.0.0",
              signerPubkey: untrustedSigner.publicKeyMultibase,
            },
          ],
          topK: 5,
        })
        .expect(400);
      assert.ok(
        untrustedPin.body.reasons.some((r: string) => r.includes("not in query memoryPins")),
        `Expected memoryPins trust rejection, got: ${JSON.stringify(untrustedPin.body)}`,
      );

      // 7. Mismatched latentVector dimension is REJECTED (400)
      const badDim = await request(app)
        .post("/api/v1/memory/query")
        .send({
          mode: "latent",
          latentVector: [1, 0, 0, 0],
          embedderId: "ansatz-embed-v1",
          topK: 5,
        })
        .expect(400);
      assert.ok(
        badDim.body.reasons.some((r: string) => r.includes("dimension mismatch")),
        `Expected dimension mismatch diagnostic, got: ${JSON.stringify(badDim.body)}`,
      );
    },
  );

  await t.test(
    "records federated attestations, increments independentReproductions, and ranks GET /leaderboards",
    async () => {
      const validModelica = "model SimpleRC\n  Real v;\nequation\n  der(v) = -v;\nend SimpleRC;";
      const validScad = "wall_thickness = 2.0;\ncube([10, 10, wall_thickness]);";

      // Recipe A: 0.5B modelica — Pass@1 = 0.80, Gate1To4 = 0.90 -> score = 0.72
      const compA = await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/thermal-0.5b-recipe",
          recipeVersion: "1.0.0",
          datasetKind: "training-recipe",
          domain: "modelica",
          parameterScale: "0.5B",
          benchmarkMetrics: { passAt1: 0.8, gate1To4PassRate: 0.9 },
          files: [{ uri: "rc_a.mo", dialect: "modelica", source: validModelica }],
        })
        .expect(201);

      // Recipe B: 1.5B modelica — Pass@1 = 0.95, Gate1To4 = 0.92 -> score = 0.874 (Rank #1)
      const compB = await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/thermal-1.5b-recipe",
          recipeVersion: "2.0.0",
          datasetKind: "training-recipe",
          domain: "modelica",
          parameterScale: "1.5B",
          benchmarkMetrics: { passAt1: 0.95, gate1To4PassRate: 0.92 },
          files: [{ uri: "rc_b.mo", dialect: "modelica", source: validModelica }],
        })
        .expect(201);

      // Recipe C: 7B cad — Pass@1 = 0.90, Gate1To4 = 0.85 -> score = 0.765
      await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/cad-7b-recipe",
          recipeVersion: "1.0.0",
          datasetKind: "training-recipe",
          domain: "cad",
          parameterScale: "7B",
          benchmarkMetrics: { passAt1: 0.9, gate1To4PassRate: 0.85 },
          files: [{ uri: "bracket.scad", dialect: "scad", source: validScad }],
        })
        .expect(201);

      const shardBId = compB.body.shards[0].shardId as string;
      const peerA = generateDatasetSigningKeyPair();
      const peerB = generateDatasetSigningKeyPair();

      // Attestation #1 from lab-a.edu -> independentReproductions = 1
      const att1 = await request(app)
        .post("/api/v1/memory/federated/attest")
        .set("Authorization", authHeader)
        .send({
          type: "ansatz:VerificationAttestation",
          targetReleaseId: "@ms/thermal-1.5b-recipe@2.0.0",
          manifestCid: shardBId,
          verifierNode: "lab-a.edu",
          verifierPubkey: peerA.publicKeyMultibase,
          passedGates: { gate1: true, gate2: true, gate3: true, gate4: true },
          verifiedAtIso: new Date().toISOString(),
        })
        .expect(201);
      assert.equal(att1.body.independentReproductions, 1);
      assert.equal(att1.body.allGatesPassed, true);

      // Attestation #2 from lab-b.org -> independentReproductions = 2
      const att2 = await request(app)
        .post("/api/v1/memory/federated/attest")
        .set("Authorization", authHeader)
        .send({
          type: "ansatz:VerificationAttestation",
          targetReleaseId: "@ms/thermal-1.5b-recipe@2.0.0",
          manifestCid: shardBId,
          verifierNode: "lab-b.org",
          verifierPubkey: peerB.publicKeyMultibase,
          passedGates: { gate1: true, gate2: true, gate3: true, gate4: true },
          verifiedAtIso: new Date().toISOString(),
        })
        .expect(201);
      assert.equal(att2.body.independentReproductions, 2);

      // Re-attesting from lab-b.org is idempotent (still 2)
      const att2Dup = await request(app)
        .post("/api/v1/memory/federated/attest")
        .set("Authorization", authHeader)
        .send({
          type: "ansatz:VerificationAttestation",
          targetReleaseId: "@ms/thermal-1.5b-recipe@2.0.0",
          manifestCid: shardBId,
          verifierNode: "lab-b.org",
          verifierPubkey: peerB.publicKeyMultibase,
          passedGates: { gate1: true, gate2: true, gate3: true, gate4: true },
          verifiedAtIso: new Date().toISOString(),
        })
        .expect(201);
      assert.equal(att2Dup.body.independentReproductions, 2);

      // Full leaderboard sorted by Pass@1 * Gate1To4PassRate descending
      const lbAll = await request(app).get("/api/v1/memory/leaderboards").expect(200);
      assert.equal(lbAll.body.total, 3);
      assert.equal(lbAll.body.rankingFormula, "Pass@1 * Gate1To4PassRate");
      assert.equal(lbAll.body.entries[0].recipeName, "@ms/thermal-1.5b-recipe");
      assert.equal(lbAll.body.entries[0].rank, 1);
      assert.equal(lbAll.body.entries[0].score, 0.874);
      assert.equal(lbAll.body.entries[0].independentReproductions, 2);
      assert.equal(lbAll.body.entries[1].recipeName, "@ms/cad-7b-recipe");
      assert.equal(lbAll.body.entries[1].score, 0.765);
      assert.equal(lbAll.body.entries[2].recipeName, "@ms/thermal-0.5b-recipe");
      assert.equal(lbAll.body.entries[2].score, 0.72);
      assert.ok(compA.body.shards.length >= 1);

      // Filter by domain=modelica
      const lbModelica = await request(app)
        .get("/api/v1/memory/leaderboards")
        .query({ domain: "modelica" })
        .expect(200);
      assert.equal(lbModelica.body.total, 2);
      assert.equal(lbModelica.body.entries[0].recipeName, "@ms/thermal-1.5b-recipe");
      assert.equal(lbModelica.body.entries[1].recipeName, "@ms/thermal-0.5b-recipe");

      // Filter by parameterScale=<1.5B -> only 0.5B recipe
      const lbSub15 = await request(app)
        .get("/api/v1/memory/leaderboards")
        .query({ parameterScale: "<1.5B" })
        .expect(200);
      assert.equal(lbSub15.body.total, 1);
      assert.equal(lbSub15.body.entries[0].recipeName, "@ms/thermal-0.5b-recipe");

      // Filter by parameterScale=<3B -> 1.5B and 0.5B recipes
      const lbSub3 = await request(app).get("/api/v1/memory/leaderboards").query({ parameterScale: "<3B" }).expect(200);
      assert.equal(lbSub3.body.total, 2);
      assert.equal(lbSub3.body.entries[0].recipeName, "@ms/thermal-1.5b-recipe");
    },
  );

  await t.test("awards computeCreditsAwarded and credits user balance on verified fix_it_bounty patch", async () => {
    const initialBalance = db.billing.getUserCreditBalance(user.id);

    const createRes = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", authHeader)
      .send({
        challengeType: "fix_it_bounty",
        dialect: "modelica",
        title: "Repair unbalanced Modelica thermal ODE",
        prompt: "Fix the missing equation and closing identifier.",
        sourceCode: "model BrokenHeat\n  Real T;\nend Wrong;",
      })
      .expect(201);

    const fixRes = await request(app)
      .post(`/api/v1/rlhf/challenges/${createRes.body.id}/annotate`)
      .set("Authorization", authHeader)
      .send({
        fixedCode: "model BrokenHeat\n  Real T;\nequation\n  der(T) = -0.5 * T;\nend BrokenHeat;",
      })
      .expect(200);

    assert.equal(fixRes.body.computeCreditsAwarded, 25);
    assert.equal(fixRes.body.creditBalance, initialBalance + 25);
    assert.equal(db.billing.getUserCreditBalance(user.id), initialBalance + 25);

    // Re-submitting the same bounty does not double-award credits
    const repeatRes = await request(app)
      .post(`/api/v1/rlhf/challenges/${createRes.body.id}/annotate`)
      .set("Authorization", authHeader)
      .send({
        fixedCode: "model BrokenHeat\n  Real T;\nequation\n  der(T) = -0.25 * T;\nend BrokenHeat;",
      })
      .expect(200);
    assert.equal(repeatRes.body.computeCreditsAwarded, 0);
    assert.equal(db.billing.getUserCreditBalance(user.id), initialBalance + 25);
  });
});
