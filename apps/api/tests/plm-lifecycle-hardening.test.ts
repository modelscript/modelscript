// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET, setAuthDatabase } from "../src/middleware/auth-middleware.js";
import { spacesRouter } from "../src/routes/spaces.js";
import { commitFilesToBareGitVault, readSpaceGitFileAtRef } from "../src/services/spaces/space-git-vault.js";

test("PLM Single-Repo Hardened Lifecycle: Git Branching, Tree Diffs, AST eBOM, Sim Gate, & AASX/DDP Packaging", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-plm-hardening-"));
  const gitDir = path.join(tmpDir, "git-repos");
  process.env["GIT_REPOS_DIR"] = gitDir;

  const db = new LibraryDatabase(tmpDir);
  setAuthDatabase(db);

  // Seed test users
  db.db
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, email, password_hash, display_name, account_type)
       VALUES (101, 'chief_engineer', 'chief@modelscript.org', 'hash', 'Chief Systems Engineer', 'admin'),
              (102, 'safety_officer', 'safety@modelscript.org', 'hash', 'Systems Safety Approver', 'user')`,
    )
    .run();

  const engineerToken = jwt.sign(
    {
      id: 101,
      username: "chief_engineer",
      email: "chief@modelscript.org",
      role: "admin",
      accountType: "admin",
    },
    JWT_SECRET,
  );

  const app = express();
  app.use(express.json());
  app.use("/api/v1/spaces", spacesRouter(db));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  let spaceId = "";
  let spaceSlug = "drone-powertrain";
  let ownerNamespace = "chief_engineer";
  let ecoId = "";
  let ecoNumber = 1;
  let sourceBranch = "eco/brushless-upgrade";
  let repoPath = "";

  await t.test("1. Create Space and verify initialized bare Git vault on disk", async () => {
    const res = await request(app)
      .post("/api/v1/spaces")
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        slug: spaceSlug,
        name: "Drone Powertrain & BMS",
        domainPreset: "robotics_multibody",
        visibility: "public",
      })
      .expect(201);

    spaceId = res.body.space.id;
    repoPath = res.body.space.git_repo_path;
    assert.ok(spaceId);
    assert.ok(repoPath && fs.existsSync(repoPath), "Bare Git vault must exist on disk");

    // Commit a realistic baseline Modelica physical model to main branch
    const baselineModelica = `// Baseline Drone Propulsion Model
package DronePowertrain
  model PropulsionSystem
    parameter Real V_bat = 22.2 "Nominal battery voltage (6S LiPo)";
    parameter Real maxCurrent = 35.0 "Current limiter";

    Actuator.MotorBMS motor(mass = 0.65, cost = 95.0) "Standard BLDC Motor"
      annotation(partNumber = "MOT-BLDC-STD");
    Sensors.CurrentSensor iSensor(mass = 0.02, cost = 12.0) "Hall Effect Sensor"
      annotation(partNumber = "SNS-CURR-01");
    Structural.MountBracket bracket(mass = 0.25, cost = 14.0) "Carbon Composite Mount"
      annotation(partNumber = "BRK-PROP-01");

    Real speed(start = 0.0) "Rotor speed (rad/s)";
    Real current(start = 0.0) "Motor current (A)";
  equation
    der(speed) = 120.0 * current - 0.45 * speed;
    der(current) = (V_bat - 0.08 * speed) / 0.002 - 15.0 * current;
  end PropulsionSystem;
