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
import { annotationCampaignsAndConsensusMigration } from "../src/migrations/0012_annotation_campaigns_and_consensus.js";
import { SqliteMigrationRunner } from "../src/migrations/runner.js";
import { verifyDatasetManifestEd25519 } from "../src/services/federated-diskann.js";
import { LibraryStorage } from "../src/storage.js";

function makeAuthHeader(user: { id: number; username: string; email: string; account_type: string }): string {
  return `Bearer ${jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`;
}

test("Wave A3: RLHF Priority Queue, Blind A/B, Set-Aware Consensus/Adjudication, Campaigns, Leaderboards & Columnar Shard Browser", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rlhf-wave-a3-test-"));
  const storageDir = path.join(tmpDir, "storage");
  const db = new LibraryDatabase(tmpDir);
  const storage = new LibraryStorage(storageDir);

  // Apply Migration 0012 directly on the test DB before mounting routes (so test runs cleanly pre-registration)
  const migrationRunner = new SqliteMigrationRunner(db.db);
  migrationRunner.runPendingSync([annotationCampaignsAndConsensusMigration]);

  // Verify idempotency & schema created by Migration 0012
  await t.test("Migration 0012 creates campaigns/skips tables and adds rlhf_challenges columns idempotently", () => {
    const tables = (
      db.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    ).map((r) => r.name);
    assert.ok(tables.includes("rlhf_campaigns"), "Expected rlhf_campaigns table");
    assert.ok(tables.includes("rlhf_challenge_skips"), "Expected rlhf_challenge_skips table");

    const cols = (db.db.prepare(`PRAGMA table_info(rlhf_challenges)`).all() as { name: string }[]).map((r) => r.name);
    for (const expectedCol of [
      "campaign_id",
      "priority_score",
      "consensus_status",
      "winning_candidate_id",
      "adjudicated_by",
      "adjudication_notes",
      "skip_count",
      "flag_count",
    ]) {
      assert.ok(cols.includes(expectedCol), `Expected rlhf_challenges.${expectedCol}`);
    }

    // Re-running up() directly must be completely idempotent
    annotationCampaignsAndConsensusMigration.up({
      dialect: "sqlite",
      execute: (sql: string) => {
        db.db.exec(sql);
      },
      query: <T = unknown>(sql: string) => db.db.prepare(sql).all() as T[],
      getTableColumns: (table: string) =>
        (db.db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((r) => r.name),
      addColumnIfNotExists: () => {},
      dropColumnIfExists: () => {},
      recreateTable: () => {},
      archiveTable: () => ({ archiveTable: "", rowCount: 0, archivedAt: "" }),
    });
  });

  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  const alice = db.createUser("alice_eng", "alice@modelscript.test", "hash_pw", "Alice Engineer");
  const bob = db.createUser("bob_eng", "bob@modelscript.test", "hash_pw", "Bob Engineer");
  const carol = db.createUser("carol_eng", "carol@modelscript.test", "hash_pw", "Carol Engineer");
  const dave = db.createUser("dave_reviewer", "dave@modelscript.test", "hash_pw", "Dave Adjudicator");
  assert.ok(alice && bob && carol && dave);

  const aliceAuth = makeAuthHeader(alice);
  const bobAuth = makeAuthHeader(bob);
  const carolAuth = makeAuthHeader(carol);
  const daveAuth = makeAuthHeader(dave);

  let lowPriorityId = 0;
  let highPriorityId = 0;
  let highPriorityCandAId = 0;
  let highPriorityCandBId = 0;
  let splitChallengeId = 0;
  let splitCandAId = 0;
  let splitCandBId = 0;
  let conflictChallengeId = 0;
  let conflictCandBId = 0;
  let customCampaignId = 0;

  await t.test("Zonotope-prioritized /queue/next, deterministic blind A/B presentationOrder & skip/flag", async () => {
    // Low priority: small deltaTTrigger, 1 passing / 1 passing
    const lowRes = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", aliceAuth)
      .send({
        challengeType: "pairwise_arena",
        dialect: "scad",
        title: "Low uncertainty bracket",
        prompt: "Simple rectangular plate.",
        deltaTTrigger: 0.05,
        candidates: [
          { label: "model-alpha", code: "wall_thickness = 3.0; cube([10, 10, wall_thickness]);" },
          { label: "model-beta", code: "wall_thickness = 4.0; cube([12, 10, wall_thickness]);" },
        ],
      })
      .expect(201);
    lowPriorityId = lowRes.body.id;

    // High priority: wide Zonotope deltaTTrigger + Gate 3 formal failure
    const highRes = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", aliceAuth)
      .send({
        challengeType: "pairwise_arena",
        dialect: "scad",
        title: "High Zonotope uncertainty housing",
        prompt: "Parametric housing with positive wall thickness.",
        deltaTTrigger: 0.85,
        candidates: [
          { label: "secret-model-A", code: "wall_thickness = 3.5; cube([30, 20, wall_thickness]);" },
          { label: "secret-model-B", code: "wall_thickness = -1.5; cube([30, 20, wall_thickness]);" },
        ],
      })
      .expect(201);
    highPriorityId = highRes.body.id;
    highPriorityCandAId = highRes.body.candidates[0].id;
    highPriorityCandBId = highRes.body.candidates[1].id;

    assert.ok(
      highRes.body.priorityScore > lowRes.body.priorityScore,
      `Expected high priority (${highRes.body.priorityScore}) > low priority (${lowRes.body.priorityScore})`,
    );

    // /queue/next requires auth
    await request(app).get("/api/v1/rlhf/queue/next").expect(401);

    // Highest priority challenge is served first with blind labels hiding raw labels
    const q1 = await request(app)
      .get("/api/v1/rlhf/queue/next")
      .query({ dialect: "scad" })
      .set("Authorization", aliceAuth)
      .expect(200);

    assert.equal(q1.body.remainingCount, 2);
    assert.equal(q1.body.challenge.id, highPriorityId);
    assert.equal(q1.body.challenge.blindMode, true);
    assert.deepEqual(q1.body.presentationOrder, q1.body.challenge.presentationOrder);
    assert.equal(q1.body.presentationOrder.length, 2);
    assert.deepEqual([...q1.body.presentationOrder].sort(), [0, 1]);

    // Raw labels must NOT leak before submission
    for (let i = 0; i < q1.body.challenge.candidates.length; i++) {
      const c = q1.body.challenge.candidates[i];
      assert.equal(c.label, `Option ${i + 1}`);
      assert.equal(c.blindLabel, `Option ${i + 1}`);
      assert.notEqual(c.label, "secret-model-A");
      assert.notEqual(c.label, "secret-model-B");
    }

    // Calling /queue/next again for the same user returns the exact same deterministic presentationOrder
    const q1Repeat = await request(app)
      .get("/api/v1/rlhf/queue/next")
      .query({ dialect: "scad" })
      .set("Authorization", aliceAuth)
      .expect(200);
    assert.deepEqual(q1Repeat.body.presentationOrder, q1.body.presentationOrder);

    // Across multiple extra users, verify blind presentation order shuffles (not always [0, 1])
    const observedOrders = new Set<string>();
    observedOrders.add(JSON.stringify(q1.body.presentationOrder));
    for (let i = 0; i < 12; i++) {
      const u = db.createUser(`blind_user_${i}`, `blind_${i}@modelscript.test`, "pw", `Blind ${i}`);
      assert.ok(u);
      const qU = await request(app)
        .get("/api/v1/rlhf/queue/next")
        .query({ dialect: "scad" })
        .set("Authorization", makeAuthHeader(u))
        .expect(200);
      observedOrders.add(JSON.stringify(qU.body.presentationOrder));
    }
    assert.ok(
      observedOrders.size >= 2,
      `Expected both [0,1] and [1,0] orders across users, saw ${[...observedOrders].join(", ")}`,
    );

    // Dave skips the high-priority challenge -> increments skipCount and serves lowPriorityId next
    const skipRes = await request(app)
      .post(`/api/v1/rlhf/challenges/${highPriorityId}/skip-or-flag`)
      .set("Authorization", daveAuth)
      .send({ reason: "Need CAD tolerance context", isFlag: false })
      .expect(200);
    assert.equal(skipRes.body.skipCount, 1);
    assert.equal(skipRes.body.flagCount, 0);

    const daveNext = await request(app)
      .get("/api/v1/rlhf/queue/next")
      .query({ dialect: "scad" })
      .set("Authorization", daveAuth)
      .expect(200);
    assert.equal(daveNext.body.challenge.id, lowPriorityId);
    assert.equal(daveNext.body.remainingCount, 1);

    // Carol flags lowPriorityId -> increments flagCount
    const flagRes = await request(app)
      .post(`/api/v1/rlhf/challenges/${lowPriorityId}/skip-or-flag`)
      .set("Authorization", carolAuth)
      .send({ reason: "Ambiguous spec", isFlag: true })
      .expect(200);
    assert.equal(flagRes.body.flagCount, 1);
    assert.equal(flagRes.body.skipCount, 0);
  });

  await t.test(
    "Set-Aware Consensus auto-closure, formal conflict guard, and split-tie adjudication workflow",
    async () => {
      // 1. Unanimous 3/3 agreement on highPriorityId (Cand A passes all 4 gates, Cand B fails Gate 3)
      const v1 = await request(app)
        .post(`/api/v1/rlhf/challenges/${highPriorityId}/annotate`)
        .set("Authorization", aliceAuth)
        .send({ preferredCandidateId: highPriorityCandAId, preferenceOutcome: "candidate" })
        .expect(200);
      assert.equal(v1.body.consensus.status, "pending");

      const v2 = await request(app)
        .post(`/api/v1/rlhf/challenges/${highPriorityId}/annotate`)
        .set("Authorization", bobAuth)
        .send({ preferredCandidateId: highPriorityCandAId, preferenceOutcome: "candidate" })
        .expect(200);
      assert.equal(v2.body.consensus.status, "pending");

      const v3 = await request(app)
        .post(`/api/v1/rlhf/challenges/${highPriorityId}/annotate`)
        .set("Authorization", carolAuth)
        .send({ preferredCandidateId: highPriorityCandAId, preferenceOutcome: "candidate" })
        .expect(200);
      assert.equal(v3.body.consensus.status, "consensus_reached");
      assert.equal(v3.body.consensus.winningCandidateId, highPriorityCandAId);
      assert.equal(v3.body.consensus.agreementRatio, 1);
      assert.equal(v3.body.consensus.setDominance.hasFormalDominance, true);
      assert.equal(v3.body.consensus.setDominance.dominantCandidateId, highPriorityCandAId);
      assert.equal(v3.body.consensus.setDominance.alignedWithVotes, true);
      assert.equal(v3.body.consensus.setDominance.formalConflict, false);

      const detailResolved = await request(app).get(`/api/v1/rlhf/challenges/${highPriorityId}`).expect(200);
      assert.equal(detailResolved.body.challenge.consensusStatus, "consensus_reached");
      assert.equal(detailResolved.body.challenge.winningCandidateId, highPriorityCandAId);
      assert.equal(detailResolved.body.challenge.status, "resolved");

      // 2. Split 2 vs 1 vote (0.6667 < 0.75 threshold) -> triggers needs_adjudication
      const splitCreate = await request(app)
        .post("/api/v1/rlhf/challenges")
        .set("Authorization", aliceAuth)
        .send({
          challengeType: "pairwise_arena",
          dialect: "modelica",
          title: "Split RC damper comparison",
          prompt: "Compare two valid Modelica RC thermal models.",
          deltaTTrigger: 0.4,
          candidates: [
            {
              label: "A",
              code: "model RC_A\n  parameter Real R = 10.0;\n  Real T;\nequation\n  der(T) = -T / R;\nend RC_A;",
            },
            {
              label: "B",
              code: "model RC_B\n  parameter Real R = 5.0;\n  Real T;\nequation\n  der(T) = -T / R;\nend RC_B;",
            },
          ],
        })
        .expect(201);
      splitChallengeId = splitCreate.body.id;
      splitCandAId = splitCreate.body.candidates[0].id;
      splitCandBId = splitCreate.body.candidates[1].id;

      await request(app)
        .post(`/api/v1/rlhf/challenges/${splitChallengeId}/annotate`)
        .set("Authorization", aliceAuth)
        .send({ preferredCandidateId: splitCandAId, preferenceOutcome: "candidate" })
        .expect(200);
      await request(app)
        .post(`/api/v1/rlhf/challenges/${splitChallengeId}/annotate`)
        .set("Authorization", bobAuth)
        .send({ preferredCandidateId: splitCandAId, preferenceOutcome: "candidate" })
        .expect(200);
      const splitV3 = await request(app)
        .post(`/api/v1/rlhf/challenges/${splitChallengeId}/annotate`)
        .set("Authorization", carolAuth)
        .send({ preferredCandidateId: splitCandBId, preferenceOutcome: "candidate" })
        .expect(200);
      assert.equal(splitV3.body.consensus.status, "needs_adjudication");
      assert.equal(splitV3.body.consensus.winningCandidateId, null);

      // 3. Formal Set Dominance conflict: 3/3 crowd votes for broken Candidate B while A passes all 4 gates -> needs_adjudication!
      const conflictCreate = await request(app)
        .post("/api/v1/rlhf/challenges")
        .set("Authorization", aliceAuth)
        .send({
          challengeType: "pairwise_arena",
          dialect: "scad",
          title: "Formal dominance conflict test",
          prompt: "Valid cylinder vs negative radius cylinder.",
          candidates: [
            { label: "A", code: "cylinder(r = 5, h = 10);" },
            { label: "B", code: "radius = -5; cylinder(r = radius, h = 10);" },
          ],
        })
        .expect(201);
      conflictChallengeId = conflictCreate.body.id;
      conflictCandBId = conflictCreate.body.candidates[1].id;

      for (const auth of [aliceAuth, bobAuth, carolAuth]) {
        await request(app)
          .post(`/api/v1/rlhf/challenges/${conflictChallengeId}/annotate`)
          .set("Authorization", auth)
          .send({ preferredCandidateId: conflictCandBId, preferenceOutcome: "candidate" })
          .expect(200);
      }

      // Both splitChallengeId and conflictChallengeId appear on GET /api/v1/rlhf/adjudication
      const adjList = await request(app).get("/api/v1/rlhf/adjudication").expect(200);
      const adjIds = adjList.body.challenges.map((c: { id: number }) => c.id);
      assert.ok(adjIds.includes(splitChallengeId), "Expected splitChallengeId in adjudication queue");
      assert.ok(adjIds.includes(conflictChallengeId), "Expected conflictChallengeId in adjudication queue");
      const conflictEntry = adjList.body.challenges.find((c: { id: number }) => c.id === conflictChallengeId);
      assert.equal(conflictEntry.voteSummary.setDominance.formalConflict, true);

      // Reviewer adjudicates splitChallengeId -> transitions to 'adjudicated' and leaves queue
      const adjRes = await request(app)
        .post(`/api/v1/rlhf/challenges/${splitChallengeId}/adjudicate`)
        .set("Authorization", daveAuth)
        .send({
          winningCandidateId: splitCandAId,
          adjudicationNotes: "RC_A time constant matches thermal spec.",
        })
        .expect(200);
      assert.equal(adjRes.body.consensusStatus, "adjudicated");
      assert.equal(adjRes.body.winningCandidateId, splitCandAId);
      assert.equal(adjRes.body.adjudicatedBy, dave.id);

      const adjListAfter = await request(app).get("/api/v1/rlhf/adjudication").expect(200);
      assert.equal(
        adjListAfter.body.challenges.some((c: { id: number }) => c.id === splitChallengeId),
        false,
      );
    },
  );

  await t.test("Campaign creation, custom campaign quorum & Annotator Leaderboard ranking", async () => {
    const campRes = await request(app)
      .post("/api/v1/rlhf/campaigns")
      .set("Authorization", aliceAuth)
      .send({
        slug: "cad-tolerance-sprint-q4",
        title: "CAD Tolerance Sprint Q4",
        description: "Verify parametric OpenSCAD housings.",
        dialect: "scad",
        challengeType: "pairwise_arena",
        targetAnnotations: 20,
        consensusMinVotes: 2,
        consensusAgreementThreshold: 0.75,
        bountyPoints: 30,
      })
      .expect(201);
    customCampaignId = campRes.body.id;
    assert.equal(campRes.body.campaign.slug, "cad-tolerance-sprint-q4");
    assert.equal(campRes.body.campaign.consensusMinVotes, 2);

    // Create a campaign-linked challenge and verify 2 votes reach consensus (honoring campaign's consensusMinVotes=2)
    const chRes = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", aliceAuth)
      .send({
        campaignId: customCampaignId,
        challengeType: "pairwise_arena",
        dialect: "scad",
        title: "Campaign bracket",
        prompt: "Pick valid bracket.",
        candidates: [
          { label: "A", code: "wall_thickness = 2.5; cube([20, 10, wall_thickness]);" },
          { label: "B", code: "wall_thickness = -1.0; cube([20, 10, wall_thickness]);" },
        ],
      })
      .expect(201);
    const campCandAId = chRes.body.candidates[0].id;

    await request(app)
      .post(`/api/v1/rlhf/challenges/${chRes.body.id}/annotate`)
      .set("Authorization", aliceAuth)
      .send({ preferredCandidateId: campCandAId, preferenceOutcome: "candidate" })
      .expect(200);
    const campV2 = await request(app)
      .post(`/api/v1/rlhf/challenges/${chRes.body.id}/annotate`)
      .set("Authorization", bobAuth)
      .send({ preferredCandidateId: campCandAId, preferenceOutcome: "candidate" })
      .expect(200);
    assert.equal(campV2.body.consensus.status, "consensus_reached");
    assert.equal(campV2.body.consensus.consensusMinVotes, 2);

    const listCamps = await request(app).get("/api/v1/rlhf/campaigns").query({ dialect: "scad" }).expect(200);
    const foundCamp = listCamps.body.campaigns.find((c: { id: number }) => c.id === customCampaignId);
    assert.ok(foundCamp);
    assert.equal(foundCamp.challengeCount, 1);
    assert.equal(foundCamp.resolvedChallengeCount, 1);
    assert.equal(foundCamp.completedAnnotations, 2);

    // Honeypot calibration: Alice hits, Bob misses -> Alice must outrank Bob on leaderboard!
    const hpCreate = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", daveAuth)
      .send({
        challengeType: "pairwise_arena",
        dialect: "scad",
        title: "Honeypot calibration",
        prompt: "Valid cube vs negative thickness cube.",
        isHoneypot: true,
        goldAnswer: { preferredLabel: "A" },
        candidates: [
          { label: "A", code: "wall_thickness = 3.0; cube([10, 10, wall_thickness]);" },
          { label: "B", code: "wall_thickness = -3.0; cube([10, 10, wall_thickness]);" },
        ],
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/rlhf/challenges/${hpCreate.body.id}/annotate`)
      .set("Authorization", aliceAuth)
      .send({ preferredCandidateId: hpCreate.body.candidates[0].id, preferenceOutcome: "candidate" })
      .expect(200);
    await request(app)
      .post(`/api/v1/rlhf/challenges/${hpCreate.body.id}/annotate`)
      .set("Authorization", bobAuth)
      .send({ preferredCandidateId: hpCreate.body.candidates[1].id, preferenceOutcome: "candidate" })
      .expect(200);

    const lbRes = await request(app).get("/api/v1/rlhf/leaderboard").query({ domain: "scad" }).expect(200);
    assert.equal(lbRes.body.domain, "scad");
    assert.ok(lbRes.body.leaderboard.length >= 2);
    assert.equal(lbRes.body.leaderboard[0].username, "alice_eng");
    assert.equal(lbRes.body.leaderboard[0].rank, 1);
    assert.equal(lbRes.body.leaderboard[0].honeypotAccuracy, 1);
    const bobRow = lbRes.body.leaderboard.find((r: { username: string }) => r.username === "bob_eng");
    assert.ok(bobRow);
    assert.equal(bobRow.honeypotAccuracy, 0);
    assert.ok(lbRes.body.leaderboard[0].trustScore > bobRow.trustScore);
  });

  await t.test(
    "Columnar /recipes/browse-shard, /recipes/bulk-action (quarantine & spawn_campaign) & /recipes/release-posttrain",
    async () => {
      // 1. Compile a dataset shard via /api/v1/memory/datasets/compile
      const compileRes = await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", aliceAuth)
        .send({
          recipeName: "@ms/wave-a3-recipe",
          recipeVersion: "1.0.0",
          datasetKind: "training-recipe",
          examplesPerShard: 16,
          mCap: 32,
          files: [
            {
              uri: "models/ThermalSimple.mo",
              dialect: "modelica",
              source: "model ThermalSimple\n  Real T;\nequation\n  T = 1.0;\nend ThermalSimple;",
            },
            {
              uri: "models/ThermalComplex.mo",
              dialect: "modelica",
              source:
                "model ThermalComplex\n  parameter Real R1 = 10.0;\n  parameter Real R2 = 20.0;\n  parameter Real C1 = 0.5;\n  Real T1;\n  Real T2;\n  Real Q;\nequation\n  C1 * der(T1) = Q;\n  Q = (T2 - T1) / R1;\n  T2 = R2 * 0.1;\nend ThermalComplex;",
            },
            {
              uri: "cad/Flange.scad",
              dialect: "scad",
              source: "wall_thickness = 4.0; radius = 12.0; cylinder(r = radius, h = wall_thickness);",
            },
          ],
        })
        .expect(201);

      assert.ok(compileRes.body.shards.length >= 1);
      const shardId = compileRes.body.shards[0].shardId as string;

      // Browse compiled shard by shardId with sorting & pagination
      const browseShardRes = await request(app)
        .post("/api/v1/recipes/browse-shard")
        .send({
          shardId,
          sort: "tokens_desc",
          page: 1,
          pageSize: 2,
        })
        .expect(200);

      assert.equal(browseShardRes.body.shardId, shardId);
      assert.ok(browseShardRes.body.total >= 1);
      assert.ok(browseShardRes.body.rows.length <= 2);
      if (browseShardRes.body.rows.length === 2) {
        assert.ok(browseShardRes.body.rows[0].tokenCount >= browseShardRes.body.rows[1].tokenCount);
      }

      // 2. Bulk quarantine selected rows via POST /api/v1/recipes/bulk-action
      const targetExampleId = browseShardRes.body.rows[0].exampleId as string;
      const bulkQuarantineRes = await request(app)
        .post("/api/v1/recipes/bulk-action")
        .set("Authorization", aliceAuth)
        .send({
          action: "quarantine",
          recipeName: "@ms/wave-a3-recipe",
          exampleIds: [targetExampleId, "models/ThermalSimple.mo"],
          reason: "Suspected eval contamination",
        })
        .expect(201);

      assert.equal(bulkQuarantineRes.body.action, "quarantine");
      assert.equal(bulkQuarantineRes.body.quarantinedCount, 2);

      // Re-browse shard filtering by quarantined: true -> must surface the quarantined row!
      const browseQuarantined = await request(app)
        .post("/api/v1/recipes/browse-shard")
        .send({
          shardId,
          filters: { quarantined: true },
        })
        .expect(200);
      assert.ok(browseQuarantined.body.total >= 1);
      assert.equal(browseQuarantined.body.rows[0].quarantined, true);

      // 3. Browse inline examples with dialect, mMin, gatePassed, search filters
      const inlineExamples = [
        {
          exampleId: "ex_good_mo",
          uri: "models/GoodRC.mo",
          dialect: "modelica",
          source: "model GoodRC\n  parameter Real R = 50.0;\n  Real v;\nequation\n  v = R * 0.5;\nend GoodRC;",
        },
        {
          exampleId: "ex_bad_mo",
          uri: "models/BrokenEnd.mo",
          dialect: "modelica",
          source: "model BrokenEnd\n  Real T;\nend WrongEnd;",
        },
        {
          exampleId: "ex_bad_scad",
          uri: "cad/NegWall.scad",
          dialect: "scad",
          source: "wall_thickness = -4.0; cube([10, 10, wall_thickness]);",
        },
      ];

      const failingBrowse = await request(app)
        .post("/api/v1/recipes/browse-shard")
        .send({
          examples: inlineExamples,
          gatePassed: false,
          sort: "m_init_asc",
        })
        .expect(200);
      assert.equal(failingBrowse.body.total, 2);
      assert.ok(failingBrowse.body.rows.every((r: { gatePassed: boolean }) => r.gatePassed === false));

      const searchBrowse = await request(app)
        .post("/api/v1/recipes/browse-shard")
        .send({
          examples: inlineExamples,
          dialect: "scad",
          search: "NegWall",
        })
        .expect(200);
      assert.equal(searchBrowse.body.total, 1);
      assert.equal(searchBrowse.body.rows[0].exampleId, "ex_bad_scad");

      // 4. Bulk action: spawn_campaign creates an rlhf_campaigns sprint + rlhf_challenges for every failing example
      const spawnRes = await request(app)
        .post("/api/v1/recipes/bulk-action")
        .set("Authorization", aliceAuth)
        .send({
          action: "spawn_campaign",
          recipeName: "@ms/wave-a3-recipe",
          examples: inlineExamples,
          campaign: {
            title: "Broken Gate Repair Sprint",
            bountyPoints: 40,
          },
        })
        .expect(201);

      assert.equal(spawnRes.body.action, "spawn_campaign");
      assert.equal(spawnRes.body.spawnedCount, 2, "Expected 2 challenges spawned for the 2 failing examples");
      assert.equal(spawnRes.body.skippedPassingCount, 1, "Expected 1 passing example skipped");
      assert.ok(spawnRes.body.campaign.id > 0);

      // Spawned campaign challenges are immediately servable via /api/v1/rlhf/queue/next?campaignId=...
      const spawnedQueueRes = await request(app)
        .get("/api/v1/rlhf/queue/next")
        .query({ campaignId: String(spawnRes.body.campaign.id) })
        .set("Authorization", bobAuth)
        .expect(200);
      assert.equal(spawnedQueueRes.body.remainingCount, 2);
      assert.equal(spawnedQueueRes.body.challenge.campaignId, spawnRes.body.campaign.id);

      // 5. Add a non-public (org-private) consensus challenge to verify release-posttrain excludes it!
      const privateCh = await request(app)
        .post("/api/v1/rlhf/challenges")
        .set("Authorization", aliceAuth)
        .send({
          campaignId: customCampaignId,
          challengeType: "pairwise_arena",
          dialect: "scad",
          title: "Org-private proprietary housing",
          prompt: "Must NOT leak into public posttrain snapshot.",
          aiGovernance: {
            allowRag: true,
            allowPretrain: false,
            allowPosttrain: true,
            tenantScope: "org",
          },
          candidates: [
            { label: "A", code: "wall_thickness = 5.0; cube([10, 10, wall_thickness]);" },
            { label: "B", code: "wall_thickness = -5.0; cube([10, 10, wall_thickness]);" },
          ],
        })
        .expect(201);
      for (const auth of [aliceAuth, bobAuth]) {
        await request(app)
          .post(`/api/v1/rlhf/challenges/${privateCh.body.id}/annotate`)
          .set("Authorization", auth)
          .send({ preferredCandidateId: privateCh.body.candidates[0].id, preferenceOutcome: "candidate" })
          .expect(200);
      }

      // 6. POST /api/v1/recipes/release-posttrain -> snapshots consensus_reached + adjudicated public challenges into signed dataset-posttrain shards!
      const releaseRes = await request(app)
        .post("/api/v1/recipes/release-posttrain")
        .set("Authorization", daveAuth)
        .send({
          recipeName: "@ms/wave-a3-posttrain",
          recipeVersion: "1.0.0",
          examplesPerShard: 8,
          mCap: 32,
        })
        .expect(201);

      assert.equal(releaseRes.body.success, true);
      assert.equal(releaseRes.body.datasetKind, "dataset-posttrain");
      assert.equal(releaseRes.body.excludedNonPublicCount, 1, "Org-private challenge must be excluded");
      assert.ok(
        releaseRes.body.includedChallengeIds.includes(highPriorityId),
        "Consensus-reached challenge must be included",
      );
      assert.ok(
        releaseRes.body.includedChallengeIds.includes(splitChallengeId),
        "Adjudicated challenge must be included",
      );
      assert.equal(
        releaseRes.body.includedChallengeIds.includes(privateCh.body.id),
        false,
        "Non-public challenge must NOT be in release",
      );
      assert.equal(
        releaseRes.body.includedChallengeIds.includes(conflictChallengeId),
        false,
        "Unadjudicated needs_adjudication challenge must NOT be in release",
      );
      assert.ok(releaseRes.body.shards.length >= 1);
      assert.equal(releaseRes.body.shards[0].datasetKind, "dataset-posttrain");

      // Verify Ed25519 signature over release manifest!
      const verifyRes = verifyDatasetManifestEd25519(releaseRes.body.signedManifest);
      assert.equal(verifyRes.valid, true, `Expected valid Ed25519 manifest signature, got: ${verifyRes.error ?? ""}`);
      assert.equal(verifyRes.datasetKind, "dataset-posttrain");

      // And the newly released post-train shard can itself be browsed via /api/v1/recipes/browse-shard!
      const browsePosttrain = await request(app)
        .post("/api/v1/recipes/browse-shard")
        .send({ shardId: releaseRes.body.shards[0].shardId })
        .expect(200);
      assert.ok(browsePosttrain.body.total >= 1);
    },
  );
});
