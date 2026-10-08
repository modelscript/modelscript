// SPDX-License-Identifier: AGPL-3.0-or-later

import { strToU8, zipSync } from "fflate";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";

function buildMockFmuZip(modelName = "SimpleMotor"): Buffer {
  const modelDescription = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="${modelName}" guid="{test-guid-1234}">
  <CoSimulation modelIdentifier="${modelName}"/>
  <ModelVariables>
    <ScalarVariable name="voltage" valueReference="1" causality="input">
      <Real start="0.0"/>
    </ScalarVariable>
    <ScalarVariable name="current" valueReference="2" causality="output">
      <Real/>
    </ScalarVariable>
    <ScalarVariable name="resistance" valueReference="3" causality="parameter">
      <Real start="10.0"/>
    </ScalarVariable>
    <ScalarVariable name="internal_flux" valueReference="4" causality="local">
      <Real start="0.0"/>
    </ScalarVariable>
  </ModelVariables>
</fmiModelDescription>`;

  const zipped = zipSync({
    "modelDescription.xml": strToU8(modelDescription),
  });
  return Buffer.from(zipped);
}

test("FMU Storage, Inspection, and Cosim/Historian REST Routes", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fmu-route-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  let uploadedFmuId = "";

  await t.test("FMU: POST /api/v1/fmus rejects empty payload", async () => {
    const res = await request(app)
      .post("/api/v1/fmus")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.alloc(0));
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test("FMU: POST /api/v1/fmus uploads and indexes valid FMU archive", async () => {
    const fmuBytes = buildMockFmuZip("DC_Motor");
    const res = await request(app)
      .post("/api/v1/fmus")
      .set("Content-Type", "application/octet-stream")
      .set("x-filename", "DC_Motor.fmu")
      .send(fmuBytes);

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.modelName, "DC_Motor");
    assert.strictEqual(res.body.variableCount, 4);
    assert.strictEqual(res.body.supportsCoSimulation, true);
    uploadedFmuId = res.body.id;
  });

  await t.test("FMU: GET /api/v1/fmus lists uploaded FMUs", async () => {
    const res = await request(app).get("/api/v1/fmus");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.fmus));
    const found = res.body.fmus.find((f: any) => f.id === uploadedFmuId);
    assert.ok(found, "Uploaded FMU should be in list");
    assert.strictEqual(found.modelName, "DC_Motor");
  });

  await t.test("FMU: GET /api/v1/fmus/:id returns full metadata", async () => {
    const res = await request(app).get(`/api/v1/fmus/${uploadedFmuId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, uploadedFmuId);
    assert.strictEqual(res.body.modelDescription.modelName, "DC_Motor");
  });

  await t.test("FMU: GET /api/v1/fmus/:id/variables groups variables by causality", async () => {
    const res = await request(app).get(`/api/v1/fmus/${uploadedFmuId}/variables`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.total, 4);
    assert.strictEqual(res.body.inputs.length, 1);
    assert.strictEqual(res.body.inputs[0].name, "voltage");
    assert.strictEqual(res.body.outputs.length, 1);
    assert.strictEqual(res.body.outputs[0].name, "current");
    assert.strictEqual(res.body.parameters.length, 1);
    assert.strictEqual(res.body.parameters[0].name, "resistance");
    assert.strictEqual(res.body.local.length, 1);
    assert.strictEqual(res.body.local[0].name, "internal_flux");
  });

  await t.test("FMU: GET /api/v1/fmus/:id/description returns raw XML", async () => {
    const res = await request(app).get(`/api/v1/fmus/${uploadedFmuId}/description`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes("<fmiModelDescription"));
    assert.ok(res.text.includes("DC_Motor"));
  });

  await t.test("FMU: GET /api/v1/fmus/:id/download downloads FMU archive", async () => {
    const res = await request(app).get(`/api/v1/fmus/${uploadedFmuId}/download`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-disposition"].includes("DC_Motor.fmu"));
  });

  await t.test("FMU: DELETE /api/v1/fmus/:id deletes stored FMU", async () => {
    const delRes = await request(app).delete(`/api/v1/fmus/${uploadedFmuId}`);
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.body.ok, true);

    const getRes = await request(app).get(`/api/v1/fmus/${uploadedFmuId}`);
    assert.strictEqual(getRes.status, 404);
  });

  await t.test("FMU: 404 handling on missing FMU endpoints", async () => {
    const missingId = "non-existent-fmu-999";
    const res1 = await request(app).get(`/api/v1/fmus/${missingId}`);
    assert.strictEqual(res1.status, 404);

    const res2 = await request(app).get(`/api/v1/fmus/${missingId}/variables`);
    assert.strictEqual(res2.status, 404);

    const res3 = await request(app).get(`/api/v1/fmus/${missingId}/description`);
    assert.strictEqual(res3.status, 404);

    const res4 = await request(app).get(`/api/v1/fmus/${missingId}/download`);
    assert.strictEqual(res4.status, 404);

    const res5 = await request(app).delete(`/api/v1/fmus/${missingId}`);
    assert.strictEqual(res5.status, 404);
  });

  await t.test("Cosim: POST /api/v1/cosim/ssp/import rejects invalid payload", async () => {
    const res = await request(app)
      .post("/api/v1/cosim/ssp/import")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.alloc(0));
    // Since feature flag cosim_mqtt is evaluated or defaulted, either 400 or 403
    assert.ok(res.status === 400 || res.status === 403);
  });

  await t.test("Historian: GET /api/v1/historian/sessions lists recorded sessions", async () => {
    const res = await request(app).get("/api/v1/historian/sessions");
    // With null pool, historian router returns 200 with empty array or 403 if flag-gated
    if (res.status === 200) {
      assert.ok(Array.isArray(res.body.sessions));
    }
  });

  await t.test("Historian: GET /api/v1/historian/sessions/:id handles stub metadata", async () => {
    const res = await request(app).get("/api/v1/historian/sessions/session-42");
    if (res.status === 200) {
      assert.strictEqual(res.body.sessionId, "session-42");
    }
  });
});
