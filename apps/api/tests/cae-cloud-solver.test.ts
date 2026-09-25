// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import request from "supertest";
process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { CaeResultProcessor } from "../src/services/cae-result-processor.js";
import { CaeTelemetryStreamer } from "../src/services/cae-telemetry-streamer.js";

test("Cloud Open-Source CAE Solver Backend Execution (@modelscript/api)", async (t) => {
  const app = createApp();

  await t.test("CaeTelemetryStreamer: parses CalculiX (ccx) stdout logs", () => {
    const streamer = new CaeTelemetryStreamer("calculix");
    const events: any[] = [];
    streamer.on("telemetry", (e) => events.push(e));

    const sampleLog = `
STEP 1
iteration 1 max. residual force = 1.452E-02
iteration 2 max. residual force = 3.210E-04
Convergence reached
`;
    streamer.processChunk(sampleLog);

    assert.ok(events.length >= 3, `Expected at least 3 events, got ${events.length}`);
    const phaseEvent = events.find((e) => e.type === "phase" && e.phase === "Step 1");
    assert.ok(phaseEvent, "Should emit Step 1 phase event");

    const iterEvents = events.filter((e) => e.type === "iteration");
    assert.strictEqual(iterEvents.length, 2, "Should capture 2 iterations");
    assert.strictEqual(iterEvents[0].iteration, 1);
    assert.strictEqual(iterEvents[0].residuals.force, 0.01452);
    assert.strictEqual(iterEvents[1].iteration, 2);
    assert.strictEqual(iterEvents[1].residuals.force, 0.000321);
  });

  await t.test("CaeTelemetryStreamer: parses SU2 tabular stdout logs", () => {
    const streamer = new CaeTelemetryStreamer("su2");
    const events: any[] = [];
    streamer.on("telemetry", (e) => events.push(e));

    const sampleLog = `
|   Iter|  Time(s)|  Res_Flow[0]|     CLift|     CDrag|
|      1|    0.010|    -2.000000|   0.12000|   0.05000|
|      2|    0.020|    -4.000000|   0.45000|   0.02100|
`;
    streamer.processChunk(sampleLog);

    const iterEvents = events.filter((e) => e.type === "iteration");
    assert.strictEqual(iterEvents.length, 2, "Should capture 2 SU2 iterations");
    assert.strictEqual(iterEvents[1].iteration, 2);
    assert.strictEqual(iterEvents[1].time, 0.02);
    assert.strictEqual(iterEvents[1].metrics.cL, 0.45);
    assert.strictEqual(iterEvents[1].metrics.cD, 0.021);
    assert.ok(Math.abs(iterEvents[1].residuals["res_flow[0]"] - 0.0001) < 1e-6);
  });

  await t.test("CaeResultProcessor: parses CalculiX .frd and converts to .vtu", () => {
    const sampleFrd = `    1C
 -1 1 0.0 0.0 0.0
 -1 2 1.0 0.0 0.0
 -1 3 0.0 1.0 0.0
 -1 4 0.0 0.0 1.0
    -3
    3C
 -1 1 1 1 1 2 3 4
    -3
 -4 DISP
 -1 1 0.0 0.0 0.0
 -1 2 0.001 0.0 -0.002
 -1 3 0.0 0.001 -0.002
 -1 4 0.0 0.0 -0.005
    -3
 -4 STRESS
 -1 1 1e7 0 0 0 0 0
 -1 2 2e7 0 0 0 0 0
 -1 3 1.5e7 0 0 0 0 0
 -1 4 5e7 0 0 0 0 0
    -3
`;
    const parsed = CaeResultProcessor.parseCalculixFrd(sampleFrd);
    assert.strictEqual(parsed.numNodes, 4);
    assert.strictEqual(parsed.numElements, 1);
    assert.ok(parsed.displacements !== undefined);
    assert.ok(parsed.vonMisesStress !== undefined);

    const vtuXml = CaeResultProcessor.convertFrdToVtu(parsed);
    assert.ok(vtuXml.includes('<VTKFile type="UnstructuredGrid"'));
    assert.ok(vtuXml.includes('NumberOfPoints="4"'));
    assert.ok(vtuXml.includes('NumberOfCells="1"'));
    assert.ok(vtuXml.includes('Name="Displacement"'));
    assert.ok(vtuXml.includes('Name="Stress_VonMises"'));

    const summary = CaeResultProcessor.extractScalarSummary(vtuXml, "CalculiX");
    assert.strictEqual(summary.solver, "CalculiX");
    assert.ok(summary.maxVonMisesStressPa! > 1e7);
    assert.ok(summary.maxDisplacementMeters! > 0.004);

    // Test direct extraction of FeaMeshPayload from FRD data
    const meshPayloadFromFrd = CaeResultProcessor.extractFeaMeshPayload(parsed);
    assert.strictEqual(meshPayloadFromFrd.type, "fea-mesh");
    assert.strictEqual(meshPayloadFromFrd.geometry.positions.length, 12); // 4 nodes * 3
    assert.ok(meshPayloadFromFrd.geometry.indices.length > 0);
    assert.strictEqual(meshPayloadFromFrd.fields.vonMisesStress.length, 4);
    assert.strictEqual(meshPayloadFromFrd.fields.displacements.length, 12);
    assert.ok(meshPayloadFromFrd.stats.maxStress > 1e7);
    assert.ok(meshPayloadFromFrd.stats.maxDisplacement > 0.004);

    // Test synthesis of FeaMeshPayload from VTU XML
    const meshPayloadFromVtu = CaeResultProcessor.parseVtuToMeshPayload(vtuXml);
    assert.strictEqual(meshPayloadFromVtu.type, "fea-mesh");
    assert.strictEqual(meshPayloadFromVtu.geometry.positions.length, 12);
    assert.strictEqual(meshPayloadFromVtu.fields.vonMisesStress.length, 4);
    assert.strictEqual(meshPayloadFromVtu.fields.displacements.length, 12);
    assert.ok(meshPayloadFromVtu.stats.maxStress > 1e7);
  });

  let uploadedHash = "";

  await t.test("POST /api/v1/cae/upload: stores mesh with CAS deduplication", async () => {
    const meshPayload = Buffer.from(`*NODE_${Date.now()}\n1, 0, 0, 0\n*ELEMENT, TYPE=C3D4\n1, 1, 2, 3, 4\n`);
    const res1 = await request(app).post("/api/v1/cae/upload").attach("file", meshPayload, "beam.inp").expect(200);

    assert.ok(res1.body.hash, "Must return SHA-256 hash");
    assert.strictEqual(res1.body.cached, false, "First upload is not cached");
    uploadedHash = res1.body.hash;

    // Second upload of identical content
    const res2 = await request(app).post("/api/v1/cae/upload").attach("file", meshPayload, "beam.inp").expect(200);

    assert.strictEqual(res2.body.hash, uploadedHash);
    assert.strictEqual(res2.body.cached, true, "Second upload must be recognized as cached");
  });

  let createdJobId = "";

  await t.test("POST /api/v1/cae/jobs: submits CalculiX job and polls completion", async () => {
    const sampleDeck = `*HEADING
Cantilever Beam Study
*NODE
1, 0, 0, 0
2, 1, 0, 0
3, 0, 1, 0
4, 0, 0, 1
*ELEMENT, TYPE=C3D4
1, 1, 2, 3, 4
*STEP
*STATIC
*END STEP
`;
    const submitRes = await request(app)
      .post("/api/v1/cae/jobs")
      .send({
        solver: "calculix",
        title: "Test Cantilever Beam",
        deck: {
          content: sampleDeck,
          format: "inp",
        },
        options: {
          cores: 2,
          runner: "fallback",
        },
      })
      .expect(200);

    assert.ok(submitRes.body.jobId, "Must return jobId");
    assert.strictEqual(submitRes.body.status, "queued");
    createdJobId = submitRes.body.jobId;

    // Poll until completed (timeout: 5s)
    let completed = false;
    for (let i = 0; i < 20; i++) {
      const pollRes = await request(app).get(`/api/v1/cae/jobs/${createdJobId}`).expect(200);
      if (pollRes.body.status === "success" || pollRes.body.status === "completed") {
        completed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.ok(completed, `Job ${createdJobId} must complete successfully`);

    // Verify VTU result is accessible
    const resultsRes = await request(app).get(`/api/v1/cae/jobs/${createdJobId}/results`).expect(200);

    assert.ok(resultsRes.text.includes("<VTKFile"));

    // Verify scalars JSON
    const scalarsRes = await request(app).get(`/api/v1/cae/jobs/${createdJobId}/scalars`).expect(200);

    assert.ok(scalarsRes.body.solver);
    assert.strictEqual(scalarsRes.body.converged, true);

    // Verify 3D mesh payload for webview streaming
    const meshPayloadRes = await request(app).get(`/api/v1/cae/jobs/${createdJobId}/mesh-payload`).expect(200);

    assert.strictEqual(meshPayloadRes.body.type, "fea-mesh");
    assert.ok(meshPayloadRes.body.geometry.positions.length > 0);
    assert.ok(meshPayloadRes.body.fields.vonMisesStress.length > 0);
    assert.ok(meshPayloadRes.body.fields.displacements.length > 0);
    assert.ok(meshPayloadRes.body.stats.maxStress > 0);
    assert.ok(meshPayloadRes.body.stats.maxDisplacement > 0);
  });

  await t.test("DELETE /api/v1/cae/jobs/:id: aborts running solver job", async () => {
    const cancelRes = await request(app).delete(`/api/v1/cae/jobs/${createdJobId}`).expect(200);

    assert.ok(typeof cancelRes.body.cancelled === "boolean");
  });
});
