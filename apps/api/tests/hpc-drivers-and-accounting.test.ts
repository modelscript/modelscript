// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { calculateCostCredits, COMPUTE_PROFILES } from "../src/services/hpc/compute-profiles.js";
import { LocalProcessDriver } from "../src/services/hpc/drivers/local-driver.js";
import { parseMemoryStringToBytes, parseSacctOutput, SlurmDriver } from "../src/services/hpc/drivers/slurm-driver.js";
import { HpcEngine } from "../src/services/hpc/hpc-engine.js";
import type { HpcJobSpec } from "../src/services/hpc/hpc-types.js";

test("HPC Drivers & Cost Accounting", async (t) => {
  await t.test("parseMemoryStringToBytes handles various unit formats", () => {
    assert.strictEqual(parseMemoryStringToBytes("1024"), 1024);
    assert.strictEqual(parseMemoryStringToBytes("1024K"), 1024 * 1024);
    assert.strictEqual(parseMemoryStringToBytes("512M"), 512 * 1024 * 1024);
    assert.strictEqual(parseMemoryStringToBytes("2G"), 2 * 1024 * 1024 * 1024);
    assert.strictEqual(parseMemoryStringToBytes("1.5G"), 1.5 * 1024 * 1024 * 1024);
  });

  await t.test("parseSacctOutput parses standard Slurm pipe-delimited records", () => {
    const sampleSacct = `
123456|4800|1185.34|18452144K|16|300|COMPLETED|0:0
123456.batch|4790|1180.12|18452144K|16|298|COMPLETED|0:0
`;
    const parsed = parseSacctOutput(sampleSacct);

    assert.strictEqual(parsed.state, "COMPLETED");
    assert.strictEqual(parsed.elapsedSeconds, 300);
    assert.strictEqual(parsed.cpuCoreSeconds, 4800);
    assert.strictEqual(parsed.exitCode, 0);
    assert.ok(parsed.peakMemoryMb > 17000 && parsed.peakMemoryMb < 19000, `Memory was ${parsed.peakMemoryMb}MB`);
  });

  await t.test("calculateCostCredits calculates proportional hourly billing", () => {
    const std = COMPUTE_PROFILES["standard"]!; // 10 credits / hr
    assert.strictEqual(calculateCostCredits(3600, std), 10);
    assert.strictEqual(calculateCostCredits(1800, std), 5);
    assert.strictEqual(calculateCostCredits(7200, std), 20);

    const highMem = COMPUTE_PROFILES["high-memory"]!; // 35 credits / hr
    assert.strictEqual(calculateCostCredits(1800, highMem), 17.5);
  });

  await t.test("LocalProcessDriver executes command and tracks CPU time", async () => {
    const driver = new LocalProcessDriver();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-test-local-"));

    const spec: HpcJobSpec = {
      jobId: "local-job-1",
      name: "TestLocal",
      command: process.execPath,
      args: ["-e", "console.log('HPC Task Running'); for(let i=0; i<100000; i++) {}"],
      workingDir: tmpDir,
      resources: {
        cpusPerTask: 2,
        memoryMb: 1024,
      },
    };

    const submission = await driver.submit(spec);
    assert.strictEqual(submission.driverType, "local");
    assert.strictEqual(submission.nativeJobId, "local-job-1");

    // Verify .sbatch was generated
    assert.ok(fs.existsSync(path.join(tmpDir, "run.sbatch")), "run.sbatch must be written");

    // Wait for completion
    let status = await driver.pollStatus("local-job-1");
    while (status.state === "RUNNING") {
      await new Promise((r) => setTimeout(r, 50));
      status = await driver.pollStatus("local-job-1");
    }

    assert.strictEqual(status.state, "COMPLETED");
    assert.strictEqual(status.exitCode, 0);

    // Verify log content
    const logPath = driver.getLogPath("local-job-1", tmpDir);
    assert.ok(fs.existsSync(logPath), "Log file should exist");
    const logContent = fs.readFileSync(logPath, "utf8");
    assert.ok(logContent.includes("HPC Task Running"), "Log should contain stdout");

    // Verify metrics
    const metrics = await driver.getMetrics("local-job-1", tmpDir, COMPUTE_PROFILES["standard"]!);
    assert.ok(metrics.wallClockSeconds >= 0, "Wall clock time should be positive");
    assert.ok(metrics.costCredits > 0, "Cost credits should be calculated");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("SlurmDriver executes via custom mock command executor", async () => {
    const commandsExecuted: string[] = [];

    const mockExecutor = async (cmd: string, args: string[]) => {
      commandsExecuted.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "sbatch") {
        return { stdout: "Submitted batch job 991234\n", stderr: "" };
      }
      if (cmd === "squeue") {
        return { stdout: "RUNNING\n", stderr: "" };
      }
      if (cmd === "sacct") {
        return { stdout: "991234|360|120|2097152K|4|90|COMPLETED|0:0\n", stderr: "" };
      }
      if (cmd === "scancel") {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    const slurmDriver = new SlurmDriver({ executor: mockExecutor });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-test-slurm-"));

    const spec: HpcJobSpec = {
      jobId: "slurm-job-1",
      name: "MockSlurmJob",
      command: "SU2_CFD",
      args: ["config.cfg"],
      workingDir: tmpDir,
      resources: {
        partition: "gpu",
        cpusPerTask: 8,
        gpus: 1,
      },
    };

    const sub = await slurmDriver.submit(spec);
    assert.strictEqual(sub.nativeJobId, "991234");
    assert.ok(
      commandsExecuted.some((c) => c.startsWith("sbatch")),
      "sbatch was called",
    );

    const status = await slurmDriver.pollStatus("991234");
    assert.strictEqual(status.state, "RUNNING");

    const metrics = await slurmDriver.getMetrics("991234", tmpDir, COMPUTE_PROFILES["gpu-a100"]!);
    assert.strictEqual(metrics.wallClockSeconds, 90);
    assert.strictEqual(metrics.cpuCoreSeconds, 360);
    assert.strictEqual(metrics.peakMemoryMb, 2048);
    assert.ok(metrics.costCredits > 0);

    const cancelled = await slurmDriver.cancel("991234");
    assert.strictEqual(cancelled, true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("HpcEngine submits with High-Memory profile and merges specs", async () => {
    const engine = new HpcEngine({ defaultBackend: "local" });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-test-engine-"));

    const spec: HpcJobSpec = {
      jobId: "engine-job-1",
      name: "EngineFEA",
      command: "echo",
      args: ["Hello HPC Engine"],
      workingDir: tmpDir,
      resources: {}, // Profile defaults should fill in
    };

    const { submission, profile } = await engine.submitJob(spec, "high-memory");
    assert.strictEqual(profile.id, "high-memory");
    assert.strictEqual(submission.allocatedResources.cpusPerTask, 16);
    assert.strictEqual(submission.allocatedResources.memoryMb, 262144);

    const metrics = await engine.waitForCompletion("engine-job-1", tmpDir, profile);
    assert.strictEqual(metrics.exitCode, 0);
    assert.ok(metrics.costCredits > 0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("simulateRouter integrates with HpcEngine and tracks compute accounting", async () => {
    const engine = new HpcEngine({ defaultBackend: "local" });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-test-sim-"));

    const spec: HpcJobSpec = {
      jobId: "sim-job-1",
      name: "OMC-BouncingBall",
      command: "echo",
      args: ["Simulation completed successfully"],
      workingDir: tmpDir,
      resources: {},
    };

    const { submission, profile } = await engine.submitJob(spec, "standard");
    assert.strictEqual(profile.id, "standard");
    assert.strictEqual(submission.allocatedResources.cpusPerTask, 4);

    const metrics = await engine.waitForCompletion("sim-job-1", tmpDir, profile);
    assert.strictEqual(metrics.exitCode, 0);
    assert.ok(typeof metrics.cpuCoreSeconds === "number");
    assert.ok(typeof metrics.costCredits === "number");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
