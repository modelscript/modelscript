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
import { getComputeProfile } from "../src/services/hpc/compute-profiles.js";
import { SlurmRestDriver } from "../src/services/hpc/drivers/slurm-rest-driver.js";
import { HpcEngine } from "../src/services/hpc/hpc-engine.js";
import type { HpcJobSpec } from "../src/services/hpc/hpc-types.js";
import { generateSbatchScript } from "../src/services/hpc/sbatch-generator.js";
import { LocalFsObjectStager } from "../src/services/hpc/staging/local-stager.js";
import { S3ObjectStager } from "../src/services/hpc/staging/s3-stager.js";

test("Slurm REST Driver & S3/MinIO Object Staging Pipeline", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-slurm-rest-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. S3 Object Stager & SigV4 Verification ────────────────────────
  await t.test("S3ObjectStager generates valid SigV4 presigned URLs and handles transfers", async () => {
    // In-memory S3 mock storage
    const inMemoryS3 = new Map<string, { body: Buffer; contentType: string }>();

    const mockS3Fetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as any).url;
      const parsed = new URL(urlStr);
      const cleanPath = decodeURIComponent(parsed.pathname).replace(/^\/+modelscript-hpc-artifacts\/+/, "");
      const method = (init?.method || "GET").toUpperCase();

      // Check for SigV4 query params
      assert.strictEqual(parsed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
      assert.ok(parsed.searchParams.get("X-Amz-Credential")?.includes("AKIAIOSFODNN7EXAMPLE"));
      assert.ok(parsed.searchParams.get("X-Amz-Signature"));

      if (method === "PUT") {
        const bodyBuf = Buffer.isBuffer(init?.body) ? init.body : Buffer.from((init?.body as any) || "");
        inMemoryS3.set(cleanPath, { body: bodyBuf, contentType: (init?.headers as any)?.["Content-Type"] || "" });
        return new Response(null, { status: 200 });
      }

      if (method === "GET") {
        const item = inMemoryS3.get(cleanPath);
        if (!item) return new Response("Not Found", { status: 404 });
        return new Response(item.body, { status: 200, headers: { "Content-Type": item.contentType } });
      }

      if (method === "HEAD") {
        const exists = inMemoryS3.has(cleanPath);
        return new Response(null, { status: exists ? 200 : 404 });
      }

      return new Response("Method Not Allowed", { status: 405 });
    };

    const stager = new S3ObjectStager({
      endpoint: "http://localhost:9000",
      bucket: "modelscript-hpc-artifacts",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      fetchFn: mockS3Fetch,
    });

    // Test presigned URL generation
    const getUrl = await stager.getDownloadUrl("jobs/42/deck.inp", 3600);
    assert.ok(getUrl.includes("X-Amz-Signature="));
    assert.ok(getUrl.includes("modelscript-hpc-artifacts/jobs/42/deck.inp"));

    // Test upload and download roundtrip
    const testContent = Buffer.from("MESH_DIMENSION = 3\nBOUNDARY = WALL", "utf8");
    await stager.uploadFile("jobs/42/deck.inp", testContent, "text/plain");

    assert.strictEqual(await stager.hasObject("jobs/42/deck.inp"), true);
    assert.strictEqual(await stager.hasObject("jobs/42/nonexistent.txt"), false);

    const downloadDest = path.join(tmpDir, "downloaded_deck.inp");
    await stager.downloadFile("jobs/42/deck.inp", downloadDest);
    assert.strictEqual(fs.readFileSync(downloadDest, "utf8"), testContent.toString("utf8"));

    // Test staging manifest generation
    const dummyMesh = path.join(tmpDir, "wing.su2");
    fs.writeFileSync(dummyMesh, "SU2 MESH DATA", "utf8");

    const manifest = await stager.createJobStagingManifest("job-42", { "wing.su2": dummyMesh }, [
      "result.vtu",
      "scalars.json",
    ]);

    assert.strictEqual(manifest.jobId, "job-42");
    assert.strictEqual(manifest.inputDownloads.length, 1);
    assert.strictEqual(manifest.inputDownloads[0]!.localFilename, "wing.su2");
    assert.strictEqual(manifest.outputUploads.length, 2);
    assert.ok(manifest.prologueScript.includes('curl -s -f -o "wing.su2"'));
    assert.ok(manifest.epilogueScript.includes('curl -s -f -X PUT --data-binary @"result.vtu"'));
  });

  // ── 2. Local File Stager ─────────────────────────────────────────────
  await t.test("LocalFsObjectStager stages and retrieves files locally", async () => {
    const localStagerRoot = path.join(tmpDir, "local-staging");
    const stager = new LocalFsObjectStager(localStagerRoot);

    const testFile = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(testFile, "Hello Local HPC", "utf8");

    await stager.uploadFile("jobs/101/inputs/sample.txt", testFile);
    assert.strictEqual(await stager.hasObject("jobs/101/inputs/sample.txt"), true);

    const dest = path.join(tmpDir, "out_sample.txt");
    await stager.downloadFile("jobs/101/inputs/sample.txt", dest);
    assert.strictEqual(fs.readFileSync(dest, "utf8"), "Hello Local HPC");
  });

  // ── 3. Sbatch Generator with Remote Staging ──────────────────────────
  await t.test("generateSbatchScript includes prologue and epilogue scripts", () => {
    const spec: HpcJobSpec = {
      jobId: "job-99",
      name: "Remote-SU2-Test",
      command: "/opt/su2/bin/SU2_CFD",
      args: ["config.cfg"],
      workingDir: "/scratch/job-99",
      resources: {
        cpusPerTask: 16,
        memoryMb: 32768,
        partition: "high-memory",
      },
    };

    const manifest = {
      jobId: "job-99",
      inputDownloads: [],
      outputUploads: [],
      prologueScript: 'curl -s -f -o "config.cfg" "https://s3.test/config.cfg"',
      epilogueScript: 'curl -s -f -X PUT --data-binary @"result.vtu" "https://s3.test/result.vtu"',
    };

    const sbatch = generateSbatchScript(spec, manifest);
    assert.ok(sbatch.includes("#SBATCH --job-name=Remote-SU2-Test"));
    assert.ok(sbatch.includes("#SBATCH --cpus-per-task=16"));
    assert.ok(sbatch.includes('curl -s -f -o "config.cfg" "https://s3.test/config.cfg"'));
    assert.ok(sbatch.includes("/opt/su2/bin/SU2_CFD config.cfg"));
    assert.ok(sbatch.includes("CMD_EXIT=$?"));
    assert.ok(sbatch.includes('curl -s -f -X PUT --data-binary @"result.vtu"'));
    assert.ok(sbatch.includes("exit $CMD_EXIT"));
  });

  // ── 4. SlurmRestDriver OpenAPI Mock & Operations ─────────────────────
  await t.test("SlurmRestDriver coordinates submit, poll, metrics, and diagnostics over REST", async () => {
    let mockJobState = "RUNNING";

    const mockSlurmRestFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as any).url;
      const parsed = new URL(urlStr);
      const method = (init?.method || "GET").toUpperCase();

      // Check JWT header
      const headers = (init?.headers as any) || {};
      assert.strictEqual(headers["X-SLURM-USER-TOKEN"], "test-jwt-token-12345");
      assert.strictEqual(headers["X-SLURM-USER-NAME"], "slurm");

      if (parsed.pathname.endsWith("/job/submit") && method === "POST") {
        const body = JSON.parse((init?.body as string) || "{}");
        assert.ok(body.script.includes("#SBATCH"));
        assert.strictEqual(body.job.name, "Aero-Wing");
        return new Response(JSON.stringify({ job_id: 84920 }), { status: 200 });
      }

      if (parsed.pathname.endsWith("/job/84920") && method === "GET") {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                job_id: 84920,
                job_state: [mockJobState],
                exit_code: { return_code: 0 },
                time: { elapsed: 48, total_cpu: 768 },
                memory: { max_rss: 4194304 * 1024 }, // 4096 MB in bytes
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (parsed.pathname.endsWith("/job/84920") && method === "DELETE") {
        mockJobState = "CANCELLED";
        return new Response(null, { status: 200 });
      }

      if (parsed.pathname.endsWith("/ping") && method === "GET") {
        return new Response(
          JSON.stringify({
            meta: { slurm: { version: "23.11.4" } },
          }),
          { status: 200 },
        );
      }

      if (parsed.pathname.endsWith("/partitions") && method === "GET") {
        return new Response(
          JSON.stringify({
            partitions: [
              {
                name: "standard",
                state: "UP",
                nodes: { total: 16 },
                cpus: { total: 128 },
                maximum_time: { minutes: 1440 },
              },
              {
                name: "high-memory",
                state: "UP",
                nodes: { total: 4 },
                cpus: { total: 64 },
                maximum_time: { minutes: 2880 },
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (parsed.pathname.endsWith("/nodes") && method === "GET") {
        return new Response(
          JSON.stringify({
            nodes: [
              { name: "node01", state: ["IDLE"], cpus: 16, real_memory: 65536, partitions: ["standard"] },
              { name: "node02", state: ["ALLOCATED"], cpus: 16, real_memory: 65536, partitions: ["standard"] },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const driver = new SlurmRestDriver({
      baseUrl: "https://slurm.cluster.internal",
      jwtToken: "test-jwt-token-12345",
      username: "slurm",
      fetchFn: mockSlurmRestFetch,
    });

    // 1. Submit
    const spec: HpcJobSpec = {
      jobId: "job-84920",
      name: "Aero-Wing",
      command: "su2",
      args: ["config.cfg"],
      workingDir: "/scratch/job-84920",
      resources: { cpusPerTask: 16, partition: "high-memory" },
    };

    const subResult = await driver.submit(spec);
    assert.strictEqual(subResult.nativeJobId, "84920");
    assert.strictEqual(subResult.driverType, "slurm-rest");

    // 2. Poll Status (RUNNING)
    const status1 = await driver.pollStatus("84920");
    assert.strictEqual(status1.state, "RUNNING");

    // 3. Metrics (COMPLETED)
    mockJobState = "COMPLETED";
    const profile = getComputeProfile("high-memory");
    const metrics = await driver.getMetrics("84920", "/scratch/job-84920", profile);
    assert.strictEqual(metrics.wallClockSeconds, 48);
    assert.strictEqual(metrics.cpuCoreSeconds, 768);
    assert.ok(metrics.costCredits > 0);

    // 4. Cancel
    const cancelRes = await driver.cancel("84920");
    assert.strictEqual(cancelRes, true);
    assert.strictEqual(mockJobState, "CANCELLED");

    // 5. Diagnostics
    const ping = await driver.ping();
    assert.strictEqual(ping.ok, true);
    assert.strictEqual(ping.version, "23.11.4");

    const partitions = await driver.getPartitions();
    assert.strictEqual(partitions.length, 2);
    assert.strictEqual(partitions[0]!.name, "standard");
    assert.strictEqual(partitions[0]!.totalNodes, 16);

    const nodes = await driver.getNodes();
    assert.strictEqual(nodes.length, 2);
    assert.strictEqual(nodes[0]!.name, "node01");
    assert.strictEqual(nodes[0]!.state, "IDLE");
  });

  // ── 5. HpcEngine with SlurmRestDriver & Stager ────────────────────────
  await t.test("HpcEngine submits with SlurmRestDriver and stages assets", async () => {
    let submittedSpec: HpcJobSpec | null = null;

    const mockDriver = new SlurmRestDriver({
      baseUrl: "https://mock.slurm",
      jwtToken: "dummy",
      fetchFn: async (input, init) => {
        if (init?.method === "POST") {
          submittedSpec = JSON.parse(init.body as string);
          return new Response(JSON.stringify({ job_id: 99001 }), { status: 200 });
        }
        return new Response(JSON.stringify({ jobs: [{ job_state: ["COMPLETED"], exit_code: 0 }] }), { status: 200 });
      },
    });

    const localStager = new LocalFsObjectStager(path.join(tmpDir, "engine-staging"));
    const engine = new HpcEngine({ driver: mockDriver, stager: localStager });

    const jobWorkDir = path.join(tmpDir, "engine_job_run");
    fs.mkdirSync(jobWorkDir, { recursive: true });
    fs.writeFileSync(path.join(jobWorkDir, "mesh.dat"), "MESH DATA", "utf8");

    const { submission, profile } = await engine.submitJob(
      {
        jobId: "eng-1",
        name: "Engine-Test",
        command: "run-solver",
        args: [],
        workingDir: jobWorkDir,
        resources: {},
      },
      "standard",
    );

    assert.strictEqual(submission.nativeJobId, "99001");
    assert.strictEqual(profile.id, "standard");
    assert.ok(submittedSpec !== null);
  });

  // ── 6. GET /api/v1/cae/cluster/status REST Endpoint ──────────────────
  await t.test("GET /api/v1/cae/cluster/status returns cluster connectivity and diagnostics", async () => {
    const res = await request(app).get("/api/v1/cae/cluster/status").expect(200);

    assert.ok(res.body.backend);
    assert.strictEqual(typeof res.body.connected, "boolean");
    assert.ok(res.body.stagingBackend);
    assert.ok(Array.isArray(res.body.partitions));
    assert.strictEqual(typeof res.body.nodesCount, "number");
  });
});
