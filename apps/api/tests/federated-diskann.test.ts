// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { indexBareRepoCommitIntoDiskAnn } from "../src/routes/git-server.js";
import { computeDeterministicEmbedding, computeEmbeddingWithExternalFallback } from "../src/services/diskann-memory.js";
import {
  generateDatasetSigningKeyPair,
  signDatasetManifestEd25519,
  verifyDatasetManifestEd25519,
  type DatasetManifestPayload,
} from "../src/services/federated-diskann.js";
import { LocalGitVaultService } from "../src/services/local-git-vault.js";
import { LibraryStorage } from "../src/storage.js";

test("Tier 1 Auto-Indexing & Tier 3 Federated DiskANN + Ed25519 Signed Dataset Sync", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "federated-diskann-test-"));
  const storageDir = path.join(tmpDir, "storage");
  const db = new LibraryDatabase(tmpDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });

  const openServers: http.Server[] = [];

  t.after(async () => {
    for (const srv of openServers) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  const user = db.createUser("fed_engineer", "fed@modelscript.test", "hash_pw", "Federated Engineer");
  assert.ok(user);
  const authHeader = `Bearer ${jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`;

  await t.test("Ed25519 signs dataset manifests and rejects payload/proof tampering and untrusted keys", () => {
    const keyPairA = generateDatasetSigningKeyPair();
    const keyPairB = generateDatasetSigningKeyPair();

    for (const datasetKind of ["dataset-pretrain", "dataset-posttrain", "training-recipe"] as const) {
      const manifest: DatasetManifestPayload = {
        datasetKind,
        recipeName: `@ms/ansatz-${datasetKind}`,
        recipeVersion: "1.2.0",
        originInstance: "https://node-a.ansatz.test",
        shards: [
          {
            shardId: "a".repeat(64),
            dialect: "modelica",
            mMin: 1,
            mMax: 8,
            exampleCount: 128,
            byteSize: 65536,
          },
        ],
        formalCertSummary: { gate1: true, gate2: true, gate3: true, gate4: true },
      };

      const signed = signDatasetManifestEd25519(manifest, {
        privateKeyPem: keyPairA.privateKeyPem,
        verificationMethod: `https://node-a.ansatz.test/keys#${keyPairA.publicKeyMultibase}`,
      });

      assert.equal(signed.proof.type, "DataIntegrityProof");
      assert.equal(signed.proof.cryptosuite, "eddsa-jcs-2022");
      assert.ok(signed.proof.proofValue.startsWith("z"));
      assert.equal(signed.proof.publicKeyMultibase, keyPairA.publicKeyMultibase);

      // Valid verification with matching key and trusted allowlist
      const ok = verifyDatasetManifestEd25519(signed, {
        expectedPublicKeyMultibase: keyPairA.publicKeyMultibase,
        trustedPublicKeys: [keyPairA.publicKeyMultibase],
      });
      assert.equal(ok.valid, true);
      assert.equal(ok.datasetKind, datasetKind);
      assert.equal(ok.payloadSha256, signed.proof.payloadSha256);

      // Tampering with manifest payload MUST fail
      const tamperedPayload = {
        manifest: { ...signed.manifest, recipeVersion: "9.9.9-evil" },
        proof: signed.proof,
      };
      const tamperResult = verifyDatasetManifestEd25519(tamperedPayload);
      assert.equal(tamperResult.valid, false);
      assert.match(tamperResult.error ?? "", /digest mismatch|tampered/i);

      // Tampering with manifest AND recomputing digest without re-signing MUST fail signature verification
      const forgedDigest = {
        manifest: { ...signed.manifest, recipeVersion: "9.9.9-evil" },
        proof: { ...signed.proof, payloadSha256: undefined },
      };
      const forgedResult = verifyDatasetManifestEd25519(forgedDigest);
      assert.equal(forgedResult.valid, false);
      assert.match(forgedResult.error ?? "", /signature verification failed/i);

      // Tampering with proof metadata (created timestamp) MUST fail
      const tamperedProof = {
        manifest: signed.manifest,
        proof: { ...signed.proof, created: "2020-01-01T00:00:00.000Z" },
      };
      const proofTamperResult = verifyDatasetManifestEd25519(tamperedProof);
      assert.equal(proofTamperResult.valid, false);

      // Wrong expected key / untrusted signer MUST fail
      const wrongKeyResult = verifyDatasetManifestEd25519(signed, {
        expectedPublicKeyPem: keyPairB.publicKeyPem,
      });
      assert.equal(wrongKeyResult.valid, false);

      const untrustedResult = verifyDatasetManifestEd25519(signed, {
        trustedPublicKeys: [keyPairB.publicKeyMultibase],
      });
      assert.equal(untrustedResult.valid, false);
      assert.match(untrustedResult.error ?? "", /trustedPublicKeys/i);
    }

    // Invalid datasetKind rejected
    assert.throws(
      () =>
        signDatasetManifestEd25519({
          datasetKind: "arbitrary-package" as unknown as "training-recipe",
          recipeName: "@ms/invalid",
          recipeVersion: "0.0.1",
        }),
      /Invalid datasetKind/,
    );
  });

  await t.test(
    "computeEmbeddingWithExternalFallback uses OpenAI-compatible /embeddings and falls back cleanly",
    async () => {
      let failMode = false;
      let lastAuthHeader = "";
      let lastEndpoint = "";

      const embServer = http.createServer((req, res) => {
        lastEndpoint = req.url ?? "";
        lastAuthHeader = String(req.headers["authorization"] ?? "");
        if (failMode) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "upstream unavailable" }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              data: [{ embedding: [3, 4, 0, 0, 0, 0, 0, 0] }],
            }),
          );
        });
      });
      await new Promise<void>((resolve) => embServer.listen(0, "127.0.0.1", resolve));
      openServers.push(embServer);
      const port = (embServer.address() as AddressInfo).port;

      // External API returns normalized [0.6, 0.8, 0, ...]
      const extVec = await computeEmbeddingWithExternalFallback(
        "HeatCapacitor thermal inertia",
        ["HeatCapacitor"],
        "modelica",
        8,
        {
          apiUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: "test-emb-key",
          model: "bge-small-en",
        },
      );
      assert.equal(lastEndpoint, "/v1/embeddings");
      assert.equal(lastAuthHeader, "Bearer test-emb-key");
      assert.equal(extVec.length, 8);
      assert.ok(Math.abs(extVec[0]! - 0.6) < 1e-5);
      assert.ok(Math.abs(extVec[1]! - 0.8) < 1e-5);

      // On remote error -> clean fallback to deterministic embedding
      failMode = true;
      const expectedDeterministic = computeDeterministicEmbedding(
        "HeatCapacitor thermal inertia",
        ["HeatCapacitor"],
        "modelica",
        8,
      );
      const fallbackVec = await computeEmbeddingWithExternalFallback(
        "HeatCapacitor thermal inertia",
        ["HeatCapacitor"],
        "modelica",
        8,
        { apiUrl: `http://127.0.0.1:${port}/v1` },
      );
      assert.deepEqual(Array.from(fallbackVec), Array.from(expectedDeterministic));
    },
  );

  await t.test(
    "federated DiskANN fan-out merges peers, deduplicates by chunkId, and enforces public-only isolation",
    async () => {
      // 1. Index a local PUBLIC chunk and a local PRIVATE ORG chunk
      const publicIndexRes = await request(app)
        .post("/api/v1/memory/index/social")
        .set("Authorization", authHeader)
        .send({
          sourceKind: "social-post",
          sourceUri: "social://local/turbine-public-1",
          dialect: "modelica",
          content: "Public Brayton turbine heat exchanger pinch point optimization in Modelica.",
          symbolTags: ["BraytonTurbine", "HeatExchanger"],
          tenantScope: "public",
        })
        .expect(201);
      const localPublicChunkId = publicIndexRes.body.chunkId as string;

      await request(app)
        .post("/api/v1/memory/index/social")
        .set("Authorization", authHeader)
        .set("x-modelscript-org-id", "42")
        .send({
          sourceKind: "social-post",
          sourceUri: "org://42/classified-brayton-alloy",
          dialect: "modelica",
          content: "CLASSIFIED Org42 Brayton turbine heat exchanger superalloy blade tolerance 0.03mm.",
          symbolTags: ["BraytonTurbine", "Org42Secret"],
          tenantScope: "org",
          orgId: 42,
        })
        .expect(201);

      // 2. Start mocked peer Ansatz server recording inbound request body & headers
      const recordedPeerRequests: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
      const peerServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/api/v1/memory/query") {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            const parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
            recordedPeerRequests.push({ body: parsedBody, headers: req.headers });

            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                backend: "diskann",
                latencyMs: 2.1,
                chunks: [
                  {
                    chunkId: "peer-unique-chunk-001",
                    sourceKind: "package-doc",
                    sourceUri: "pkg://@peer/aero-thermal@1.0.0/Brayton.mo",
                    packageName: "@peer/aero-thermal",
                    packageVersion: "1.0.0",
                    dialect: "modelica",
                    score: 0.97,
                    content: "Remote peer Brayton turbine cycle recuperator pressure ratio guidelines.",
                    formalVerified: true,
                    symbolTags: ["BraytonTurbine", "Recuperator"],
                  },
                  {
                    // Duplicate chunkId matching local public chunk with LOWER score -> deduplicated
                    chunkId: localPublicChunkId,
                    sourceKind: "social-post",
                    sourceUri: "social://peer/duplicate-copy",
                    dialect: "modelica",
                    score: 0.01,
                    content: "Duplicate lower-scored copy of local public chunk.",
                    formalVerified: false,
                    symbolTags: ["BraytonTurbine"],
                  },
                  {
                    // Misbehaving peer returning non-public chunk -> dropped by coordinator defense-in-depth
                    chunkId: "peer-rogue-org-chunk",
                    sourceKind: "social-post",
                    sourceUri: "org://99/leaked-secret",
                    dialect: "modelica",
                    score: 0.99,
                    tenantScope: "org",
                    content: "Leaked remote org chunk that must be filtered out.",
                    formalVerified: false,
                    symbolTags: ["BraytonTurbine"],
                  },
                ],
              }),
            );
          });
          return;
        }
        res.statusCode = 404;
        res.end();
      });
      await new Promise<void>((resolve) => peerServer.listen(0, "127.0.0.1", resolve));
      openServers.push(peerServer);
      const peerPort = (peerServer.address() as AddressInfo).port;
      const peerUrl = `http://127.0.0.1:${peerPort}`;

      // 3. Register peer via /api/v1/memory/federated/peers (requires auth)
      await request(app).post("/api/v1/memory/federated/peers").send({ peerUrl, label: "Aero Peer Node" }).expect(401);

      const regRes = await request(app)
        .post("/api/v1/memory/federated/peers")
        .set("Authorization", authHeader)
        .send({ peerUrl, label: "Aero Peer Node" })
        .expect(201);
      assert.equal(regRes.body.success, true);
      assert.equal(regRes.body.peer.peerUrl, peerUrl);

      const listRes = await request(app).get("/api/v1/memory/federated/peers").expect(200);
      assert.equal(listRes.body.total, 1);
      assert.equal(listRes.body.peers[0].peerUrl, peerUrl);

      // 4. Execute federated query while attempting to smuggle org scope & auth headers
      const fedRes = await request(app)
        .post("/api/v1/memory/federated/query")
        .set("Authorization", authHeader)
        .set("x-modelscript-org-id", "42")
        .send({
          mode: "hybrid",
          textQuery: "BraytonTurbine heat exchanger superalloy recuperator",
          tenantScope: "org",
          topK: 10,
        })
        .expect(200);

      assert.equal(fedRes.body.backend, "diskann-federated");
      assert.equal(fedRes.body.enforcedTenantScope, "public");
      assert.equal(fedRes.body.peersQueried, 1);
      assert.equal(fedRes.body.peerStats.length, 1);
      assert.equal(fedRes.body.peerStats[0].peerUrl, peerUrl);
      assert.equal(fedRes.body.peerStats[0].status, "ok");
      assert.equal(typeof fedRes.body.peerStats[0].latencyMs, "number");
      assert.ok(fedRes.body.peerStats[0].latencyMs >= 0);

      // Verify outbound request sent to peer strictly enforced public-only isolation
      assert.equal(recordedPeerRequests.length, 1);
      const peerReq = recordedPeerRequests[0]!;
      assert.equal(peerReq.body["tenantScope"], "public");
      assert.equal(peerReq.body["orgId"], undefined);
      assert.equal(peerReq.headers["x-modelscript-org-id"], undefined);
      assert.equal(peerReq.headers["authorization"], undefined);

      const chunks = fedRes.body.chunks as Array<{
        chunkId: string;
        sourceUri: string;
        originInstance: string;
        content: string;
      }>;

      // Local private org chunk MUST NOT leak into federated query results
      assert.equal(
        chunks.some((c) => c.sourceUri.includes("classified-brayton-alloy") || c.content.includes("CLASSIFIED")),
        false,
      );
      // Remote rogue org chunk MUST be dropped
      assert.equal(
        chunks.some((c) => c.chunkId === "peer-rogue-org-chunk"),
        false,
      );

      // Both local public chunk and remote peer chunk are merged & tagged with originInstance
      const remoteChunk = chunks.find((c) => c.chunkId === "peer-unique-chunk-001");
      assert.ok(remoteChunk, "Expected merged remote peer chunk");
      assert.equal(remoteChunk.originInstance, peerUrl);

      const localChunkMatches = chunks.filter((c) => c.chunkId === localPublicChunkId);
      assert.equal(localChunkMatches.length, 1, "Duplicate chunkId must be deduplicated");
      assert.equal(localChunkMatches[0]!.originInstance, fedRes.body.localInstance);
    },
  );

  await t.test(
    "HTTP endpoints /federated/sign-manifest and /federated/verify-manifest enforce auth and detect tampering",
    async () => {
      const manifest: DatasetManifestPayload = {
        datasetKind: "training-recipe",
        recipeName: "@ms/fluid-dynamics-recipe",
        recipeVersion: "0.4.0",
        shards: [
          {
            shardId: "b".repeat(64),
            dialect: "modelica",
            mMin: 2,
            mMax: 12,
            exampleCount: 64,
            byteSize: 16384,
          },
        ],
      };

      // Unauthenticated sign-manifest MUST return 401
      await request(app).post("/api/v1/memory/federated/sign-manifest").send({ manifest }).expect(401);

      // Authenticated sign-manifest succeeds
      const signRes = await request(app)
        .post("/api/v1/memory/federated/sign-manifest")
        .set("Authorization", authHeader)
        .send({ manifest })
        .expect(200);
      assert.equal(signRes.body.proof.cryptosuite, "eddsa-jcs-2022");
      assert.ok(String(signRes.body.proof.proofValue).startsWith("z"));

      // Verify valid signed manifest
      const verifyOk = await request(app)
        .post("/api/v1/memory/federated/verify-manifest")
        .send({ manifest: signRes.body.manifest, proof: signRes.body.proof })
        .expect(200);
      assert.equal(verifyOk.body.valid, true);
      assert.equal(verifyOk.body.datasetKind, "training-recipe");

      // Verify tampered manifest fails cleanly
      const verifyBad = await request(app)
        .post("/api/v1/memory/federated/verify-manifest")
        .send({
          manifest: { ...signRes.body.manifest, recipeVersion: "0.4.1-tampered" },
          proof: signRes.body.proof,
        })
        .expect(200);
      assert.equal(verifyBad.body.valid, false);
      assert.ok(typeof verifyBad.body.error === "string" && verifyBad.body.error.length > 0);
    },
  );

  await t.test("Tier 1 social auto-indexing indexes public posts and strictly skips non-public posts", async () => {
    await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", authHeader)
      .send({
        content: "Public Modelica note: SynchroPhasorEstimator requires 60Hz sampling cadence.",
        visibility: "public",
        metadata: { dialect: "modelica", symbolTags: ["SynchroPhasorEstimator"] },
      })
      .expect(201);

    await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", authHeader)
      .send({
        content: "Private direct note: SecretDirectTokenAlpha999 must never enter DiskANN.",
        visibility: "direct",
        metadata: { dialect: "modelica", symbolTags: ["SecretDirectTokenAlpha999"] },
      })
      .expect(201);

    await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", authHeader)
      .send({
        content: "Followers-only note: FollowersOnlyTokenBeta888 must never enter DiskANN.",
        visibility: "followers",
        metadata: { dialect: "modelica", symbolTags: ["FollowersOnlyTokenBeta888"] },
      })
      .expect(201);

    // Allow non-blocking setTimeout(..., 0) hook to complete
    await new Promise((resolve) => setTimeout(resolve, 60));

    const publicQuery = await request(app)
      .post("/api/v1/memory/query")
      .send({
        mode: "hybrid",
        textQuery: "SynchroPhasorEstimator 60Hz sampling cadence",
        includeSocialPosts: true,
        topK: 5,
      })
      .expect(200);
    assert.equal(
      publicQuery.body.chunks.some((c: { content: string }) => c.content.includes("SynchroPhasorEstimator")),
      true,
      "Expected newly created public post to be auto-indexed into DiskANN",
    );

    const privateQuery = await request(app)
      .post("/api/v1/memory/query")
      .send({
        mode: "hybrid",
        textQuery: "SecretDirectTokenAlpha999 FollowersOnlyTokenBeta888",
        includeSocialPosts: true,
        topK: 10,
      })
      .expect(200);
    assert.equal(
      privateQuery.body.chunks.some(
        (c: { content: string }) =>
          c.content.includes("SecretDirectTokenAlpha999") || c.content.includes("FollowersOnlyTokenBeta888"),
      ),
      false,
      "Non-public posts must strictly be skipped from DiskANN auto-indexing",
    );
  });

  await t.test(
    "Tier 1 Git auto-indexing incrementally indexes committed engineering files from bare repo",
    async () => {
      const gitBase = path.join(tmpDir, "git-repos");
      const bareRepo = path.join(gitBase, "fed_engineer", "pump-sim.git");
      const workDir = path.join(tmpDir, "pump-sim-work");
      fs.mkdirSync(bareRepo, { recursive: true });
      fs.mkdirSync(workDir, { recursive: true });

      execFileSync("git", ["init", "--bare", bareRepo]);
      execFileSync("git", ["init", workDir]);
      execFileSync("git", ["-C", workDir, "config", "user.email", "fed@modelscript.test"]);
      execFileSync("git", ["-C", workDir, "config", "user.name", "Fed Engineer"]);
      execFileSync("git", ["-C", workDir, "config", "commit.gpgsign", "false"]);
      fs.writeFileSync(
        path.join(workDir, "CentrifugalPump.mo"),
        "model CentrifugalPump\n  parameter Real headGain = 12.5;\n  Real flowRate;\nequation\n  flowRate = headGain * 0.5;\nend CentrifugalPump;\n",
        "utf8",
      );
      execFileSync("git", ["-C", workDir, "add", "CentrifugalPump.mo"]);
      execFileSync("git", ["-C", workDir, "commit", "--no-gpg-sign", "-m", "Add CentrifugalPump model"]);
      execFileSync("git", ["-C", workDir, "push", bareRepo, "HEAD:refs/heads/main"]);

      const vault = new LocalGitVaultService({ gitReposBaseDirs: [gitBase] });
      const result = await indexBareRepoCommitIntoDiskAnn(db, bareRepo, "fed_engineer", "pump-sim", vault);
      assert.equal(result.filesProcessed, 1);
      assert.ok(result.indexedChunks >= 1);

      const queryRes = await request(app)
        .post("/api/v1/memory/query")
        .send({
          mode: "hybrid",
          textQuery: "CentrifugalPump headGain flowRate",
          topK: 5,
        })
        .expect(200);
      assert.equal(
        queryRes.body.chunks.some((c: { content: string }) => c.content.includes("CentrifugalPump")),
        true,
        "Expected pushed Git model file to be indexed into DiskANN",
      );
    },
  );
});
