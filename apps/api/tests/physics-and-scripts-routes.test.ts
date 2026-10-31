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

    // Test job cancellation
    const cancelRes = await request(app).post("/api/v1/jobs/1/cancel").set("Authorization", `Bearer ${authToken}`);
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.success, true);

    // Test SSE authentication with ?token= query parameter
    const resStreamAuthQuery = await request(app).get(`/api/v1/jobs/1/stream?token=${encodeURIComponent(authToken)}`);
    assert.notStrictEqual(resStreamAuthQuery.status, 401);
  });

  await t.test("Studies: SharePoint-style Study Template Gallery, Facets, and Custom Authoring", async () => {
    const resGallery = await request(app).get("/api/v1/studies/templates");
    assert.strictEqual(resGallery.status, 200);
    assert.ok(Array.isArray(resGallery.body.templates));
    assert.ok(Array.isArray(resGallery.body.studyDefinitions));
    assert.ok(resGallery.body.studyDefinitions.length >= 13);
    assert.ok(resGallery.body.facets?.bySource?.official >= 8);
    assert.ok(resGallery.body.facets?.bySource?.package >= 5);

    // Filter by package-contributed studies
    const resPkgOnly = await request(app).get("/api/v1/studies/templates?sourceType=package");
    assert.strictEqual(resPkgOnly.status, 200);
    assert.ok(resPkgOnly.body.studyDefinitions.every((sd: { sourceType: string }) => sd.sourceType === "package"));

    // Filter by Monte Carlo kind
    const resMcOnly = await request(app).get("/api/v1/studies/templates?kind=monte-carlo");
    assert.strictEqual(resMcOnly.status, 200);
    assert.ok(resMcOnly.body.studyDefinitions.length >= 2);
    assert.ok(resMcOnly.body.studyDefinitions.every((sd: { kind: string }) => sd.kind === "monte-carlo"));

    // Author a new custom Study Template
    const resCreate = await request(app)
      .post("/api/v1/studies/templates")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Thermal Shock Reliability Audit",
        slug: "thermal-shock-reliability-audit",
        description: "Evaluates cyclic thermal fatigue and solder joint strain under MIL-STD-883.",
        kind: "parameter-sweep",
        category: "verification",
        packageName: "@aero/avionics-reliability",
        packageVersion: "1.2.0",
        tags: ["mil-std-883", "thermal-fatigue", "sweep"],
      });
    assert.strictEqual(resCreate.status, 201);
    assert.strictEqual(resCreate.body.slug, "thermal-shock-reliability-audit");

    // Fetch by slug
    const resDetail = await request(app).get("/api/v1/jobs/templates/thermal-shock-reliability-audit");
    assert.strictEqual(resDetail.status, 200);
    assert.strictEqual(resDetail.body.template.slug, "thermal-shock-reliability-audit");
    assert.strictEqual(resDetail.body.studyDefinition.packageName, "@aero/avionics-reliability");
    assert.ok(Array.isArray(resDetail.body.compatibleModels));
  });

  await t.test("Studies: Compatible Models Discovery, Source Inspection & Full Study Run Execution", async () => {
    const resCompat = await request(app).get("/api/v1/jobs/compatible-models?templateSlug=ieee-2800-frt-compliance");
    assert.strictEqual(resCompat.status, 200);
    assert.ok(Array.isArray(resCompat.body.models));
    assert.ok(resCompat.body.models.length >= 1);

    const resInspect = await request(app)
      .post("/api/v1/jobs/inspect-model")
      .send({
        code: [
          "model CustomResonator",
          '  parameter Real L(unit="H") = 0.025 "Inductance";',
          '  parameter Real C(unit="F") = 0.001 "Capacitance";',
          '  Real v_cap(start = 10.0, unit="V") "Capacitor voltage";',
          "equation",
          "  der(v_cap) = -v_cap / (L * C);",
          "end CustomResonator;",
        ].join("\n"),
      });
    assert.strictEqual(resInspect.status, 200);
    assert.strictEqual(resInspect.body.modelName, "CustomResonator");
    assert.strictEqual(resInspect.body.parameters.length, 2);
    assert.strictEqual(resInspect.body.parameters[0].name, "L");
    assert.strictEqual(resInspect.body.parameters[0].defaultValue, 0.025);

    // Execute a Monte Carlo Study Run against a bound Model
    const resMcRun = await request(app)
      .post("/api/v1/jobs/templates/monte-carlo-sweep/run")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        modelName: "BatteryPackThermalRC",
        packageName: "@energy/li-ion-thermal-pack",
        executionTarget: "local-wasm",
        studyInputs: { samples: 16, stopTime: 6.0, covPercent: 10 },
        parameterOverrides: { R_internal: 0.022, C_thermal: 820 },
      });
    assert.strictEqual(resMcRun.status, 200);
    assert.ok(resMcRun.body.jobId);
    assert.strictEqual(resMcRun.body.status, "SUCCESS");
    assert.strictEqual(resMcRun.body.studyResults.studyKind, "monte-carlo");
    assert.strictEqual(resMcRun.body.studyResults.sampleCount, 16);
    assert.ok(Array.isArray(resMcRun.body.studyResults.ensembleBands));
    assert.ok(resMcRun.body.studyResults.ensembleBands[0].p95.length > 10);
    assert.ok(Array.isArray(resMcRun.body.studyResults.sobolIndices));
    assert.ok(resMcRun.body.studyResults.provenance.sha256Lock.length === 64);

    // Verify synthesized Dakota Study Instance Artifact on the Monte Carlo job
    assert.ok(resMcRun.body.studyResults.studyInstance);
    assert.strictEqual(resMcRun.body.studyResults.studyInstance.standardFormat, "dakota");
    assert.ok(resMcRun.body.studyResults.studyInstance.filename.endsWith(".dakota"));
    assert.ok(resMcRun.body.studyResults.studyInstance.sourceContent.includes("sample_type lhs"));

    // Verify POST /api/v1/jobs/synthesize for SED-ML (.sedml) and SSP (.ssv)
    const resSynthSedml = await request(app)
      .post("/api/v1/jobs/synthesize")
      .send({
        templateSlug: "modelica-sundials-dae",
        modelName: "RLC_Resonator",
        studyInputs: { stopTime: 5.0, intervals: 400 },
      });
    assert.strictEqual(resSynthSedml.status, 200);
    assert.strictEqual(resSynthSedml.body.studyInstance.standardFormat, "sedml");
    assert.ok(resSynthSedml.body.studyInstance.sourceContent.includes("<sedML"));

    const resSynthSsv = await request(app).post("/api/v1/jobs/synthesize").send({
      templateSlug: "ssp-variant-calibration",
      modelName: "DriveTrainCoSim",
    });
    assert.strictEqual(resSynthSsv.status, 200);
    assert.strictEqual(resSynthSsv.body.studyInstance.standardFormat, "ssp-ssv");
    assert.ok(resSynthSsv.body.studyInstance.sourceContent.includes("<ssv:ParameterSet"));

    // Verify GET /api/v1/jobs/:id returns the enriched studyResults
    const resJobDetail = await request(app)
      .get(`/api/v1/jobs/${resMcRun.body.jobId}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.strictEqual(resJobDetail.status, 200);
    assert.ok(resJobDetail.body.studyResults);
    assert.strictEqual(resJobDetail.body.studyResults.templateSlug, "monte-carlo-sweep");
    assert.ok(resJobDetail.body.studyResults.studyInstance);

    // Verify GET /api/v1/jobs/:id/study-instance returns the StudyInstanceArtifact
    const resStudyInstance = await request(app)
      .get(`/api/v1/jobs/${resMcRun.body.jobId}/study-instance`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.strictEqual(resStudyInstance.status, 200);
    assert.strictEqual(resStudyInstance.body.studyInstance.standardFormat, "dakota");

    // Verify POST /api/v1/jobs/:id/rerun creates a new job from the persisted StudyInstanceArtifact
    const resRerun = await request(app)
      .post(`/api/v1/jobs/${resMcRun.body.jobId}/rerun`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.strictEqual(resRerun.status, 200);
    assert.ok(resRerun.body.jobId);
    assert.notStrictEqual(resRerun.body.jobId, resMcRun.body.jobId);

    // Verify POST /api/v1/jobs/:id/save-as-template publishes the job's Study Instance to the Gallery
    const resSaveTpl = await request(app)
      .post(`/api/v1/jobs/${resMcRun.body.jobId}/save-as-template`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Battery Pack UQ Saved Blueprint",
        slug: "battery-pack-uq-saved-blueprint",
      });
    assert.strictEqual(resSaveTpl.status, 201);
    assert.ok(resSaveTpl.body.slug.startsWith("battery-pack-uq-saved-blueprint"));

    // Verify GET /api/v1/jobs/:id/result returns trajectory CSV
    const resCsv = await request(app)
      .get(`/api/v1/jobs/${resMcRun.body.jobId}/result`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.strictEqual(resCsv.status, 200);
    assert.ok(resCsv.text.startsWith("time,"));

    // Execute an IEEE 2800 Verification Study Run and verify complianceMatrix
    const resIeeeRun = await request(app).post("/api/v1/studies/templates/ieee-2800-frt-compliance/run").send({
      executionTarget: "local-wasm",
    });
    assert.strictEqual(resIeeeRun.status, 200);
    assert.ok(Array.isArray(resIeeeRun.body.studyResults.complianceMatrix));
    assert.ok(resIeeeRun.body.studyResults.complianceMatrix.length >= 3);

    // Verify Cluster Topology Status returns structured partitions and nodes
    const resCluster = await request(app).get("/api/v1/cae/cluster/status");
    assert.strictEqual(resCluster.status, 200);
    assert.ok(Array.isArray(resCluster.body.partitions));
    assert.ok(resCluster.body.partitions.length >= 3);
    assert.ok(Array.isArray(resCluster.body.nodes));
    assert.ok(resCluster.body.nodes.length >= 3);

    // Execute a study with linkToPackage=true & targetArtifact, and verify GET /api/v1/jobs/linked
    const resLinkedRun = await request(app).post("/api/v1/jobs/runs").set("Authorization", `Bearer ${authToken}`).send({
      templateSlug: "structural-fea-audit",
      name: "Drone Chassis FEA Sign-off",
      modelName: "QuadcopterFrame.step",
      modelDomain: "fea",
      packageName: "@modelscript/drone-chassis",
      packageVersion: "2.1.0",
      targetArtifact: "QuadcopterFrame.step",
      linkToPackage: true,
      saveInstanceToPackage: true,
      standardFormat: "sedml",
      executionTarget: "local-wasm",
    });
    assert.strictEqual(resLinkedRun.status, 200);
    assert.strictEqual(resLinkedRun.body.studyResults.studyInstance.targetArtifact, "QuadcopterFrame.step");

    const resLinkedQuery = await request(app).get(
      "/api/v1/jobs/linked?package=%40modelscript%2Fdrone-chassis&artifact=QuadcopterFrame.step",
    );
    assert.strictEqual(resLinkedQuery.status, 200);
    assert.ok(Array.isArray(resLinkedQuery.body.bundledStudies));
    assert.ok(Array.isArray(resLinkedQuery.body.linkedTemplates));
    assert.ok(resLinkedQuery.body.linkedTemplates.length >= 1);
    assert.strictEqual(resLinkedQuery.body.linkedTemplates[0].bundledInRelease, false);
    assert.ok(Array.isArray(resLinkedQuery.body.linkedJobs));
    assert.ok(resLinkedQuery.body.linkedJobs.length >= 1);
    assert.strictEqual(resLinkedQuery.body.linkedJobs[0].targetArtifact, "QuadcopterFrame.step");
    assert.ok(resLinkedQuery.body.linkedJobs[0].studyInstanceArtifact?.content.includes("<sedML"));
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
