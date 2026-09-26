// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import request from "supertest";
process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";

test("Automated Parametric DoE Sweep Orchestrator (@modelscript/api)", async (t) => {
  const app = createApp();

  const parametricInpTemplate = `*HEADING
Parametric Drone Arm Study
*NODE
1, 0, 0, 0
2, 1, 0, 0
3, 0, 1, 0
4, 0, 0, 1
*ELEMENT, TYPE=C3D4
1, 1, 2, 3, 4
*MATERIAL, NAME=CARBON
*ELASTIC
 {{ DroneArm.youngsModulus }}, 0.33
*STEP
*STATIC
*CLOAD
 2, 2, {{ DroneArm.thrustForce }}
*END STEP
`;

  let sweepId = "";

  await t.test("POST /api/v1/cae/sweeps: submits batch DoE study and fans out runs", async () => {
    const res = await request(app)
      .post("/api/v1/cae/sweeps")
      .send({
        title: "Drone Arm Load Sweep",
        solver: "calculix",
        templateDeck: parametricInpTemplate,
        deckFormat: "inp",
        sampling: {
          strategy: "lhs",
          sampleCount: 4,
          concurrency: 2,
          parameters: [
            { name: "DroneArm.thrustForce", min: 100.0, max: 500.0, nominal: 250.0 },
            { name: "DroneArm.youngsModulus", min: 50e9, max: 90e9, nominal: 70e9 },
          ],
        },
        options: {
          cores: 1,
          runner: "fallback",
        },
      })
      .expect(200);

    assert.ok(res.body.sweepId, "Must return unique sweepId");
    assert.strictEqual(res.body.totalRuns, 4);
    assert.strictEqual(res.body.strategy, "lhs");
    assert.strictEqual(res.body.concurrency, 2);

    sweepId = res.body.sweepId;
  });

  await t.test("GET /api/v1/cae/sweeps/:id: polls sweep until all parallel runs complete", async () => {
    let completed = false;
    let finalState: any = null;

    for (let i = 0; i < 30; i++) {
      const res = await request(app).get(`/api/v1/cae/sweeps/${sweepId}`).expect(200);
      finalState = res.body;

      if (finalState.status === "completed" || finalState.status === "partial_success") {
        completed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    assert.ok(completed, `Sweep ${sweepId} did not complete in time, status: ${finalState?.status}`);
    assert.strictEqual(finalState.totalRuns, 4);
    assert.strictEqual(finalState.completedRuns, 4);
    assert.strictEqual(finalState.failedRuns, 0);
    assert.strictEqual(finalState.progressPercent, 100);

    for (const run of finalState.runs) {
      assert.strictEqual(run.status, "completed");
      assert.ok(run.parameters["DroneArm.thrustForce"] >= 100);
      assert.ok(run.parameters["DroneArm.youngsModulus"] >= 50e9);
      assert.ok(run.scalars !== undefined, "Completed run must have scalars");
      assert.ok(run.scalars.converged, "Solver run must have converged");
      assert.ok(run.scalars.maxVonMisesStressPa > 0);
    }
  });

  await t.test("GET /api/v1/cae/sweeps: lists active and completed sweeps", async () => {
    const res = await request(app).get("/api/v1/cae/sweeps").expect(200);

    assert.ok(Array.isArray(res.body));
    const found = res.body.find((s: any) => s.sweepId === sweepId);
    assert.ok(found, `Sweep ${sweepId} must be present in sweeps list`);
    assert.strictEqual(found.status, "completed");
  });

  await t.test("GET /api/v1/cae/sweeps/:id/dataset: extracts high-dimensional SnapshotMatrixDataset", async () => {
    const res = await request(app).get(`/api/v1/cae/sweeps/${sweepId}/dataset?targetField=vonMisesStress`).expect(200);

    assert.strictEqual(res.body.M, 4, "Must contain 4 simulation snapshots");
    assert.strictEqual(res.body.p, 2, "Must have 2 parameters");
    assert.ok(res.body.N >= 4, "Must have at least 4 nodes");
    assert.ok(Array.isArray(res.body.snapshotMatrix));
    assert.strictEqual(res.body.snapshotMatrix.length, res.body.N * res.body.M);
  });

  await t.test("POST /api/v1/cae/sweeps/:id/train-surrogate: trains POD-Galerkin ROM and emits Modelica", async () => {
    const res = await request(app)
      .post(`/api/v1/cae/sweeps/${sweepId}/train-surrogate`)
      .send({
        targetField: "vonMisesStress",
        energyThreshold: 0.999,
        maxModes: 4,
        polynomialDegree: 2,
        modelName: "DroneArmSurrogate",
        packageName: "ModelScript.Drones",
      })
      .expect(200);

    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.metrics.capturedEnergy >= 0.99, "Must capture >= 99% energy");
    assert.ok(res.body.metrics.numModes >= 1);
    assert.ok(res.body.modelicaCode.includes("model DroneArmSurrogate"));
    assert.ok(res.body.modelicaCode.includes("within ModelScript.Drones;"));
    assert.ok(res.body.modelicaCode.includes("parameter Real DroneArm_thrustForce"));
  });

  await t.test("DELETE /api/v1/cae/sweeps/:id: cancels running sweep", async () => {
    const submitRes = await request(app)
      .post("/api/v1/cae/sweeps")
      .send({
        title: "To Be Cancelled Sweep",
        solver: "calculix",
        templateDeck: parametricInpTemplate,
        sampling: {
          strategy: "lhs",
          sampleCount: 10,
          concurrency: 2,
          parameters: [{ name: "DroneArm.thrustForce", min: 100, max: 200 }],
        },
      })
      .expect(200);

    const cancelSweepId = submitRes.body.sweepId;
    const cancelRes = await request(app).delete(`/api/v1/cae/sweeps/${cancelSweepId}`).expect(200);

    assert.strictEqual(cancelRes.body.cancelled, true);

    const checkRes = await request(app).get(`/api/v1/cae/sweeps/${cancelSweepId}`).expect(200);
    assert.strictEqual(checkRes.body.status, "cancelled");
  });
});
