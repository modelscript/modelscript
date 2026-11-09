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
import { commitFilesToBareGitVault } from "../src/services/spaces/space-git-vault.js";
import {
  discoverWorkflowsInRepo,
  executeWorkflowManifest,
  parseGitHubWorkflow,
  parseGitLabWorkflow,
} from "../src/services/workflows/index.js";

test("Ansatz CI/CD Engine: GitHub Actions & GitLab CI Native Execution & External Ingestion", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ansatz-workflows-"));
  const gitDir = path.join(tmpDir, "git-repos");
  process.env["GIT_REPOS_DIR"] = gitDir;

  const db = new LibraryDatabase(tmpDir);
  setAuthDatabase(db);

  // Seed test user
  db.db
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, email, password_hash, display_name, account_type)
       VALUES (201, 'lead_dev', 'lead@modelscript.org', 'hash', 'Lead Controls Architect', 'admin')`,
    )
    .run();

  const userToken = jwt.sign(
    {
      id: 201,
      username: "lead_dev",
      email: "lead@modelscript.org",
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

  await t.test("1. GitHub Actions YAML Parser: multi-job DAG with needs, triggers, & step envs", async () => {
    const yaml = `
name: Modelica Verification & Gating
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  eco:
    branches: [main, release/*]

env:
  GLOBAL_SOLVER: CVODE

jobs:
  lint:
    name: Modelica Linter
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Linter
        run: echo "Linting all .mo files"

  simulate:
    name: DAE Transient Simulation
    needs: [lint]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run SUNDIALS CVODE Simulation
        run: echo "Simulating DAE with \${GLOBAL_SOLVER}"
        env:
          TOLERANCE: "1e-5"
      - name: Upload Results
        uses: actions/upload-artifact@v4
        with:
          path: sim-summary.json
`;

    const manifest = parseGitHubWorkflow(yaml, ".github/workflows/verify.yml");
    assert.ok(manifest, "Should parse GitHub workflow successfully");
    assert.equal(manifest.provider, "github");
    assert.equal(manifest.name, "Modelica Verification & Gating");
    assert.equal(manifest.jobs.size, 2);

    const lintJob = manifest.jobs.get("lint");
    assert.ok(lintJob);
    assert.equal(lintJob.name, "Modelica Linter");
    assert.equal(lintJob.needs.length, 0);
    assert.equal(lintJob.steps.length, 2);

    const simJob = manifest.jobs.get("simulate");
    assert.ok(simJob);
    assert.equal(simJob.name, "DAE Transient Simulation");
    assert.deepEqual(simJob.needs, ["lint"]);
    assert.equal(simJob.steps.length, 3);
    assert.equal(simJob.steps[1]?.env?.["TOLERANCE"], "1e-5");
  });

  await t.test("2. GitLab CI YAML Parser: stages sequencing and before_script normalization", async () => {
    const gitlabYaml = `
stages:
  - build
  - test
  - gate

variables:
  SIM_BACKEND: wasm

before_script:
  - echo "Initializing ModelScript environment"

build_model:
  stage: build
  script:
    - echo "Compiling Modelica AST to DAE"

transient_check:
  stage: test
  script:
    - echo "Solving continuous trajectories"
  artifacts:
    paths:
      - trajectories.csv
      - sim-summary.json
`;

    const manifest = parseGitLabWorkflow(gitlabYaml, ".gitlab-ci.yml");
    assert.ok(manifest, "Should parse GitLab CI workflow");
    assert.equal(manifest.provider, "gitlab");
    assert.equal(manifest.jobs.size, 2);

    const buildJob = manifest.jobs.get("build_model");
    assert.ok(buildJob);
    assert.equal(buildJob.needs.length, 0);

    const testJob = manifest.jobs.get("transient_check");
    assert.ok(testJob);
    // GitLab automatic stage sequencing: depends on all jobs in previous stage ('build')
    assert.deepEqual(testJob.needs, ["build_model"]);
    assert.ok(testJob.steps.length >= 3, "Should include checkout, before_script, and script");
    assert.ok(testJob.artifacts?.paths?.includes("sim-summary.json"));
  });

  // Setup Space and bare Git vault for execution tests
  const spaceRes = await request(server).post("/api/v1/spaces").set("Authorization", `Bearer ${userToken}`).send({
    name: "Aerospace Control Space",
    slug: "aero-ctrl",
    description: "Flight Dynamics with GitHub Actions & GitLab CI verification gates",
    domainPreset: "aerospace_controls",
    visibility: "internal",
  });
  assert.equal(spaceRes.status, 201);
  const spaceId = spaceRes.body.space.id;
  const spaceSlug = spaceRes.body.space.slug;
  const namespace = spaceRes.body.space.owner_namespace;
  const spaceRecord = db.getSpaceById(spaceId)!;
  const vaultPath = spaceRecord.git_repo_path!;

  await t.test(
    "3. Bare Vault Discovery: Discovers both .github/workflows/*.yml and .gitlab-ci.yml in Git",
    async () => {
      // Commit a GitHub Actions file and a GitLab CI file to the repository
      commitFilesToBareGitVault({
        repoPath: vaultPath,
        branch: "main",
        message: "Add CI workflows for GitHub and GitLab",
        authorName: "Lead Controls Architect",
        authorEmail: "lead@modelscript.org",
        files: [
          {
            path: ".github/workflows/physics-gate.yml",
            content: `
name: Physics CI Gate
on: [push, eco]
jobs:
  verify:
    name: Numerical Invariants
    runs-on: ubuntu-latest
    steps:
      - name: Check Conservation
        run: echo "Checking energy conservation invariants"
`,
          },
          {
            path: ".gitlab-ci.yml",
            content: `
stages:
  - test
test_stability:
  stage: test
  script:
    - echo "Checking Lyapunov stability"
`,
          },
        ],
      });

      const discovered = discoverWorkflowsInRepo({
        repoPath: vaultPath,
        ref: "main",
      });

      assert.equal(discovered.length, 2, "Should discover both GitHub Actions and GitLab CI workflows");
      const providers = discovered.map((d) => d.provider).sort();
      assert.deepEqual(providers, ["github", "gitlab"]);
    },
  );

  await t.test("4. Native Execution: Executes workflow jobs in topological order and inspects artifacts", async () => {
    // Commit a workflow that runs commands and writes simulation artifacts
    commitFilesToBareGitVault({
      repoPath: vaultPath,
      branch: "main",
      message: "Add executable verification workflow with artifact output",
      authorName: "Lead Controls Architect",
      authorEmail: "lead@modelscript.org",
      files: [
        {
          path: ".github/workflows/run-sim.yml",
          content: `
name: Native Solver Verification
on: [eco]
jobs:
  precheck:
    name: Index Reduction
    runs-on: ubuntu-latest
    steps:
      - run: echo "Pantelides index 1 verified"
  simulate:
    name: High-Fidelity SUNDIALS Solver
    needs: [precheck]
    runs-on: ubuntu-latest
    steps:
      - name: Run Acasual Integration
        run: |
          cat << 'EOF' > sim-summary.json
          {
            "status": "passed",
            "solver": "SUNDIALS CVODE (BDF Stiff Acasual)",
            "tolerance": 0.0001,
            "maxRelError": 0.000085,
            "variablesCount": 178,
            "equationsCount": 178,
            "checks": [
              {
                "name": "Eigenvalue Stability Spectrum",
                "status": "passed",
                "value": "Re(lambda) <= -0.12",
                "limit": "<= 0.0",
                "margin": "0.12 Margin"
              }
            ]
          }
          EOF
`,
        },
      ],
    });

    const discovered = discoverWorkflowsInRepo({ repoPath: vaultPath, ref: "main" });
    const runSimWorkflow = discovered.find((m) => m.name === "Native Solver Verification");
    assert.ok(runSimWorkflow, "Should find Native Solver Verification workflow");

    const runResult = executeWorkflowManifest({
      repoPath: vaultPath,
      ref: "main",
      manifest: runSimWorkflow,
    });

    assert.equal(runResult.status, "passed");
    assert.equal(runResult.conclusion, "success");
    assert.equal(runResult.jobs.length, 2);
    assert.equal(runResult.jobs[0]?.name, "Index Reduction");
    assert.equal(runResult.jobs[1]?.name, "High-Fidelity SUNDIALS Solver");
    assert.equal(runResult.jobs[0]?.status, "passed");
    assert.equal(runResult.jobs[1]?.status, "passed");

    // Inspect synthesized simulation summary from produced artifacts
    assert.equal(runResult.simulationSummary.gateStatus, "passed");
    assert.equal(runResult.simulationSummary.solver, "SUNDIALS CVODE (BDF Stiff Acasual)");
    assert.equal(runResult.simulationSummary.maxRelError, 0.000085);
    assert.equal(runResult.simulationSummary.variablesCount, 178);
    const customCheck = runResult.simulationSummary.checks.find((c) => c.name === "Eigenvalue Stability Spectrum");
    assert.ok(customCheck, "Should extract custom check from sim-summary.json artifact");
    assert.equal(customCheck.status, "passed");
  });

  await t.test("5. Native Execution Failure: Failing step halts pipeline and marks gate failed", async () => {
    commitFilesToBareGitVault({
      repoPath: vaultPath,
      branch: "failing-feature",
      message: "Add failing test workflow",
      authorName: "Lead Controls Architect",
      authorEmail: "lead@modelscript.org",
      files: [
        {
          path: ".github/workflows/strict-gate.yml",
          content: `
name: Strict Failure Check
on: [eco]
jobs:
  failing_step:
    name: Thermal Limit
    runs-on: ubuntu-latest
    steps:
      - name: Check Thermal Headroom
        run: |
          echo "Temperature exceeded 1200 K" >&2
          exit 1
  dependent_step:
    name: Downstream Clearance
    needs: [failing_step]
    runs-on: ubuntu-latest
    steps:
      - run: echo "Should be skipped"
`,
        },
      ],
    });

    const discovered = discoverWorkflowsInRepo({ repoPath: vaultPath, ref: "failing-feature" });
    const failWf = discovered.find((m) => m.name === "Strict Failure Check");
    assert.ok(failWf);

    const result = executeWorkflowManifest({
      repoPath: vaultPath,
      ref: "failing-feature",
      manifest: failWf,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.conclusion, "failure");
    assert.equal(result.jobs[0]?.status, "failed");
    assert.equal(result.jobs[1]?.status, "skipped", "Dependent job should be skipped");
    assert.equal(result.simulationSummary.gateStatus, "failed");
    assert.ok(result.logs.includes("Temperature exceeded 1200 K"));
  });

  await t.test("6. ECO Workflow Gating & API: Inspect and trigger native workflow runs on ECO branch", async () => {
    // Create an ECO proposal
    const ecoRes = await request(server)
      .post(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        title: "Upgrade Turbine Cascade Dynamics to CVODE",
        description: "Integrates stiff BDF solver and automated CI gate verification",
        severity: "major",
        sourceBranch: "eco/turbine-upgrade",
        targetBranch: "main",
      });
    assert.equal(ecoRes.status, 201);
    const ecoId = ecoRes.body.eco.id;

    // Add a workflow into the ECO branch
    commitFilesToBareGitVault({
      repoPath: vaultPath,
      branch: "eco/turbine-upgrade",
      message: "Add turbine gate workflow",
      authorName: "Lead Controls Architect",
      authorEmail: "lead@modelscript.org",
      files: [
        {
          path: ".github/workflows/eco-gate.yml",
          content: `
name: Turbine Verification Gate
on: [eco]
jobs:
  turbine_sim:
    name: Turbine Multi-Phase Invariant
    runs-on: ubuntu-latest
    steps:
      - name: Verify Flow Rate
        run: |
          cat << 'EOF' > sim-summary.json
          {
            "status": "passed",
            "solver": "SUNDIALS CVODE",
            "maxRelError": 0.000072,
            "variablesCount": 210,
            "equationsCount": 210
          }
          EOF
`,
        },
      ],
    });

    // Query workflows for this ECO via API
    const getWfRes = await request(server)
      .get(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos/${ecoId}/workflows`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.equal(getWfRes.status, 200);
    assert.ok(getWfRes.body.manifests.length >= 1, "Should discover eco-gate.yml on ECO branch");

    // Trigger workflow run
    const runRes = await request(server)
      .post(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos/${ecoId}/workflows/run`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ workflowFile: ".github/workflows/eco-gate.yml" });
    assert.equal(runRes.status, 200);
    assert.equal(runRes.body.eco.simulation_gate_status, "passed");
    assert.ok(runRes.body.runs.length >= 1);
    assert.equal(runRes.body.simulation.maxRelError, 0.000072);
    assert.equal(runRes.body.simulation.variablesCount, 210);

    // Verify GET /simulation reflects workflow run count and latest run
    const simRes = await request(server)
      .get(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos/${ecoId}/simulation`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.equal(simRes.status, 200);
    assert.equal(simRes.body.simulation.gateStatus, "passed");
    assert.ok(simRes.body.simulation.workflowRunsCount >= 1);
    assert.ok(simRes.body.simulation.latestWorkflowRun);
    assert.equal(simRes.body.simulation.latestWorkflowRun.status, "passed");
  });

  await t.test("7. External CI Report Endpoint: Ingest external runner results directly to ECO gate", async () => {
    // Create an ECO for external CI runner report
    const ecoRes = await request(server)
      .post(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        title: "External HPC CVODE Simulation Run",
        description: "Computed on Slurm cluster with external report ingestion",
        severity: "safety_critical",
        sourceBranch: "eco/slurm-run",
      });
    const ecoId = ecoRes.body.eco.id;

    // External runner pushes simulation summary
    const reportRes = await request(server)
      .post(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos/${ecoId}/workflows/external-report`)
      .send({
        provider: "github",
        workflowName: "GitHub Actions HPC Cluster Dispatch",
        status: "passed",
        commitSha: "c0ffee1234567890",
        simulationSummary: {
          status: "passed",
          solver: "SUNDIALS CVODE (64-core MPI HPC Node)",
          maxRelError: 0.000041,
          variablesCount: 450,
          equationsCount: 450,
          checks: [
            {
              name: "Blade Flutter Boundary",
              status: "passed",
              value: "Mach 0.82",
              limit: "Mach 0.85",
              margin: "Safety Margin Met",
            },
          ],
        },
        logs: "Simulation successfully converged in 4.21s on Slurm job #88412",
      });

    assert.equal(reportRes.status, 200);
    assert.equal(reportRes.body.success, true);
    assert.equal(reportRes.body.simulationGateStatus, "passed");
    assert.equal(reportRes.body.eco.simulation_gate_status, "passed");

    // Check simulation endpoint
    const simRes = await request(server).get(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos/${ecoId}/simulation`);
    assert.equal(simRes.status, 200);
    assert.equal(simRes.body.simulation.gateStatus, "passed");
    assert.equal(simRes.body.simulation.solver, "SUNDIALS CVODE (64-core MPI HPC Node)");
    assert.equal(simRes.body.simulation.maxRelError, 0.000041);
  });

  await t.test("8. Webhook Ingestion: GitHub check_run & GitLab Pipeline Hook update Space ECO gate", async () => {
    // Create an ECO for webhook verification
    const ecoRes = await request(server)
      .post(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        title: "Avionics Bus Redundancy ECO",
        description: "Checking CAN-FD and ARINC-429 bus parity",
        sourceBranch: "eco/avionics-bus",
      });
    const ecoId = ecoRes.body.eco.id;

    // Simulate GitHub check_run webhook
    const ghWhRes = await request(server)
      .post(`/api/v1/spaces/${namespace}/${spaceSlug}/webhooks/github`)
      .set("x-github-event", "check_run")
      .send({
        check_run: {
          name: "ARINC-429 Bus Verification",
          head_sha: "a1b2c3d4e5f6",
          status: "completed",
          conclusion: "success",
          check_suite: {
            head_branch: "eco/avionics-bus",
          },
          output: {
            title: "Timing Analysis Passed",
            summary: "Bus latency within 2.5ms envelope",
          },
        },
      });

    assert.equal(ghWhRes.status, 202);
    assert.equal(ghWhRes.body.spaceId, spaceId);
    assert.equal(ghWhRes.body.ecoId, ecoId);
    assert.equal(ghWhRes.body.ciStatus, "passed");

    // Verify ECO simulation gate updated to passed
    const simRes1 = await request(server).get(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos/${ecoId}/simulation`);
    assert.equal(simRes1.status, 200);
    assert.equal(simRes1.body.simulation.gateStatus, "passed");

    // Now simulate GitLab Pipeline Hook with a failure
    const glWhRes = await request(server)
      .post(`/api/v1/spaces/${namespace}/${spaceSlug}/webhooks/gitlab`)
      .set("x-gitlab-event", "Pipeline Hook")
      .send({
        object_attributes: {
          id: 991,
          ref: "eco/avionics-bus",
          sha: "a1b2c3d4e5f6",
          status: "failed",
          stages: ["build", "test"],
        },
      });

    assert.equal(glWhRes.status, 202);
    assert.equal(glWhRes.body.ciStatus, "failed");

    // Verify ECO simulation gate is now failed due to CI failure
    const simRes2 = await request(server).get(`/api/v1/spaces/${namespace}/${spaceSlug}/ecos/${ecoId}/simulation`);
    assert.equal(simRes2.status, 200);
    assert.equal(simRes2.body.simulation.gateStatus, "failed");
  });

  server.close();
});
