// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { RelTypeId } from "@modelscript/runtime";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("Social RLHF Arena: Pairwise CAD Arena, Fix-It Formal Gates, Honeypot Reputation & Dataset Export", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rlhf-arena-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  const user = db.createUser("cad_reviewer", "cad@modelscript.test", "hash_pw", "CAD Reviewer");
  assert.ok(user);
  const authHeader = `Bearer ${jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`;

  let pairwiseId = 0;
  let candAId = 0;
  let fixItId = 0;
  let tolId = 0;

  await t.test("creates a pairwise_arena OpenSCAD challenge with automatic formal certs & mInit", async () => {
    const res = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", authHeader)
      .send({
        challengeType: "pairwise_arena",
        dialect: "scad",
        title: "Mounting bracket with parametric wall thickness & symmetric bolt holes",
        prompt: "Create a 40x20mm bracket with symmetric M4 holes and parametric wall_thickness.",
        deltaTTrigger: 0.48,
        candidates: [
          {
            label: "A",
            code: `wall_thickness = 3.0;\nhole_radius = 2.1;\ndifference() {\n  cube([40, 20, wall_thickness]);\n  translate([-hole_radius, 0, 0]) cylinder(r = hole_radius, h = 5);\n}`,
          },
          {
            label: "B",
            code: `wall_thickness = -2.0;\ncube([40, 20, wall_thickness]);`,
          },
        ],
      })
      .expect(201);

    pairwiseId = res.body.id;
    assert.ok(pairwiseId > 0);
    assert.equal(res.body.candidates.length, 2);

    const candA = res.body.candidates[0];
    const candB = res.body.candidates[1];
    candAId = candA.id;

    assert.equal(candA.formalCert.gate1GlrSyntax, true);
    assert.equal(candA.formalCert.cadClearance, true);
    assert.ok(candA.mInit >= 2, `Expected candA mInit >= 2, got ${candA.mInit}`);

    // Candidate B has negative wall_thickness -> Gate 3 SMT/CAD must flag it!
    assert.equal(candB.formalCert.gate3SmtFeasibility, false);
    assert.equal(candB.formalCert.cadClearance, false);
  });

  await t.test("records pairwise preference and aggregates weighted votes on GET /challenges/:id", async () => {
    await request(app)
      .post(`/api/v1/rlhf/challenges/${pairwiseId}/annotate`)
      .set("Authorization", authHeader)
      .send({
        preferredCandidateId: candAId,
        preferenceOutcome: "candidate",
        rationaleTags: ["better-manufacturability", "valid-wall-thickness"],
        notes: "Candidate A preserves positive wall thickness and symmetric hole radius.",
      })
      .expect(200);

    const detail = await request(app)
      .get(`/api/v1/rlhf/challenges/${pairwiseId}`)
      .set("Authorization", authHeader)
      .expect(200);

    assert.equal(detail.body.challenge.stats.totalAnnotations, 1);
    const candA = detail.body.challenge.candidates.find((c: { id: number }) => c.id === candAId);
    assert.equal(candA.weightedVotes, 1);
    assert.ok(candA.hypergraph.spans.length > 0);
    assert.equal(detail.body.challenge.myAnnotation.preferredCandidateId, candAId);
  });

  await t.test("grades hidden honeypot challenge and updates annotator trust_score", async () => {
    const createRes = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", authHeader)
      .send({
        challengeType: "pairwise_arena",
        dialect: "scad",
        title: "Honeypot: Cylinder height sanity",
        prompt: "Create a positive-height cylinder.",
        isHoneypot: true,
        goldAnswer: { preferredLabel: "A" },
        candidates: [
          { label: "A", code: "cylinder(r = 5, h = 10);" },
          { label: "B", code: "radius = -5; cylinder(r = radius, h = 10);" },
        ],
      })
      .expect(201);

    const goldCandId = createRes.body.candidates[0].id;
    const voteRes = await request(app)
      .post(`/api/v1/rlhf/challenges/${createRes.body.id}/annotate`)
      .set("Authorization", authHeader)
      .send({ preferredCandidateId: goldCandId, preferenceOutcome: "candidate" })
      .expect(200);

    assert.ok(voteRes.body.appliedWeight > 1.0, `Expected trust score increase, got ${voteRes.body.appliedWeight}`);

    const repRes = await request(app).get("/api/v1/rlhf/reputation/me").set("Authorization", authHeader).expect(200);
    const scadRep = repRes.body.reputation.find((r: { domain: string }) => r.domain === "scad");
    assert.equal(scadRep.honeypot_hits, 1);
  });

  await t.test("rejects broken Fix-It bounty patches (422) and accepts formally valid Modelica fixes", async () => {
    const createRes = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", authHeader)
      .send({
        challengeType: "fix_it_bounty",
        dialect: "modelica",
        title: "Fix mismatched Modelica end identifier and missing equation",
        prompt: "Repair the RC thermal model so all 4 formal gates pass.",
        sourceCode: "model ThermalRC\n  Real T;\nend WrongName;",
      })
      .expect(201);
    fixItId = createRes.body.id;

    // Broken patch must be rejected with 422
    const badRes = await request(app)
      .post(`/api/v1/rlhf/challenges/${fixItId}/annotate`)
      .set("Authorization", authHeader)
      .send({
        fixedCode: "model ThermalRC\n  Real T;\nend StillWrong;",
      })
      .expect(422);
    assert.equal(badRes.body.formalCert.gate1GlrSyntax, false);

    // Valid Modelica patch passes all 4 gates
    const goodRes = await request(app)
      .post(`/api/v1/rlhf/challenges/${fixItId}/annotate`)
      .set("Authorization", authHeader)
      .send({
        fixedCode:
          "model ThermalRC\n  parameter Real C = 1.0;\n  Real T;\nequation\n  C * der(T) = -T;\nend ThermalRC;",
      })
      .expect(200);
    assert.equal(goodRes.body.formalCert.gate1GlrSyntax, true);
    assert.equal(goodRes.body.formalCert.gate4DaeBalance, true);
  });

  await t.test("records crowd-sourced group_id & tolerance overrides and exports dataset-posttrain", async () => {
    const createRes = await request(app)
      .post("/api/v1/rlhf/challenges")
      .set("Authorization", authHeader)
      .send({
        challengeType: "tolerance_labeling",
        dialect: "scad",
        title: "Lock mounting pitch and couple symmetric boss radius",
        prompt: "Annotate invariant tolerance cones for this housing.",
        sourceCode: "pitch = 24.0;\nwall_thickness = 2.5;\ncube([pitch, pitch, wall_thickness]);",
      })
      .expect(201);
    tolId = createRes.body.id;

    const annRes = await request(app)
      .post(`/api/v1/rlhf/challenges/${tolId}/annotate`)
      .set("Authorization", authHeader)
      .send({
        hypergraphOverrides: [
          { symbolName: "pitch", groupId: 0 },
          {
            symbolName: "wall_thickness",
            relTypeId: RelTypeId.GDT_TOLERANCE_CONE,
            relSign: 1,
            toleranceSpec: { lower: -0.2, upper: 0.2, unit: "mm" },
          },
        ],
      })
      .expect(200);
    assert.equal(annRes.body.updatedMInit, 1);

    // Export dataset-posttrain JSON bundle (honeypots must be excluded!)
    const exportRes = await request(app).get("/api/v1/rlhf/export/dataset-posttrain").expect(200);

    assert.equal(exportRes.body.manifest.category, "dataset-posttrain");
    assert.equal(exportRes.body.manifest.memoryBackend, "diskann");
    assert.equal(exportRes.body.manifest.targetModelScale, "0.5B-1.5B");
    // Should contain 1 DPO preference + 1 SFT verified fix + 1 tolerance override (honeypot excluded)
    assert.equal(exportRes.body.records.length, 3);
    const dpo = exportRes.body.records.find((r: { kind: string }) => r.kind === "dpo_preference");
    assert.ok(dpo);
    assert.equal(dpo.chosen.tokenIds.length, dpo.chosen.groupIds.length);
    assert.equal(dpo.chosen.tokenIds.length, dpo.chosen.relTypeIds.length);
    assert.equal(dpo.chosen.tokenIds.length, dpo.chosen.relSigns.length);
  });
});
