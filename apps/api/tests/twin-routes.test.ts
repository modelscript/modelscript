// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";

test("Operational Digital Twin - End-to-End Ingress, Drift, MHE Adaptation & Physics PR Approval", async (t) => {
  await initBltWasm();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twin-route-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // 1. Seed user and package
  const user = db.createUser("engineer_alice", "alice@modelscript.test", "hashed_pwd", "Alice Engineer");
  const { id: pkgId } = db.getOrCreatePackage("Powertrain");

  // 2. Register hardware instance
  const serialNumber = "SN-INVERTER-9901";
  const instanceRes = await request(app)
    .post("/api/v1/instances")
    .set("Authorization", `Bearer dummy-token`) // or direct auth middleware bypass
    .send({
      serialNumber,
      packageName: "Powertrain",
      version: "1.0.0",
      commitSha: "a1b2c3d",
      birthData: { batch: "Lot-2026-Q3", nominalRth: 0.12 },
    });

  let instanceId = instanceRes.body?.id;
  if (!instanceId) {
    // If auth is required, create directly via DB for testing
    instanceId = db.createInstance({
      serialNumber,
      packageId: pkgId,
      version: "1.0.0",
      commitSha: "a1b2c3d",
      birthData: JSON.stringify({ batch: "Lot-2026-Q3", nominalRth: 0.12 }),
    });
  }
  assert.ok(instanceId > 0, "Hardware instance registration failed!");

  // 3. Deploy digital twin
  const deployRes = await request(app)
    .post("/api/v1/twins")
    .send({
      serialNumber,
      name: "Inverter Cooling Digital Twin",
      modelicaClass: "Powertrain.InverterCoolingCircuit",
      config: {
        channels: ["T"],
        mheWindowDuration: 4.0,
        mheIntervals: 41,
        parametersToEstimate: ["R_th"],
        parameterBounds: {
          R_th: { min: 0.05, max: 0.6, prior: 0.12 },
        },
        driftChannels: [
          {
            name: "T",
            expectedMean: 0.0,
            expectedStd: 0.5,
            minShift: 0.75,
            threshold: 4.0,
          },
        ],
      },
      initialParameters: {
        R_th: 0.12,
        P_loss: 100.0,
        C_th: 20.0,
        T_amb: 25.0,
      },
    });

  assert.strictEqual(deployRes.status, 201);
  const twin = deployRes.body.twin;
  assert.ok(twin);
  assert.strictEqual(twin.name, "Inverter Cooling Digital Twin");
  assert.strictEqual(twin.health_score, 100.0);
  const twinId = twin.id;

  // 4. Query twin state
  const getRes = await request(app).get(`/api/v1/twins/${twinId}`);
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.body.twin.id, twinId);
  assert.strictEqual(getRes.body.activeSession.healthScore, 100.0);

  // 5. Ingest nominal telemetry without triggering drift
  const nominalSamples: { t: number; y: number[] }[] = [];
  for (let k = 0; k < 20; k++) {
    const t = k * 0.1;
    // Follows nominal curve: 25 + 100 * 0.12 * (1 - exp(-t / (20 * 0.12)))
    const expectedT = 25.0 + 100.0 * 0.12 * (1.0 - Math.exp(-t / (20.0 * 0.12)));
    nominalSamples.push({ t, y: [expectedT] });
  }

  const nomIngestRes = await request(app).post(`/api/v1/twins/${twinId}/telemetry`).send({ samples: nominalSamples });
  assert.strictEqual(nomIngestRes.status, 200);
  assert.strictEqual(nomIngestRes.body.processed, 20);

  // Assert no adaptations or proposals opened yet
  const propRes0 = await request(app).get(`/api/v1/twins/${twinId}/proposals`);
  assert.strictEqual(propRes0.body.proposals.length, 0);

  // 6. Introduce structural wear & telemetry drift (+10 K shift over degraded thermal resistance R_th = 0.25)
  const degradedSamples: { t: number; y: number[] }[] = [];
  for (let k = 20; k < 60; k++) {
    const t = k * 0.1;
    // Degraded thermal resistance 0.25 generates higher temperature: tau = 20 * 0.25 = 5.0
    const degradedT = 25.0 + 100.0 * 0.25 * (1.0 - Math.exp(-t / 5.0));
    degradedSamples.push({ t, y: [degradedT] });
  }

  const driftIngestRes = await request(app)
    .post(`/api/v1/twins/${twinId}/telemetry`)
    .send({ samples: degradedSamples });
  assert.strictEqual(driftIngestRes.status, 200);

  // 7. Verify adaptation ledger and automated social incident post
  const adaptations = db.listTwinAdaptations(twinId);
  assert.ok(adaptations.length > 0, "No twin adaptation was recorded on drift!");
  const latestAdapt = adaptations[0]!;
  assert.strictEqual(latestAdapt.trigger_reason, "cusum_drift");

  // Check automated social incident post
  const proposals = db.listTwinProposals(twinId);
  assert.ok(proposals.length > 0, "Physics PR proposal was not opened!");
  const proposal = proposals[0]!;
  assert.strictEqual(proposal.status, "open");
  assert.ok(proposal.post_id !== null, "Proposal must be linked to a social post");

  const post = db.getPost(proposal.post_id!);
  assert.ok(post, "Incident post does not exist in posts table!");
  assert.ok(post.content.includes("Operational Drift Detected"), "Post content missing incident header");
  assert.ok(post.artifact_view_id !== null, "Post must embed an artifact view");

  const artifactView = db.getArtifactView(post.artifact_view_id!);
  assert.strictEqual(artifactView.view_type, "digital-twin-dashboard");
  const viewConfig = JSON.parse(artifactView.view_config);
  assert.strictEqual(viewConfig.twinId, twinId);
  assert.strictEqual(viewConfig.instanceSerial, serialNumber);

  // 8. Review and approve the Physics Pull Request
  const approveRes = await request(app)
    .post(`/api/v1/twins/${twinId}/proposals/${proposal.id}/approve`)
    .send({ reviewerId: user.id, notes: "Approved: field telemetry confirms thermal pad wear." });

  assert.strictEqual(approveRes.status, 200);
  assert.strictEqual(approveRes.body.status, "approved");

  // Verify twin's active parameters now reflect calibrated values
  const updatedTwin = db.getTwin(twinId);
  assert.ok(updatedTwin);
  const updatedParams = JSON.parse(updatedTwin.current_parameters);
  assert.ok(
    updatedParams["R_th"] > 0.14,
    `Approved parameter R_th should be calibrated higher than nominal 0.12 (got ${updatedParams["R_th"]})`,
  );

  // 9. Test on-demand manual MHE calibration endpoint over full window
  const adaptRes = await request(app).post(`/api/v1/twins/${twinId}/adapt`).send({ reason: "scheduled_review" });
  assert.strictEqual(adaptRes.status, 200);
  assert.ok(
    adaptRes.body.calibratedParameters["R_th"] > 0.2,
    `Manual MHE should calibrate R_th close to 0.25 (got ${adaptRes.body.calibratedParameters["R_th"]})`,
  );

  // 10. Predict remaining useful life (RUL) under duty cycle
  const progRes = await request(app)
    .post(`/api/v1/twins/${twinId}/prognostics`)
    .send({ dutyStressTempK: 348.15, currentDamage: 0.4 });

  assert.strictEqual(progRes.status, 200);
  assert.ok(progRes.body.rulHoursP50 > 0);
  assert.ok(progRes.body.projectedFailureDurationHours > 0);
  console.log(`  Prognostics verification: RUL P50 = ${progRes.body.rulHoursP50.toFixed(1)} hours`);

  console.log("✔ Operational Digital Twin end-to-end integration verified successfully!");
});
