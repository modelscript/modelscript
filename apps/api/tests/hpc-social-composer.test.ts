// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";

test("HPC Social Post Composer & Artifact Binding", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-social-test-"));
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

  const user = db.createUser("aero_engineer", "aero@modelscript.test", "hashed_pwd", "Aero Engineer");
  const userId = user.id;

  // Create simulated result directories for test jobs
  const jobResultDir1 = path.join(tmpDir, "su2_results_test");
  fs.mkdirSync(jobResultDir1, { recursive: true });
  fs.writeFileSync(path.join(jobResultDir1, "result.vtu"), "<VTKFile></VTKFile>", "utf8");
  fs.writeFileSync(
    path.join(jobResultDir1, "scalars.json"),
    JSON.stringify({ cd: 0.0182, cl: 0.284, mach: 0.84, iterations: 420 }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(jobResultDir1, "job_spec.json"),
    JSON.stringify({
      solver: "su2",
      deckContent: "MATH_PROBLEM= EULER\nMACH_NUMBER= 0.84\nAOA= 3.06\n",
      deckFormat: "cfg",
      cores: 16,
    }),
    "utf8",
  );

  const su2JobId = db.createJob(
    "CAE SU2: Transonic Onera M6 Wing",
    "SUCCESS",
    "ADHOC",
    "ide",
    null,
    { resultDir: jobResultDir1, solver: "su2" },
    userId,
  );
  db.updateJobAccounting(su2JobId, {
    computeProfile: "high-memory",
    cpuSeconds: 34.2,
    peakMemoryMb: 8192,
    gpuSeconds: 0,
    costCredits: 4.5,
  });

  const jobResultDir2 = path.join(tmpDir, "ccx_results_test");
  fs.mkdirSync(jobResultDir2, { recursive: true });
  fs.writeFileSync(path.join(jobResultDir2, "result.vtu"), "<VTKFile></VTKFile>", "utf8");
  fs.writeFileSync(
    path.join(jobResultDir2, "scalars.json"),
    JSON.stringify({ maxStressMpa: 248.5, maxDisplacementMm: 1.42 }),
    "utf8",
  );

  const ccxJobId = db.createJob(
    "CAE CALCULIX: Drone Arm Structural FEA",
    "SUCCESS",
    "ADHOC",
    "ide",
    null,
    { resultDir: jobResultDir2, solver: "calculix" },
    userId,
  );
  db.updateJobAccounting(ccxJobId, {
    computeProfile: "standard",
    cpuSeconds: 18.5,
    peakMemoryMb: 2048,
    gpuSeconds: 0,
    costCredits: 1.0,
  });

  await t.test("getUserCompletedHpcJobs queries completed cluster runs and parses assets", () => {
    const jobs = db.getUserCompletedHpcJobs(userId);
    assert.strictEqual(jobs.length, 2);

    const su2Job = jobs.find((j) => j.id === su2JobId);
    assert.ok(su2Job);
    assert.strictEqual(su2Job.solver, "su2");
    assert.strictEqual(su2Job.computeProfile, "high-memory");
    assert.strictEqual(su2Job.costCredits, 4.5);
    assert.strictEqual(su2Job.cpuSeconds, 34.2);
    assert.strictEqual(su2Job.hasVtu, true);
    assert.strictEqual(su2Job.hasScalars, true);
    assert.strictEqual(su2Job.scalars?.["cd"], 0.0182);

    const ccxJob = jobs.find((j) => j.id === ccxJobId);
    assert.ok(ccxJob);
    assert.strictEqual(ccxJob.solver, "calculix");
    assert.strictEqual(ccxJob.hasVtu, true);
    assert.strictEqual(ccxJob.scalars?.["maxStressMpa"], 248.5);
  });

  await t.test("createArtifactViewFromJob binds HPC job to interactive 3D view with provenance", () => {
    const result = db.createArtifactViewFromJob(userId, su2JobId, {
      colormap: "turbo",
      title: "Onera M6 Transonic Aero Analysis",
    });

    assert.ok(result.artifactId > 0);
    assert.ok(result.suggestedCaption.includes("aerodynamic CFD simulation"));
    assert.ok(result.suggestedCaption.includes("0.0182")); // Cd
    assert.ok(result.suggestedCaption.includes("4.50 cr"));

    const viewConfig: any = result.viewConfig;
    assert.strictEqual(viewConfig.jobId, su2JobId);
    assert.strictEqual(viewConfig.solver, "su2");
    assert.strictEqual(viewConfig.colormap, "turbo");
    assert.ok(viewConfig.provenance);
    assert.strictEqual(viewConfig.provenance.solver, "su2");
    assert.strictEqual(viewConfig.provenance.profile, "high-memory");
    assert.strictEqual(viewConfig.provenance.costCredits, 4.5);
  });

  // REST API Endpoints
  await t.test("GET /api/v1/cae/user-jobs returns list of completed jobs for picker modal", async () => {
    const res = await request(app).get("/api/v1/cae/user-jobs").expect(200);

    assert.ok(Array.isArray(res.body.jobs));
    assert.ok(res.body.jobs.length >= 2);
    assert.strictEqual(res.body.count, res.body.jobs.length);

    const job = res.body.jobs[0];
    assert.ok(job.id);
    assert.ok(job.name);
    assert.ok(job.solver);
    assert.ok(typeof job.costCredits === "number");
  });

  await t.test("POST /api/v1/social/artifact-views/from-hpc-job converts run into post artifact", async () => {
    // Missing jobId returns 400
    await request(app).post("/api/v1/social/artifact-views/from-hpc-job").send({}).expect(400);

    // Valid job binding returns 201 with metadata
    const res = await request(app)
      .post("/api/v1/social/artifact-views/from-hpc-job")
      .send({
        jobId: ccxJobId,
        colormap: "coolwarm",
      })
      .expect(201);

    assert.ok(res.body.artifactId > 0);
    assert.ok(res.body.suggestedCaption.includes("structural FEA simulation"));
    assert.ok(res.body.suggestedCaption.includes("248.5 MPa"));
    assert.strictEqual(res.body.viewConfig.solver, "calculix");
    assert.strictEqual(res.body.viewConfig.colormap, "coolwarm");
  });

  await t.test("GET /api/v1/cae/jobs/:id/reproduce-spec returns execution recipe for fork", async () => {
    const res = await request(app).get(`/api/v1/cae/jobs/${su2JobId}/reproduce-spec`).expect(200);

    assert.strictEqual(res.body.jobId, su2JobId);
    assert.strictEqual(res.body.solver, "su2");
    assert.strictEqual(res.body.profile, "high-memory");
    assert.strictEqual(res.body.cores, 16);
    assert.ok(res.body.deckContent.includes("MATH_PROBLEM= EULER"));
    assert.strictEqual(res.body.deckFormat, "cfg");
  });
});
