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

test("Recipe Debugger, Pre-Flight, Semantic Diff, Decontamination, X-Ray, Overlay Patches & Blast-Radius Lineage API", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-debug-test-"));
  const storageDir = path.join(tmpDir, "storage");
  const db = new LibraryDatabase(tmpDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  const user = db.createUser("recipe_debugger", "debugger@modelscript.test", "hash_pw", "Recipe Debugger");
  assert.ok(user);
  const authHeader = `Bearer ${jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`;

  // Seed DiskANN memory with public symbols + an org-private symbol
  await request(app)
    .post("/api/v1/memory/index/social")
    .set("Authorization", authHeader)
    .send({
      sourceKind: "rlhf-verified-fix",
      sourceUri: "pkg://@ms/thermal-pack@1.0.0/models/HeatCapacitor.mo",
      dialect: "modelica",
      content: "Verified thermal capacitance model linking R_load and V_source.",
      symbolTags: ["R_load", "V_source", "HeatCapacitor"],
      formalVerified: true,
      tenantScope: "public",
    })
    .expect(201);

  await request(app)
    .post("/api/v1/memory/index/social")
    .set("Authorization", authHeader)
    .set("x-modelscript-org-id", "42")
    .send({
      sourceKind: "social-post",
      sourceUri: "org://42/models/OrgSecretBlade.mo",
      dialect: "modelica",
      content: "Proprietary org 42 thermal parameter org_secret_gain.",
      symbolTags: ["org_secret_gain"],
      tenantScope: "org",
      orgId: 42,
    })
    .expect(201);

  await t.test(
    "POST /api/v1/recipes/preflight audits live DiskANN symbol coverage with RBAC + bucketing VRAM savings",
    async () => {
      const examples = [
        {
          uri: "models/RC.mo",
          dialect: "modelica",
          source:
            "model RC parameter Real R_load = 100; parameter Real unindexed_cap = 0.01; Real V_source; equation V_source = R_load * unindexed_cap; end RC;",
        },
        {
          uri: "models/OrgBlade.mo",
          dialect: "modelica",
          source:
            "model OrgBlade parameter Real org_secret_gain = 4.2; Real temp; equation temp = org_secret_gain * 2.0; end OrgBlade;",
        },
        {
          uri: "cad/Bracket.scad",
          dialect: "scad",
          source: "wall_thickness = 3.0; cube([20, 10, wall_thickness]);",
        },
      ];

      // 1. Public caller (no org header): R_load & V_source covered, org_secret_gain & unindexed_cap missing
      const publicRes = await request(app)
        .post("/api/v1/recipes/preflight")
        .send({ examples, batchSize: 2, mCap: 32 })
        .expect(200);

      assert.equal(publicRes.body.totalExamples, 3);
      assert.equal(publicRes.body.dialectCounts.modelica, 2);
      assert.equal(publicRes.body.dialectCounts.scad, 1);
      assert.equal(publicRes.body.bucketingEfficiency.batchSize, 2);
      assert.equal(publicRes.body.bucketingEfficiency.mCap, 32);
      assert.ok(publicRes.body.bucketingEfficiency.estimatedVramSavingsPct >= 0);
      assert.ok(publicRes.body.diskAnnCoverage.uniqueExampleSymbols > 0);
      assert.ok(publicRes.body.diskAnnCoverage.coveredSymbols >= 1);
      assert.ok(
        publicRes.body.diskAnnCoverage.missingSymbols.includes("unindexed_cap"),
        "Expected unindexed_cap to be reported as missing from DiskANN",
      );
      assert.ok(
        publicRes.body.diskAnnCoverage.missingSymbols.includes("org_secret_gain"),
        "Expected org-private symbol org_secret_gain to remain hidden from public caller",
      );

      // 2. Org 42 caller: org_secret_gain IS now covered!
      const org42Res = await request(app)
        .post("/api/v1/recipes/preflight")
        .set("x-modelscript-org-id", "42")
        .send({ examples, batchSize: 2, mCap: 32 })
        .expect(200);

      assert.equal(
        org42Res.body.diskAnnCoverage.missingSymbols.includes("org_secret_gain"),
        false,
        "Expected org 42 caller to have DiskANN coverage for org_secret_gain",
      );
      assert.ok(
        org42Res.body.diskAnnCoverage.coveredSymbols > publicRes.body.diskAnnCoverage.coveredSymbols,
        "Org 42 caller should see strictly higher DiskANN symbol coverage",
      );

      // 3. Opt-out of DiskANN coverage check
      const noDiskAnnRes = await request(app)
        .post("/api/v1/recipes/preflight")
        .send({ examples, includeDiskAnnCoverage: false })
        .expect(200);

      assert.equal(noDiskAnnRes.body.diskAnnCoverage.coverageRatio, 1);
      assert.deepEqual(noDiskAnnRes.body.diskAnnCoverage.missingSymbols, []);

      // 4. Invalid body returns 400
      await request(app).post("/api/v1/recipes/preflight").send({ examples: "not-an-array" }).expect(400);
    },
  );

  await t.test("POST /api/v1/recipes/diff computes semantic dataset version diff", async () => {
    const before = [
      { uri: "models/A.mo", dialect: "modelica", source: "model A Real x; equation x = 1; end A;" },
      { uri: "models/Old.mo", dialect: "modelica", source: "model Old Real y; equation y = 2; end Old;" },
    ];
    const after = [
      {
        uri: "models/A.mo",
        dialect: "modelica",
        source: "model A Real x; Real z; equation x = 1; z = x + 3; end A;",
      },
      { uri: "cad/Plate.scad", dialect: "scad", source: "thickness = 4; cube([10, 10, thickness]);" },
    ];

    const diffRes = await request(app).post("/api/v1/recipes/diff").send({ before, after }).expect(200);

    assert.equal(diffRes.body.beforeCount, 2);
    assert.equal(diffRes.body.afterCount, 2);
    assert.deepEqual(diffRes.body.addedUris, ["cad/Plate.scad"]);
    assert.deepEqual(diffRes.body.removedUris, ["models/Old.mo"]);
    assert.deepEqual(diffRes.body.modifiedUris, ["models/A.mo"]);
    assert.equal(diffRes.body.dialectDelta.modelica, -1);
    assert.equal(diffRes.body.dialectDelta.scad, 1);
    assert.equal(typeof diffRes.body.estimatedMemoryMultiplier, "number");
    assert.ok(diffRes.body.estimatedMemoryMultiplier > 0);
  });

  await t.test("POST /api/v1/recipes/decontaminate flags exact and near-duplicate train/eval leakage", async () => {
    const evalSet = [
      {
        exampleId: "eval_rc_1",
        uri: "eval/RC.mo",
        dialect: "modelica",
        source: "model EvalRC parameter Real R = 50; Real i; Real v; equation v = R * i; i = 0.2; end EvalRC;",
      },
    ];
    const trainSet = [
      {
        exampleId: "train_exact",
        uri: "train/RC_copy.mo",
        dialect: "modelica",
        source: "model   EvalRC   parameter Real R = 50; Real i; Real v; equation v = R * i; i = 0.2; end EvalRC;",
      },
      {
        exampleId: "train_near",
        uri: "train/RC_near.mo",
        dialect: "modelica",
        source: "model EvalRC parameter Real R = 50; Real i; Real v; equation v = R * i; i = 0.3; end EvalRC;",
      },
      {
        exampleId: "train_clean",
        uri: "train/SpringDamper.mo",
        dialect: "modelica",
        source: "model SpringDamper parameter Real k = 12; Real f; Real x; equation f = k * x; end SpringDamper;",
      },
    ];

    const res = await request(app)
      .post("/api/v1/recipes/decontaminate")
      .send({ train: trainSet, eval: evalSet, nearDuplicateThreshold: 0.6 })
      .expect(200);

    assert.equal(res.body.trainCount, 3);
    assert.equal(res.body.evalCount, 1);
    assert.equal(res.body.contaminatedCount, 2);
    assert.ok(res.body.matches.some((m: { matchKind: string }) => m.matchKind === "exact-hash"));
    assert.ok(res.body.matches.some((m: { matchKind: string }) => m.matchKind === "near-duplicate"));
    assert.ok(res.body.recommendedQuarantineIds.includes("train_exact"));
    assert.ok(res.body.recommendedQuarantineIds.includes("train_near"));
    assert.equal(res.body.recommendedQuarantineIds.includes("train_clean"), false);
    assert.equal(res.body.isomorphicReport, undefined);
  });

  await t.test(
    "POST /api/v1/recipes/decontaminate with isomorphic: true catches variable-renamed Modelica leak",
    async () => {
      const evalSet = [
        {
          exampleId: "eval_ohm_1",
          uri: "eval/OhmCircuit.mo",
          dialect: "modelica",
          source:
            "model OhmCircuit\n  parameter Real R_load = 100.0;\n  Real v_drop;\n  Real i_branch;\nequation\n  v_drop = R_load * i_branch;\n  i_branch = 0.25;\nend OhmCircuit;",
        },
      ];
      const trainSet = [
        {
          exampleId: "train_renamed_leak",
          uri: "train/ConductanceClone.mo",
          dialect: "modelica",
          source:
            "model ConductanceClone\n  parameter Real Z_coil = 420.0;\n  Real u_term;\n  Real j_wire;\nequation\n  u_term = Z_coil * j_wire;\n  j_wire = 1.75;\nend ConductanceClone;",
        },
        {
          exampleId: "train_unrelated",
          uri: "train/Decay.mo",
          dialect: "modelica",
          source:
            "model Decay\n  parameter Real tau = 5.0;\n  Real state(start = 1.0);\nequation\n  der(state) = -state / tau;\nend Decay;",
        },
      ];

      const res = await request(app)
        .post("/api/v1/recipes/decontaminate")
        .send({ train: trainSet, eval: evalSet, isomorphic: true, nearDuplicateThreshold: 0.85 })
        .expect(200);

      // Existing response fields preserved for backward compatibility
      assert.equal(res.body.trainCount, 2);
      assert.equal(res.body.evalCount, 1);
      assert.equal(Array.isArray(res.body.matches), true);

      // Isomorphic report catches the renamed-variable + rescaled-parameter clone
      assert.ok(res.body.isomorphicReport, "Expected isomorphicReport when isomorphic === true");
      assert.equal(res.body.isomorphicReport.trainCount, 2);
      assert.equal(res.body.isomorphicReport.evalCount, 1);
      assert.ok(res.body.isomorphicReport.isomorphicLeakCount >= 1);
      assert.ok(
        res.body.isomorphicReport.matches.some(
          (m: { trainExampleId: string; matchKind: string }) =>
            m.trainExampleId === "train_renamed_leak" && m.matchKind === "hypergraph-isomorphic",
        ),
        "Expected variable-renamed Modelica model to be flagged as hypergraph-isomorphic leak",
      );
      assert.ok(res.body.isomorphicReport.recommendedQuarantineIds.includes("train_renamed_leak"));
      assert.equal(res.body.isomorphicReport.recommendedQuarantineIds.includes("train_unrelated"), false);
    },
  );

  await t.test(
    "POST /api/v1/recipes/coverage-and-fill detects manifold holes and synthesizes 4-gate certified variants",
    async () => {
      const examples = [
        {
          exampleId: "ex_rc_1",
          uri: "models/RCFilter.mo",
          dialect: "modelica",
          source:
            "model RCFilter\n  parameter Real R = 100.0;\n  parameter Real C = 0.01;\n  Real v;\n  Real i;\nequation\n  v = R * i;\n  i = C * 5.0;\nend RCFilter;",
        },
        {
          exampleId: "ex_rc_2",
          uri: "models/RCFilter2.mo",
          dialect: "modelica",
          source:
            "model RCFilter2\n  parameter Real R = 100.0;\n  parameter Real C = 0.01;\n  Real v;\n  Real i;\nequation\n  v = R * i;\n  i = C * 5.0;\nend RCFilter2;",
        },
      ];

      const res = await request(app)
        .post("/api/v1/recipes/coverage-and-fill")
        .send({ examples, count: 4, deltaFraction: 0.12 })
        .expect(200);

      assert.equal(res.body.coverage.totalExamples, 2);
      assert.equal(typeof res.body.coverageScore, "number");
      assert.ok(res.body.coverageScore >= 0 && res.body.coverageScore <= 1);
      assert.ok(Array.isArray(res.body.mInitBands) && res.body.mInitBands.length > 0);
      assert.ok(Array.isArray(res.body.manifoldHoles) && res.body.manifoldHoles.length > 0);

      assert.ok(res.body.synthesis, "Expected ConstrainedZonotope synthesis payload");
      assert.equal(res.body.synthesis.feasible, true);
      assert.equal(res.body.synthesis.dialect, "modelica");
      assert.equal(res.body.synthesis.deltaFraction, 0.12);
      assert.equal(res.body.variants.length, 4);

      for (const variant of res.body.variants as {
        source: string;
        parameters: Record<string, number>;
        formalCert: {
          gate1GlrSyntax: boolean;
          gate2QudvUnits: boolean;
          gate3SmtFeasibility: boolean;
          gate4DaeBalance: boolean;
        };
        gatePassed: boolean;
      }[]) {
        assert.equal(typeof variant.source, "string");
        assert.ok(variant.source.includes("model RCFilter"));
        assert.ok(variant.parameters["R"]! >= 88 && variant.parameters["R"]! <= 112);
        assert.ok(variant.parameters["C"]! > 0);
        assert.equal(typeof variant.formalCert.gate1GlrSyntax, "boolean");
        assert.equal(typeof variant.formalCert.gate2QudvUnits, "boolean");
        assert.equal(typeof variant.formalCert.gate3SmtFeasibility, "boolean");
        assert.equal(typeof variant.formalCert.gate4DaeBalance, "boolean");
        assert.equal(
          variant.gatePassed,
          true,
          "Synthesized ConstrainedZonotope variant should pass all 4 formal gates",
        );
      }

      // Explicit seedSource override works too
      const customSeedRes = await request(app)
        .post("/api/v1/recipes/coverage-and-fill")
        .send({
          examples,
          seedSource:
            "model ThermalMass\n  parameter Real Cp = 500.0;\n  Real T;\nequation\n  T = Cp * 0.5;\nend ThermalMass;",
          dialect: "modelica",
          count: 2,
          deltaFraction: 0.15,
        })
        .expect(200);

      assert.equal(customSeedRes.body.variants.length, 2);
      assert.ok(customSeedRes.body.variants[0].source.includes("model ThermalMass"));

      // Invalid payload returns 400
      await request(app).post("/api/v1/recipes/coverage-and-fill").send({ examples: "bad" }).expect(400);
    },
  );

  await t.test(
    "POST /api/v1/recipes/xray returns token heatmap, layer waterfall, and ξ* worst-case corner",
    async () => {
      const res = await request(app)
        .post("/api/v1/recipes/xray")
        .send({
          source:
            "model ThermalLink parameter Real G_th = 2.5; Real T_a; Real T_b; Real Q_flow; equation Q_flow = G_th * (T_a - T_b); end ThermalLink;",
          dialect: "modelica",
          uri: "models/ThermalLink.mo",
          computeDialM: 4,
        })
        .expect(200);

      assert.equal(res.body.dialect, "modelica");
      assert.ok(typeof res.body.exampleId === "string" && res.body.exampleId.length > 0);
      assert.ok(res.body.mInit >= 1);
      assert.ok(typeof res.body.meanWorstCaseLoss === "number" && Number.isFinite(res.body.meanWorstCaseLoss));
      assert.ok(Array.isArray(res.body.tokenHeat) && res.body.tokenHeat.length > 5);
      assert.ok(Array.isArray(res.body.layerWaterfall) && res.body.layerWaterfall.length > 0);
      assert.ok(Array.isArray(res.body.worstCaseCorner) && res.body.worstCaseCorner.length > 0);
      for (const c of res.body.worstCaseCorner as { xiSign: number }[]) {
        assert.ok(c.xiSign === 1 || c.xiSign === -1);
      }
      assert.equal(typeof res.body.rewardHackingAudit.isRewardHacking, "boolean");

      // Empty source returns 400
      await request(app).post("/api/v1/recipes/xray").send({ source: "   " }).expect(400);
    },
  );

  await t.test(
    "POST/GET /api/v1/recipes/patches persists and filters immutable overlay patches with auth",
    async () => {
      // Unauthenticated POST must fail with 401
      await request(app)
        .post("/api/v1/recipes/patches")
        .send({
          recipeName: "@ms/thermal-recipe",
          exampleId: "rhg_unauth",
          action: "quarantine",
        })
        .expect(401);

      // Invalid action returns 400
      await request(app)
        .post("/api/v1/recipes/patches")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/thermal-recipe",
          exampleId: "rhg_bad",
          action: "delete_all",
        })
        .expect(400);

      // 1. Quarantine patch
      const p1 = await request(app)
        .post("/api/v1/recipes/patches")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/thermal-recipe",
          exampleId: "models/HeatCapacitor.mo",
          action: "quarantine",
          reason: "Contaminated with eval benchmark",
        })
        .expect(201);

      assert.equal(p1.body.success, true);
      assert.equal(p1.body.patch.action, "quarantine");
      assert.equal(p1.body.patch.createdBy, user.id);

      // 2. Patch source
      const p2 = await request(app)
        .post("/api/v1/recipes/patches")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/thermal-recipe",
          exampleId: "rhg_patch_src",
          action: "patch_source",
          reason: "Fix sign convention in thermal conduction",
          patchedSource: "model FixedHeat Real q; Real dT; equation q = 2.0 * dT; end FixedHeat;",
        })
        .expect(201);

      assert.equal(p2.body.patch.action, "patch_source");
      assert.match(p2.body.patch.patchedSource, /FixedHeat/);

      // 3. Hypergraph override
      const p3 = await request(app)
        .post("/api/v1/recipes/patches")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/cad-recipe",
          exampleId: "rhg_override_1",
          action: "hypergraph_override",
          reason: "Pin tolerance generator group",
          hypergraphOverrides: [{ tokenIndex: 0, groupId: 1, relTypeId: 3, relSign: 1 }],
        })
        .expect(201);

      assert.equal(p3.body.patch.action, "hypergraph_override");
      assert.equal(p3.body.patch.hypergraphOverrides.length, 1);

      // List all patches
      const allRes = await request(app).get("/api/v1/recipes/patches").expect(200);
      assert.equal(allRes.body.total, 3);

      // Filter by recipeName
      const byRecipe = await request(app)
        .get("/api/v1/recipes/patches")
        .query({ recipeName: "@ms/thermal-recipe" })
        .expect(200);
      assert.equal(byRecipe.body.total, 2);

      // Filter by exampleId
      const byExample = await request(app)
        .get("/api/v1/recipes/patches")
        .query({ exampleId: "rhg_override_1" })
        .expect(200);
      assert.equal(byExample.body.total, 1);
      assert.equal(byExample.body.patches[0].recipeName, "@ms/cad-recipe");
    },
  );

  await t.test(
    "GET /api/v1/recipes/lineage/:exampleId computes Blast Radius across patches, compiled shards, and DiskANN chunks",
    async () => {
      // Compile a dataset shard for @ms/thermal-recipe containing models/HeatCapacitor.mo
      const compileRes = await request(app)
        .post("/api/v1/memory/datasets/compile")
        .set("Authorization", authHeader)
        .send({
          recipeName: "@ms/thermal-recipe",
          recipeVersion: "1.0.0",
          datasetKind: "training-recipe",
          examplesPerShard: 4,
          mCap: 32,
          files: [
            {
              uri: "models/HeatCapacitor.mo",
              dialect: "modelica",
              source: "model HeatCapacitor parameter Real C = 10; Real T; equation T = C * 2.0; end HeatCapacitor;",
            },
          ],
        })
        .expect(201);

      assert.equal(compileRes.body.shards.length, 1);
      const compiledShardId = compileRes.body.shards[0].shardId as string;

      // Query Blast Radius using URI substring "HeatCapacitor.mo"
      const lineageRes = await request(app)
        .get(`/api/v1/recipes/lineage/${encodeURIComponent("HeatCapacitor.mo")}`)
        .expect(200);

      assert.equal(lineageRes.body.exampleId, "HeatCapacitor.mo");
      assert.equal(lineageRes.body.blastRadius.quarantined, true);
      assert.ok(lineageRes.body.blastRadius.overlayPatchCount >= 1);
      assert.ok(lineageRes.body.blastRadius.impactedShardCount >= 1);
      assert.ok(lineageRes.body.blastRadius.impactedMemoryChunkCount >= 1);
      assert.ok(lineageRes.body.blastRadius.affectedRecipes.includes("@ms/thermal-recipe"));
      assert.ok(
        lineageRes.body.compiledShards.some((s: { shardId: string }) => s.shardId === compiledShardId),
        "Expected compiled shard containing HeatCapacitor.mo in blast radius",
      );
      assert.ok(
        lineageRes.body.memoryChunks.some((c: { sourceUri: string }) => c.sourceUri.includes("HeatCapacitor.mo")),
        "Expected DiskANN memory chunk for HeatCapacitor.mo in blast radius",
      );

      // RBAC check on lineage memory chunks for org-private chunk
      const publicSecretLineage = await request(app)
        .get(`/api/v1/recipes/lineage/${encodeURIComponent("OrgSecretBlade.mo")}`)
        .expect(200);
      assert.equal(publicSecretLineage.body.blastRadius.impactedMemoryChunkCount, 0);

      const org42SecretLineage = await request(app)
        .get(`/api/v1/recipes/lineage/${encodeURIComponent("OrgSecretBlade.mo")}`)
        .set("x-modelscript-org-id", "42")
        .expect(200);
      assert.equal(org42SecretLineage.body.blastRadius.impactedMemoryChunkCount, 1);
    },
  );

  await t.test(
    "POST /api/v1/recipes/check-constraints evaluates feasible CAD constraints, tightened bounds, contradictions, and stressScale",
    async () => {
      // (a) Feasible multi-parameter CAD constraint set
      const feasibleRes = await request(app)
        .post("/api/v1/recipes/check-constraints")
        .send({
          params: [
            { name: "wall_thickness", nominal: 2.5, halfWidth: 0.5 },
            { name: "bore", nominal: 10.0, halfWidth: 1.0 },
          ],
          constraints: [
            {
              id: "c_outer_diam",
              expression: "2 * wall_thickness + bore <= 16.0",
              coeffs: { wall_thickness: 2, bore: 1 },
              sense: "<=",
              rhs: 16.0,
            },
          ],
        })
        .expect(200);

      assert.equal(feasibleRes.body.feasible, true);
      assert.equal(feasibleRes.body.engine, "constrained-zonotope");
      assert.deepEqual(feasibleRes.body.conflictingConstraintIds, []);
      assert.equal(feasibleRes.body.paramCount, 2);
      assert.equal(feasibleRes.body.constraintCount, 1);
      assert.equal(typeof feasibleRes.body.elapsedMs, "number");
      assert.ok(feasibleRes.body.elapsedMs >= 0);
      assert.deepEqual(feasibleRes.body.nominalBounds["wall_thickness"], [2.0, 3.0]);
      assert.deepEqual(feasibleRes.body.nominalBounds["bore"], [9.0, 11.0]);
      assert.ok(feasibleRes.body.tightenedBounds["wall_thickness"][0] >= 2.0 - 1e-6);
      assert.ok(feasibleRes.body.tightenedBounds["wall_thickness"][1] <= 3.0 + 1e-6);
      assert.ok(feasibleRes.body.tightenedBounds["bore"][0] >= 9.0 - 1e-6);
      assert.ok(feasibleRes.body.tightenedBounds["bore"][1] <= 11.0 + 1e-6);
      assert.ok(feasibleRes.body.volumeRetention > 0 && feasibleRes.body.volumeRetention <= 1);

      // Stricter feasible cut that visibly tightens upper bounds of both parameters:
      // wall_thickness in [2, 3], bore in [9, 11], 2*w + b <= 14.5 => w <= 2.75, b <= 10.5
      const tightenedRes = await request(app)
        .post("/api/v1/recipes/check-constraints")
        .send({
          params: [
            { name: "wall_thickness", nominal: 2.5, halfWidth: 0.5 },
            { name: "bore", nominal: 10.0, halfWidth: 1.0 },
          ],
          constraints: [
            {
              id: "c_tight_outer",
              expression: "2 * wall_thickness + bore <= 14.5",
              coeffs: { wall_thickness: 2, bore: 1 },
              sense: "<=",
              rhs: 14.5,
            },
          ],
        })
        .expect(200);

      assert.equal(tightenedRes.body.feasible, true);
      assert.equal(tightenedRes.body.engine, "constrained-zonotope");
      assert.deepEqual(tightenedRes.body.conflictingConstraintIds, []);
      assert.ok(
        Math.abs(tightenedRes.body.tightenedBounds["wall_thickness"][1] - 2.75) < 1e-4,
        `Expected wall_thickness upper bound tightened to 2.75, got ${tightenedRes.body.tightenedBounds["wall_thickness"][1]}`,
      );
      assert.ok(
        Math.abs(tightenedRes.body.tightenedBounds["bore"][1] - 10.5) < 1e-4,
        `Expected bore upper bound tightened to 10.5, got ${tightenedRes.body.tightenedBounds["bore"][1]}`,
      );
      assert.ok(
        Math.abs(tightenedRes.body.volumeRetention - 0.75) < 1e-4,
        `Expected geometric mean volumeRetention ~0.75, got ${tightenedRes.body.volumeRetention}`,
      );

      // (b) Infeasible / contradictory constraint set:
      // wall_thickness >= 2.8 AND 2*wall_thickness + bore <= 14.0 when bore >= 9.0 (2*2.8 + 9.0 = 14.6 > 14.0)
      const infeasibleRes = await request(app)
        .post("/api/v1/recipes/check-constraints")
        .send({
          params: [
            { name: "wall_thickness", nominal: 2.5, halfWidth: 0.5 },
            { name: "bore", nominal: 10.0, halfWidth: 1.0 },
          ],
          constraints: [
            {
              id: "c_min_wall",
              expression: "wall_thickness >= 2.8",
              coeffs: { wall_thickness: 1 },
              sense: ">=",
              rhs: 2.8,
            },
            {
              id: "c_max_envelope",
              expression: "2 * wall_thickness + bore <= 14.0",
              coeffs: { wall_thickness: 2, bore: 1 },
              sense: "<=",
              rhs: 14.0,
            },
            {
              id: "c_compatible_bore",
              expression: "bore <= 10.9",
              coeffs: { bore: 1 },
              sense: "<=",
              rhs: 10.9,
            },
          ],
        })
        .expect(200);

      assert.equal(infeasibleRes.body.feasible, false);
      assert.equal(infeasibleRes.body.engine, "constrained-zonotope");
      assert.ok(infeasibleRes.body.conflictingConstraintIds.length >= 1);
      assert.ok(infeasibleRes.body.conflictingConstraintIds.includes("c_min_wall"));
      assert.ok(infeasibleRes.body.conflictingConstraintIds.includes("c_max_envelope"));
      assert.equal(infeasibleRes.body.conflictingConstraintIds.includes("c_compatible_bore"), false);
      assert.equal(infeasibleRes.body.volumeRetention, 0);

      // (c) stressScale scaling: same constraints feasible at stressScale 2.0 vs infeasible at stressScale 0.2
      const stressConstraints = [
        {
          id: "c_min_wall",
          expression: "wall_thickness >= 2.8",
          coeffs: { wall_thickness: 1 },
          sense: ">=" as const,
          rhs: 2.8,
        },
        {
          id: "c_max_envelope",
          expression: "2 * wall_thickness + bore <= 14.0",
          coeffs: { wall_thickness: 2, bore: 1 },
          sense: "<=" as const,
          rhs: 14.0,
        },
      ];
      const stressParams = [
        { name: "wall_thickness", nominal: 2.5, halfWidth: 0.5 },
        { name: "bore", nominal: 10.0, halfWidth: 1.0 },
      ];

      // At stressScale = 2.0: wall_thickness in [1.5, 3.5], bore in [8.0, 12.0] => (2.8, 8.0) gives 13.6 <= 14.0 (feasible)
      const wideStressRes = await request(app)
        .post("/api/v1/recipes/check-constraints")
        .send({ params: stressParams, constraints: stressConstraints, stressScale: 2.0 })
        .expect(200);

      assert.equal(wideStressRes.body.feasible, true);
      assert.deepEqual(wideStressRes.body.conflictingConstraintIds, []);
      assert.deepEqual(wideStressRes.body.nominalBounds["wall_thickness"], [1.5, 3.5]);
      assert.deepEqual(wideStressRes.body.nominalBounds["bore"], [8.0, 12.0]);
      assert.ok(Math.abs(wideStressRes.body.tightenedBounds["wall_thickness"][0] - 2.8) < 1e-4);
      assert.ok(Math.abs(wideStressRes.body.tightenedBounds["wall_thickness"][1] - 3.0) < 1e-4);
      assert.ok(Math.abs(wideStressRes.body.tightenedBounds["bore"][1] - 8.4) < 1e-4);

      // At stressScale = 0.2: wall_thickness in [2.4, 2.6], bore in [9.8, 10.2] => infeasible
      const tightStressRes = await request(app)
        .post("/api/v1/recipes/check-constraints")
        .send({ params: stressParams, constraints: stressConstraints, stressScale: 0.2 })
        .expect(200);

      assert.equal(tightStressRes.body.feasible, false);
      assert.ok(tightStressRes.body.conflictingConstraintIds.length >= 1);

      // Degenerate zero-halfWidth parameter + equality constraint + stressScale clamping
      const degenerateRes = await request(app)
        .post("/api/v1/recipes/check-constraints")
        .send({
          params: [
            { name: "fixed_pitch", nominal: 4.0, halfWidth: 0 },
            { name: "clearance", nominal: 1.0, halfWidth: 0.5 },
          ],
          constraints: [
            {
              id: "c_eq",
              coeffs: { fixed_pitch: 1, clearance: 2 },
              sense: "==",
              rhs: 6.0,
            },
          ],
          stressScale: 10, // clamped to 5
        })
        .expect(200);

      assert.equal(degenerateRes.body.feasible, true);
      assert.deepEqual(degenerateRes.body.nominalBounds["fixed_pitch"], [4.0, 4.0]);
      assert.deepEqual(degenerateRes.body.nominalBounds["clearance"], [-1.5, 3.5]);
      assert.ok(Math.abs(degenerateRes.body.tightenedBounds["clearance"][0] - 1.0) < 1e-4);
      assert.ok(Math.abs(degenerateRes.body.tightenedBounds["clearance"][1] - 1.0) < 1e-4);

      // Validation errors return 400
      await request(app).post("/api/v1/recipes/check-constraints").send({ params: [], constraints: [] }).expect(400);
      await request(app)
        .post("/api/v1/recipes/check-constraints")
        .send({ params: stressParams, constraints: "invalid" })
        .expect(400);
    },
  );

  await t.test("POST /api/v1/recipes/patches accepts optional constraints on hypergraph_override patches", async () => {
    const constraintPatchRes = await request(app)
      .post("/api/v1/recipes/patches")
      .set("Authorization", authHeader)
      .send({
        recipeName: "@ms/cad-recipe",
        exampleId: "rhg_constraint_override_1",
        action: "hypergraph_override",
        reason: "Attach CAD clearance constraint from Zonotope Workbench",
        constraints: [
          {
            id: "c_outer_diam",
            expression: "2 * wall_thickness + bore <= 16.0",
            coeffs: { wall_thickness: 2, bore: 1 },
            sense: "<=",
            rhs: 16.0,
          },
        ],
      })
      .expect(201);

    assert.equal(constraintPatchRes.body.success, true);
    assert.equal(constraintPatchRes.body.patch.action, "hypergraph_override");
    assert.equal(constraintPatchRes.body.patch.constraints.length, 1);
    assert.equal(constraintPatchRes.body.patch.constraints[0].id, "c_outer_diam");
  });
});
