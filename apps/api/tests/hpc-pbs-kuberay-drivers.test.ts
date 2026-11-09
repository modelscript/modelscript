// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getComputeProfile } from "../src/services/hpc/compute-profiles.js";
import { KubeRayDriver } from "../src/services/hpc/drivers/kuberay-driver.js";
import { generatePbsScript, parsePbsQstatOutput, PbsDriver } from "../src/services/hpc/drivers/pbs-driver.js";
import type { HpcJobSpec } from "../src/services/hpc/hpc-types.js";
import { LocalFsObjectStager } from "../src/services/hpc/staging/local-stager.js";
import { S3ObjectStager } from "../src/services/hpc/staging/s3-stager.js";

test("HPC PBS & KubeRay Drivers and In-Flight Remote Log Streaming", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-pbs-ray-test-"));
  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. PBS Script Generation & Output Parsing ────────────────────────
  await t.test("generatePbsScript generates standard #PBS directives and selects", () => {
    const spec: HpcJobSpec = {
      jobId: "pbs_job_1",
      name: "AeroSimulation",
      command: "openfoam",
      args: ["-parallel"],
      workingDir: tmpDir,
      resources: {
        nodes: 2,
        tasksPerNode: 16,
        cpusPerTask: 2,
        memoryMb: 32768,
        timeLimitMinutes: 120,
        partition: "workq",
        account: "project_cfd",
      },
      env: { FOAM_SIGFPE: "true" },
      modules: ["openmpi/4.1.5", "openfoam/v2312"],
    };

    const script = generatePbsScript(spec);
    assert.ok(script.includes("#PBS -N AeroSimulation"));
    assert.ok(script.includes("#PBS -l select=2:ncpus=2:mpiprocs=16:mem=32768mb"));
    assert.ok(script.includes("#PBS -l walltime=02:00:00"));
    assert.ok(script.includes("#PBS -q workq"));
    assert.ok(script.includes("#PBS -A project_cfd"));
    assert.ok(script.includes("module load openmpi/4.1.5"));
    assert.ok(script.includes('export FOAM_SIGFPE="true"'));
    assert.ok(script.includes("mpirun -np 32 openfoam -parallel"));
  });

  await t.test("parsePbsQstatOutput handles JSON, multi-line, and summary states", () => {
    const jsonOutput = JSON.stringify({
      Jobs: {
        "1001.pbs-server": {
          job_state: "R",
          Exit_status: 0,
        },
      },
    });
    const parsedJson = parsePbsQstatOutput(jsonOutput);
    assert.strictEqual(parsedJson.state, "RUNNING");

    const multiLineRunning = `
Job Id: 1002.pbs-server
    Job_Name = test
    job_state = R
`;
    assert.strictEqual(parsePbsQstatOutput(multiLineRunning).state, "RUNNING");

    const multiLineCompleted = `
Job Id: 1003.pbs-server
    job_state = C
    Exit_status = 0
`;
    const parsedCompleted = parsePbsQstatOutput(multiLineCompleted);
    assert.strictEqual(parsedCompleted.state, "COMPLETED");
    assert.strictEqual(parsedCompleted.exitCode, 0);

    const multiLineFailed = `
Job Id: 1004.pbs-server
    job_state = C
    Exit_status = 137
`;
    const parsedFailed = parsePbsQstatOutput(multiLineFailed);
    assert.strictEqual(parsedFailed.state, "FAILED");
    assert.strictEqual(parsedFailed.exitCode, 137);
  });

  await t.test("PbsDriver lifecycle: submit, poll, getMetrics, cancel", async () => {
    const executedCommands: { cmd: string; args: string[] }[] = [];
    const mockExecutor = async (cmd: string, args: string[]) => {
      executedCommands.push({ cmd, args });
      if (cmd === "qsub") {
        return { stdout: "4242.cluster.internal\n", stderr: "" };
      }
      if (cmd === "qstat") {
        return {
          stdout: `
Job Id: 4242.cluster.internal
    job_state = C
    Exit_status = 0
    resources_used.cput = 00:10:00
    resources_used.walltime = 00:05:00
    resources_used.mem = 4096mb
`,
          stderr: "",
        };
      }
      if (cmd === "qdel") {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    const pbsDriver = new PbsDriver({ executor: mockExecutor });
    assert.strictEqual(pbsDriver.type, "pbs");

    const spec: HpcJobSpec = {
      jobId: "pbs_run_42",
      name: "PbsTest",
      command: "echo",
      args: ["hello"],
      workingDir: path.join(tmpDir, "pbs_run_42"),
      resources: { cpusPerTask: 4, memoryMb: 8192 },
      profileId: "standard",
    };

    const sub = await pbsDriver.submit(spec);
    assert.strictEqual(sub.nativeJobId, "4242.cluster.internal");
    assert.strictEqual(sub.driverType, "pbs");

    const status = await pbsDriver.pollStatus(sub.nativeJobId);
    assert.strictEqual(status.state, "COMPLETED");

    const profile = getComputeProfile("standard");
    const metrics = await pbsDriver.getMetrics(sub.nativeJobId, spec.workingDir, profile);
    assert.strictEqual(metrics.wallClockSeconds, 300);
    assert.strictEqual(metrics.cpuCoreSeconds, 600);
    assert.strictEqual(metrics.peakMemoryMb, 4096);
    assert.ok(metrics.costCredits > 0);

    const cancelled = await pbsDriver.cancel(sub.nativeJobId);
    assert.strictEqual(cancelled, true);
    assert.ok(executedCommands.some((c) => c.cmd === "qdel" && c.args[0] === "4242.cluster.internal"));
  });

  // ── 2. KubeRay Driver Lifecycle ──────────────────────────────────────
  await t.test("KubeRayDriver coordinates Ray Job Submission REST API", async () => {
    let jobState = "PENDING";
    const mockRayFetch: typeof fetch = async (input, init) => {
      const urlStr = String(input);
      const method = init?.method || "GET";

      if (urlStr.endsWith("/api/jobs/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.ok(body.entrypoint.includes("python solve.py"));
        return new Response(JSON.stringify({ submission_id: "ray-job-999" }), { status: 200 });
      }

      if (urlStr.includes("/api/jobs/ray-job-999") && method === "GET") {
        return new Response(
          JSON.stringify({
            submission_id: "ray-job-999",
            status: jobState,
            start_time: Date.now() - 30000,
            end_time: Date.now(),
          }),
          { status: 200 },
        );
      }

      if (urlStr.includes("/api/jobs/ray-job-999/stop") && method === "POST") {
        jobState = "STOPPED";
        return new Response(JSON.stringify({ stopped: true }), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };

    const rayDriver = new KubeRayDriver({
      baseUrl: "http://ray-cluster:8265",
      fetchFn: mockRayFetch,
    });
    assert.strictEqual(rayDriver.type, "kuberay");

    const spec: HpcJobSpec = {
      jobId: "ray_sim_1",
      name: "RayPhysicsSweep",
      command: "python",
      args: ["solve.py", "--batch=64"],
      workingDir: path.join(tmpDir, "ray_job"),
      resources: { cpusPerTask: 8, gpus: 1 },
      profileId: "gpu-a100",
    };

    const sub = await rayDriver.submit(spec);
    assert.strictEqual(sub.nativeJobId, "ray-job-999");
    assert.strictEqual(sub.driverType, "kuberay");

    const pendingStatus = await rayDriver.pollStatus("ray-job-999");
    assert.strictEqual(pendingStatus.state, "PENDING");

    jobState = "RUNNING";
    const runningStatus = await rayDriver.pollStatus("ray-job-999");
    assert.strictEqual(runningStatus.state, "RUNNING");

    jobState = "SUCCEEDED";
    const successStatus = await rayDriver.pollStatus("ray-job-999");
    assert.strictEqual(successStatus.state, "COMPLETED");

    const profile = getComputeProfile("gpu-a100");
    const metrics = await rayDriver.getMetrics("ray-job-999", spec.workingDir, profile);
    assert.ok(metrics.wallClockSeconds >= 29);
    assert.ok(metrics.costCredits > 0);

    const cancelled = await rayDriver.cancel("ray-job-999");
    assert.strictEqual(cancelled, true);
  });

  // ── 3. S3 In-Flight Remote Log Chunk Streaming ───────────────────────
  await t.test("S3ObjectStager and HpcEngine stream incremental remote in-flight logs", async () => {
    const s3Files = new Map<string, { body: Buffer; contentType: string }>();

    const mockS3Fetch: typeof fetch = async (input, init) => {
      const urlStr = String(input);
      const url = new URL(urlStr);
      const cleanPath = url.pathname.replace(/^\/+/, "");
      const method = init?.method || "GET";

      if (method === "PUT") {
        const bodyBuf = Buffer.isBuffer(init?.body)
          ? init.body
          : typeof init?.body === "string"
            ? Buffer.from(init.body)
            : Buffer.alloc(0);
        s3Files.set(cleanPath, { body: bodyBuf, contentType: "text/plain" });
        return new Response("", { status: 200 });
      }

      if (method === "HEAD") {
        return s3Files.has(cleanPath) ? new Response("", { status: 200 }) : new Response("", { status: 404 });
      }

      if (method === "GET") {
        const entry = s3Files.get(cleanPath);
        if (!entry) return new Response("Not found", { status: 404 });

        const rangeHeader =
          (init?.headers as Record<string, string>)?.["Range"] || (init?.headers as Record<string, string>)?.["range"];
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-/);
          if (match && match[1]) {
            const start = parseInt(match[1], 10);
            if (start >= entry.body.length) {
              return new Response("", { status: 416 });
            }
            const slice = entry.body.subarray(start);
            return new Response(slice, { status: 206 });
          }
        }
        return new Response(entry.body, { status: 200 });
      }

      return new Response("Method not allowed", { status: 405 });
    };

    const s3Stager = new S3ObjectStager({
      endpoint: "http://localhost:9000",
      bucket: "test-bucket",
      accessKeyId: "mock-key",
      secretAccessKey: "mock-secret",
      fetchFn: mockS3Fetch,
    });

    // 1. Verify prologue includes in-flight log background flusher daemon
    const manifest = await s3Stager.createJobStagingManifest("job_stream_1", {}, ["output.log"]);
    assert.ok(manifest.prologueScript.includes("MSX_LOG_SYNC_PID"));
    assert.ok(manifest.prologueScript.includes("curl -s -f -X PUT --data-binary"));
    assert.ok(manifest.epilogueScript.includes("kill $MSX_LOG_SYNC_PID"));

    // 2. Test readLogChunk Range fetching
    const remoteLogKey = "jobs/job_stream_1/outputs/output.log";
    const s3Path = `test-bucket/${remoteLogKey}`;

    // Initially no file
    const initialChunk = await s3Stager.readLogChunk(remoteLogKey, 0);
    assert.strictEqual(initialChunk, null);

    // Simulate worker uploading first log chunk
    s3Files.set(s3Path, { body: Buffer.from("Step 1: Init\nStep 2: Solve\n"), contentType: "text/plain" });
    const chunk1 = await s3Stager.readLogChunk(remoteLogKey, 0);
    assert.ok(chunk1 !== null);
    assert.strictEqual(chunk1.chunk, "Step 1: Init\nStep 2: Solve\n");
    assert.strictEqual(chunk1.totalBytes, 27);

    // Simulate worker uploading appended log chunk
    s3Files.set(s3Path, {
      body: Buffer.from("Step 1: Init\nStep 2: Solve\nStep 3: Convergence\n"),
      contentType: "text/plain",
    });
    const chunk2 = await s3Stager.readLogChunk(remoteLogKey, chunk1.totalBytes);
    assert.ok(chunk2 !== null);
    assert.strictEqual(chunk2.chunk, "Step 3: Convergence\n");
    assert.strictEqual(chunk2.totalBytes, 47);

    // No new bytes uploaded
    const chunk3 = await s3Stager.readLogChunk(remoteLogKey, chunk2.totalBytes);
    assert.strictEqual(chunk3, null);

    // 3. Test LocalFsObjectStager readLogChunk
    const localStager = new LocalFsObjectStager(path.join(tmpDir, "local-staging"));
    const localLogKey = "jobs/local_job/outputs/output.log";
    const localFilePath = path.join(tmpDir, "local-staging", localLogKey);
    fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
    fs.writeFileSync(localFilePath, "Line 1\nLine 2\n");

    const lChunk1 = await localStager.readLogChunk(localLogKey, 0);
    assert.ok(lChunk1 !== null);
    assert.strictEqual(lChunk1.chunk, "Line 1\nLine 2\n");

    fs.appendFileSync(localFilePath, "Line 3\n");
    const lChunk2 = await localStager.readLogChunk(localLogKey, lChunk1.totalBytes);
    assert.ok(lChunk2 !== null);
    assert.strictEqual(lChunk2.chunk, "Line 3\n");
  });
});