end DronePowertrain;
`;

    commitFilesToBareGitVault({
      repoPath,
      branch: "main",
      message: "feat: establish verified Baseline v1.0 propulsion architecture",
      files: {
        "models/PropulsionSystem.mo": baselineModelica,
        "docs/requirements.md":
          "# Powertrain Requirements\n\n- REQ-DYN-012: Dynamic Overshoot Margin Under ISO Step Load (< 15%)\n- REQ-THM-045: Continuous Winding Temp (< 90°C)\n",
      },
    });

    const readMain = readSpaceGitFileAtRef({ repoPath, ref: "main", filePath: "models/PropulsionSystem.mo" });
    assert.ok(readMain?.includes("MOT-BLDC-STD"), "Baseline model must be readable from Git HEAD");
  });

  await t.test("2. Create ECO proposal: Materializes real branch in bare Git vault", async () => {
    const res = await request(app)
      .post(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/ecos`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        title: "High-Efficiency 24V BLDC Motor & CAN-FD Telemetry Upgrade",
        description:
          "Replaces standard motor with high-flow variant and introduces ASIL-D pressure sensor. Fixes thermal sag.",
        severity: "major",
        sourceBranch,
        targetBranch: "main",
        impactedModels: ["models/PropulsionSystem.mo"],
      })
      .expect(201);

    ecoId = res.body.eco.id;
    ecoNumber = res.body.eco.eco_number;
    assert.ok(ecoId);
    assert.equal(res.body.eco.status, "open");

    // Verify branch was materialized in bare vault
    const branchesRes = await request(app).get(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/branches`).expect(200);

    const branchNames = branchesRes.body.branches.map((b: { name: string }) => b.name);
    assert.ok(branchNames.includes(sourceBranch), `Expected branch '${sourceBranch}' in Git vault`);
  });

  await t.test("3. Commit design changes to the ECO branch", async () => {
    const upgradedModelica = `// Upgraded Drone Propulsion Model - ECO-1
package DronePowertrain
  model PropulsionSystem
    parameter Real V_bat = 24.0 "High-voltage 6S-HV Pack";
    parameter Real maxCurrent = 48.0 "Elevated Current Limit";

    Actuator.MotorBMS motor(mass = 0.82, cost = 148.0, kv = 920.0) "High-Flow 24V BLDC Motor"
      annotation(partNumber = "MOT-BLDC-STD");
    Sensors.CurrentSensor iSensor(mass = 0.02, cost = 12.0) "Hall Effect Sensor"
      annotation(partNumber = "SNS-CURR-01");
    Sensors.DynamicPressure pSensor(mass = 0.03, cost = 28.5) "ASIL-D Pitot Transducer"
      annotation(partNumber = "SNS-PRES-02-RED");
    Structural.MountBracket bracket(mass = 0.28, cost = 18.5) "Titanium Sintered Mount"
      annotation(partNumber = "BRK-PROP-01");

    Real speed(start = 0.0) "Rotor speed (rad/s)";
    Real current(start = 0.0) "Motor current (A)";
  equation
    der(speed) = 145.0 * current - 0.38 * speed;
    der(current) = (V_bat - 0.075 * speed) / 0.0018 - 18.0 * current;
  end PropulsionSystem;
end DronePowertrain;
`;

    const commitSha = commitFilesToBareGitVault({
      repoPath,
      branch: sourceBranch,
      message: "feat(powertrain): upgrade to high-flow 24V BLDC motor and pitot sensor",
      files: {
        "models/PropulsionSystem.mo": upgradedModelica,
      },
    });

    assert.ok(commitSha, "Commit to ECO branch must succeed");
    const readEco = readSpaceGitFileAtRef({ repoPath, ref: sourceBranch, filePath: "models/PropulsionSystem.mo" });
    assert.ok(readEco?.includes("SNS-PRES-02-RED"), "Updated model must be on ECO branch");
  });

  await t.test("4. Query real Git tree diff between main and ECO branch", async () => {
    const diffRes = await request(app)
      .get(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/ecos/${ecoId}/diff`)
      .expect(200);

    assert.ok(diffRes.body.diff);
    assert.equal(diffRes.body.diff.sourceBranch, sourceBranch);
    assert.equal(diffRes.body.diff.targetBranch, "main");
    assert.ok(diffRes.body.diff.files.length >= 1);

    const moDiff = diffRes.body.diff.files.find(
      (f: { filename: string }) => f.filename === "models/PropulsionSystem.mo",
    );
    assert.ok(moDiff, "Diff must include models/PropulsionSystem.mo");
    assert.equal(moDiff.status, "modified");
    assert.ok(moDiff.oldContent.includes("MOT-BLDC-STD"));
    assert.ok(moDiff.newContent.includes("SNS-PRES-02-RED"));
  });

  await t.test("5. Dynamic AST eBOM calculation reflects real component modifications and additions", async () => {
    const bomRes = await request(app)
      .get(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/ecos/${ecoId}/bom`)
      .expect(200);

    const bom = bomRes.body.bom;
    assert.ok(bom);
    assert.ok(Array.isArray(bom.parts));

    // Verify added sensor
    const addedSensor = bom.parts.find((p: { partNumber: string }) => p.partNumber === "SNS-PRES-02-RED");
    assert.ok(addedSensor, "Should identify SNS-PRES-02-RED as added part");
    assert.equal(addedSensor.changeStatus, "added");
    assert.equal(addedSensor.baselineQuantity, 0);
    assert.equal(addedSensor.targetQuantity, 1);

    // Verify modified motor
    const motorPart = bom.parts.find((p: { partNumber: string }) => p.partNumber === "MOT-BLDC-STD");
    assert.ok(motorPart, "Should identify MOT-BLDC-STD");
    assert.equal(motorPart.changeStatus, "modified");

    // Verify summary rollups
    assert.ok(typeof bom.summary.massDeltaKg === "number");
    assert.ok(typeof bom.summary.costDeltaUsd === "number");
    assert.ok(typeof bom.summary.carbonDeltaKgCo2 === "number");
    assert.ok(bom.summary.totalPartsDelta >= 1, "Total parts delta should be at least +1");
  });

  await t.test("6. Real Blast Radius: Identifies allocated requirements and risk score", async () => {
    const blastRes = await request(app)
      .get(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/ecos/${ecoId}/blast-radius`)
      .expect(200);

    const blast = blastRes.body.blastRadius;
    assert.ok(blast);
    assert.ok(blast.directModels.includes("models/PropulsionSystem.mo"));
    assert.ok(Array.isArray(blast.allocatedRequirements));

    // Scanned from docs/requirements.md
    const req12 = blast.allocatedRequirements.find((r: { reqId: string }) => r.reqId === "REQ-DYN-012");
    assert.ok(req12, "Should trace requirement REQ-DYN-012 from living docs");
    assert.equal(req12.status, "satisfied");
    assert.equal(blast.riskScore, "safety_critical", "ASIL-D requirements must yield safety_critical risk score");
  });

  await t.test("7. DAE Comparative Simulation Gate: Validates equation balance and transient trajectory", async () => {
    const simRes = await request(app)
      .get(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/ecos/${ecoId}/simulation`)
      .expect(200);

    const sim = simRes.body.simulation;
    assert.ok(sim);
    assert.equal(sim.gateStatus, "passed");
    assert.equal(sim.solver, "SUNDIALS CVODE (BDF stiff acausal)");
    assert.equal(sim.trajectories.length, 41);

    // Check verification rows
    const checks = sim.checks;
    assert.ok(
      checks.some((c: { name: string; status: string }) => c.name.includes("Pantelides") && c.status === "passed"),
    );
    assert.ok(
      checks.some((c: { name: string; status: string }) => c.name.includes("Overshoot") && c.status === "passed"),
    );
    assert.ok(
      checks.some((c: { name: string; status: string }) => c.name.includes("Settling Time") && c.status === "passed"),
    );
  });

  await t.test("8. Cryptographic Sign-Off (21 CFR Part 11 / ISO 26262)", async () => {
    const reviewRes = await request(app)
      .post(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/ecos/${ecoId}/review`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        decision: "approved",
        role: "Chief Systems Architect",
        intent: "I verify that this design modification complies with ISO 26262 ASIL-D dynamic safety requirements.",
        comment: "Simulation trajectory envelope confirmed with positive damping margin.",
      })
      .expect(200);

    assert.equal(reviewRes.body.eco.status, "approved");
    assert.ok(reviewRes.body.eco.approvals.length >= 1);
    assert.ok(reviewRes.body.eco.approvals[0].signature_hex, "Cryptographic signature must be stamped");
  });

  await t.test("9. Atomic Merge & Release: In-Memory 3-Way Git Merge, Git Tag, and AASX/DDP Generation", async () => {
    const mergeRes = await request(app)
      .post(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/ecos/${ecoId}/merge`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .expect(200);

    assert.equal(mergeRes.body.eco.status, "merged");
    assert.ok(mergeRes.body.releaseTag, "Release tag must be generated");
    assert.ok(mergeRes.body.commitSha, "Real Git merge commit SHA must be returned");

    // 1. Verify that 'main' in Git vault now contains the merged file
    const mergedMainCode = readSpaceGitFileAtRef({
      repoPath,
      ref: "main",
      filePath: "models/PropulsionSystem.mo",
    });
    assert.ok(mergedMainCode?.includes("SNS-PRES-02-RED"), "Target branch 'main' must reflect merged ECO changes");

    // 2. Verify physical AASX package file created on disk
    const aasx = mergeRes.body.aasxPackage;
    assert.ok(aasx && aasx.filename.endsWith(".aasx"));
    assert.ok(aasx.filePath && fs.existsSync(aasx.filePath), "Physical .aasx archive must exist on disk");

    // 3. Verify physical ProSTEP DDP container created on disk
    const ddp = mergeRes.body.ddpContainer;
    assert.ok(ddp && ddp.filename.endsWith(".zip"));
    assert.ok(ddp.filePath && fs.existsSync(ddp.filePath), "Physical .ddp zip container must exist on disk");
    assert.ok(ddp.manifestChecksum.length === 64, "SHA-256 manifest checksum must be present");

    // 4. Verify HTTP package download endpoints
    const aasxDownloadRes = await request(app)
      .get(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/packages/${aasx.filename}`)
      .expect(200);
    assert.ok(aasxDownloadRes.body);

    const ddpDownloadRes = await request(app)
      .get(`/api/v1/spaces/${ownerNamespace}/${spaceSlug}/packages/${ddp.filename}`)
      .expect(200);
    assert.ok(ddpDownloadRes.body);
  });

  server.close();
});
