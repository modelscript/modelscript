// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("Physics, Scripts, and Instance Lifecycle REST Routes", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "physics-scripts-test-"));
  const db = new LibraryDatabase(tmpDir);
  const adminUser = db.createUser("admin", "admin@modelscript.local", "hashedpassword", {
    accountType: "admin",
    initialCredits: 10000,
  });
  const jobQueue = new JobQueue();
  const app = createApp({ database: db, jobQueue });

  const authToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, email: adminUser.email, role: "admin" },
    JWT_SECRET,
  );

  const physicsCacheDir = path.join(process.cwd(), "data", "physics-cache");
  let uploadedHash = "";

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (uploadedHash) {
        fs.rmSync(path.join(physicsCacheDir, uploadedHash), { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  // ── Physics Study Schemas ──────────────────────────────────────────

  await t.test("Physics: GET /api/v1/physics/flattenStudy returns CFD parameters", async () => {
    const res = await request(app).get("/api/v1/physics/flattenStudy?className=DroneCFDStudy");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.workflowClass, "ModelScript.Studies.CFD");
    assert.ok(res.body.parameters.inletVelocity !== undefined);
  });

  await t.test("Physics: GET /api/v1/physics/flattenStudy returns Optimization study parameters", async () => {
    const res = await request(app).get("/api/v1/physics/flattenStudy?className=WingOptimizationStudy");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.workflowClass, "ModelScript.Studies.OptimizationStudy");
  });

  await t.test("Physics: GET /api/v1/physics/flattenStudy returns MonteCarlo study parameters", async () => {
    const res = await request(app).get("/api/v1/physics/flattenStudy?className=StructuralMonteCarloStudy");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.workflowClass, "ModelScript.Studies.MonteCarloStudy");
    assert.strictEqual(res.body.parameters.samples, 100);
  });

  await t.test("Physics: GET /api/v1/physics/flattenStudy returns Parameter study parameters", async () => {
    const res = await request(app).get("/api/v1/physics/flattenStudy?className=AeroParameterStudy");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.workflowClass, "ModelScript.Studies.ParameterStudy");
  });

  await t.test("Physics: GET /api/v1/physics/flattenStudy defaults to StaticStructuralFEA", async () => {
    const res = await request(app).get("/api/v1/physics/flattenStudy?className=GenericBracket");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.workflowClass, "ModelScript.Studies.StaticStructuralFEA");
    assert.ok(res.body.parameters.youngsModulus !== undefined);
  });

  // ── Geometry Upload & Deduplication ────────────────────────────────

  await t.test("Physics: POST /api/v1/physics/upload rejects missing file", async () => {
    const res = await request(app).post("/api/v1/physics/upload");
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "No file uploaded.");
  });

  await t.test("Physics: POST /api/v1/physics/upload accepts STEP buffer and deduplicates", async () => {
    const dummyStep = Buffer.from("ISO-10303-21; HEADER; ENDSEC; DATA; ENDSEC; END-ISO-10303-21;");
    const expectedHash = crypto.createHash("sha256").update(dummyStep).digest("hex");

    const res1 = await request(app).post("/api/v1/physics/upload").attach("file", dummyStep, "test-bracket.step");
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.hash, expectedHash);
    assert.strictEqual(res1.body.cached, false);

    uploadedHash = expectedHash;

    const res2 = await request(app).post("/api/v1/physics/upload").attach("file", dummyStep, "test-bracket.step");
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.hash, expectedHash);
    assert.strictEqual(res2.body.cached, true);
  });

  await t.test("Physics: HEAD /api/v1/physics/upload/:hash checks geometry existence", async () => {
    const headOk = await request(app).head(`/api/v1/physics/upload/${uploadedHash}`);
    assert.strictEqual(headOk.status, 200);

    const headMissing = await request(app).head(
      "/api/v1/physics/upload/0000000000000000000000000000000000000000000000000000000000000000",
    );
    assert.strictEqual(headMissing.status, 404);

    const headInvalid = await request(app).head("/api/v1/physics/upload/short");
    assert.strictEqual(headInvalid.status, 404);
  });

  // ── Physics Simulation & CAM Run ───────────────────────────────────

  await t.test("Physics: POST /api/v1/physics/run validates inputs", async () => {
    const resNoBody = await request(app).post("/api/v1/physics/run").send({});
    assert.strictEqual(resNoBody.status, 400);

    const resBadHash = await request(app)
      .post("/api/v1/physics/run")
      .send({
        geometryHash: "invalid_short",
        config: { type: "FEA" },
      });
    assert.strictEqual(resBadHash.status, 400);

    const resMissingGeom = await request(app)
      .post("/api/v1/physics/run")
      .send({
        geometryHash: "1111111111111111111111111111111111111111111111111111111111111111",
        config: { type: "FEA" },
      });
    assert.strictEqual(resMissingGeom.status, 404);
  });

  await t.test("Physics: POST /api/v1/physics/run returns pre-computed cached result", async () => {
    const config = { workflowClass: "FEA", meshResolution: 0.02 };
    const configHash = crypto
      .createHash("sha256")
      .update(Buffer.from(JSON.stringify(config)))
      .digest("hex");
    const resultDir = path.resolve(physicsCacheDir, uploadedHash, configHash);
    fs.mkdirSync(resultDir, { recursive: true });
    fs.writeFileSync(path.join(resultDir, "result.vtu"), "<VTKFile></VTKFile>");
    fs.writeFileSync(path.join(resultDir, "scalars.json"), JSON.stringify({ maxStress: { value: 120.5 } }));

    const res = await request(app).post("/api/v1/physics/run").send({
      geometryHash: uploadedHash,
      config,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "completed");
    assert.strictEqual(res.body.cached, true);
  });

  await t.test("Physics: POST /api/v1/physics/run-cam validates inputs and returns cached toolpath", async () => {
    const resNoBody = await request(app).post("/api/v1/physics/run-cam").send({});
    assert.strictEqual(resNoBody.status, 400);

    const camConfig = { toolDiameter: 6.0, spindleRpm: 12000 };
    const camConfigHash = crypto
      .createHash("sha256")
      .update(Buffer.from(JSON.stringify(camConfig)))
      .digest("hex");
    const camDir = path.resolve(physicsCacheDir, uploadedHash, "cam_" + camConfigHash);
    fs.mkdirSync(camDir, { recursive: true });
    fs.writeFileSync(path.join(camDir, "toolpath.gcode"), "G00 X0 Y0 Z5\nG01 Z-1 F200");

    const res = await request(app).post("/api/v1/physics/run-cam").send({
      geometryHash: uploadedHash,
      config: camConfig,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "completed");
    assert.strictEqual(res.body.cached, true);
  });

  // ── Physics Job Polling & Results ──────────────────────────────────

  await t.test("Physics: Job status and scalar results inspection", async () => {
    const res404 = await request(app).get("/api/v1/physics/nonexistent-job");
    assert.strictEqual(res404.status, 404);

    const dummyVtu = path.join(tmpDir, "sample.vtu");
    fs.writeFileSync(dummyVtu, "<VTKFile>VTU CONTENT</VTKFile>");
    const dummyScalars = path.join(tmpDir, "scalars.json");
    fs.writeFileSync(dummyScalars, JSON.stringify({ maxStress: { value: 120.5 }, minPressure: { value: -10.0 } }));

    jobQueue.enqueue("physics-mock-job", async () => {});
    const queueStatus = jobQueue.getStatus("physics-mock-job");
    assert.ok(queueStatus);
    queueStatus.status = "completed";
    queueStatus.resultPath = dummyVtu;

    const resStatus = await request(app).get("/api/v1/physics/physics-mock-job");
    assert.strictEqual(resStatus.status, 200);
    assert.strictEqual(resStatus.body.status, "completed");

    const resResult = await request(app).get("/api/v1/physics/physics-mock-job/result");
    assert.strictEqual(resResult.status, 200);
    assert.ok(resResult.text.includes("VTU CONTENT"));

    const resAllScalars = await request(app).get("/api/v1/physics/physics-mock-job/result/scalar");
    assert.strictEqual(resAllScalars.status, 200);
    assert.strictEqual(resAllScalars.body.maxStress.value, 120.5);

    const resFilteredScalar = await request(app).get(
      "/api/v1/physics/physics-mock-job/result/scalar?field=minPressure",
    );
    assert.strictEqual(resFilteredScalar.status, 200);
    assert.strictEqual(resFilteredScalar.body.minPressure.value, -10.0);
  });

  // ── Scripts & Jobs Routes ──────────────────────────────────────────

  await t.test("Scripts: Template listing and retrieval", async () => {
    const resList = await request(app).get("/api/v1/jobs/templates");
    assert.strictEqual(resList.status, 200);
    assert.ok(Array.isArray(resList.body.templates));

    const resNotFound = await request(app).get("/api/v1/jobs/templates/99999");
    assert.strictEqual(resNotFound.status, 404);
  });

  await t.test("Scripts: Jobs querying and log authorization", async () => {
    const resJobs = await request(app).get("/api/v1/jobs");
    assert.strictEqual(resJobs.status, 200);
    assert.ok(Array.isArray(resJobs.body.jobs));

    const resJob404 = await request(app).get("/api/v1/jobs/99999");
    assert.strictEqual(resJob404.status, 404);

    const resLogsUnauth = await request(app).get("/api/v1/jobs/1/logs");
    assert.strictEqual(resLogsUnauth.status, 401);

    const resLogsAuth = await request(app).get("/api/v1/jobs/99999/logs").set("Authorization", `Bearer ${authToken}`);
    assert.strictEqual(resLogsAuth.status, 404);
  });

  // ── Physical Hardware Instances ────────────────────────────────────

  await t.test("Instances: Hardware birth certificate registration and queries", async () => {
    db.getOrCreatePackage("SmartSensor");

    const resUnauth = await request(app).post("/api/v1/instances").send({
      serialNumber: "SN-TEST-001",
      packageName: "SmartSensor",
      version: "1.0.0",
    });
    assert.strictEqual(resUnauth.status, 401);

    const resMissingField = await request(app)
      .post("/api/v1/instances")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ packageName: "SmartSensor" });
    assert.strictEqual(resMissingField.status, 400);

    const resMissingPkg = await request(app)
      .post("/api/v1/instances")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        serialNumber: "SN-TEST-001",
        packageName: "UnknownPackage",
        version: "1.0.0",
      });
    assert.strictEqual(resMissingPkg.status, 404);

    const resCreate = await request(app)
      .post("/api/v1/instances")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        serialNumber: "SN-TEST-001",
        packageName: "SmartSensor",
        version: "1.0.0",
        commitSha: "a1b2c3d4",
        variant: "industrial",
        birthData: { calibrationOffset: 0.12, testerId: "qa-rig-04" },
      });
    assert.strictEqual(resCreate.status, 201);
    assert.ok(resCreate.body.id);
    assert.strictEqual(resCreate.body.instance.serial_number, "SN-TEST-001");

    const resDuplicate = await request(app).post("/api/v1/instances").set("Authorization", `Bearer ${authToken}`).send({
      serialNumber: "SN-TEST-001",
      packageName: "SmartSensor",
      version: "1.0.0",
    });
    assert.strictEqual(resDuplicate.status, 409);

    const resGet = await request(app).get("/api/v1/instances/SN-TEST-001");
    assert.strictEqual(resGet.status, 200);
    assert.strictEqual(resGet.body.serial_number, "SN-TEST-001");

    const resGet404 = await request(app).get("/api/v1/instances/SN-UNKNOWN");
    assert.strictEqual(resGet404.status, 404);

    const resPkgInstances = await request(app).get("/api/v1/instances?package=SmartSensor");
    assert.strictEqual(resPkgInstances.status, 200);
    assert.ok(Array.isArray(resPkgInstances.body.instances));
    assert.strictEqual(resPkgInstances.body.instances.length, 1);
  });
});
