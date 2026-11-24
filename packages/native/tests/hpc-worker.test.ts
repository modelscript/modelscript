// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(PKG_ROOT, "build");

function findWorkerBinary(): string | null {
  const exeName = process.platform === "win32" ? "msx-hpc-worker.exe" : "msx-hpc-worker";
  const candidates = [
    path.join(BUILD_DIR, exeName),
    path.join(BUILD_DIR, "Release", exeName),
    path.join(BUILD_DIR, "Debug", exeName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

describe("msx-hpc-worker standalone CLI", () => {
  const workerBin = findWorkerBinary();

  it("prints version string via --version", () => {
    if (!workerBin) {
      console.log("[hpc-worker] msx-hpc-worker binary not built; skipping.");
      return;
    }
    const out = execFileSync(workerBin, ["--version"], { encoding: "utf8" });
    assert.match(out, /msx-hpc-worker\s+\d+\.\d+\.\d+\s+\(wasm2c-native\)/);
  });

  it("prints structured capability JSON via --info", () => {
    if (!workerBin) return;
    const out = execFileSync(workerBin, ["--info"], { encoding: "utf8" });
    const info = JSON.parse(out) as Record<string, unknown>;
    assert.equal(info["worker"], "msx-hpc-worker");
    assert.equal(info["cpuBackend"], "wasm2c-native");
    assert.equal(typeof info["dawnCompiled"], "boolean");
    assert.equal(typeof info["cudaCompiled"], "boolean");
    assert.equal(typeof info["hipCompiled"], "boolean");
    assert.equal(typeof info["hardwareFp64"], "boolean");
    assert.equal(typeof info["gpuBackend"], "string");
  });

  it("passes native wasm2c --selftest", () => {
    if (!workerBin) return;
    const out = execFileSync(workerBin, ["--selftest"], { encoding: "utf8" });
    assert.match(out, /msx-hpc-worker selftest PASSED/);
  });

  it("executes --run <job.json> mesh_box task and writes structured JSON to stdout", () => {
    if (!workerBin) return;
    const jobPath = path.join(BUILD_DIR, "test-job-mesh-box-stdout.json");
    try {
      fs.writeFileSync(
        jobPath,
        JSON.stringify({
          task: "mesh_box",
          nx: 4,
          ny: 3,
          nz: 2,
          dx: 2.0,
          dy: 1.5,
          dz: 1.0,
        }),
        "utf8",
      );

      const out = execFileSync(workerBin, ["--run", jobPath], { encoding: "utf8" });
      const res = JSON.parse(out) as Record<string, unknown>;
      assert.equal(res["status"], "ok");
      assert.equal(res["task"], "mesh_box");
      assert.equal(res["backend"], "wasm2c-native");
      assert.equal(res["numNodes"], 5 * 4 * 3);
      assert.equal(res["numTets"], 4 * 3 * 2 * 6);
      assert.equal(typeof res["elapsedUs"], "number");
      assert.ok((res["elapsedUs"] as number) >= 0);
      assert.equal(typeof res["gpuBackend"], "string");
      assert.equal(typeof res["hardwareFp64"], "boolean");
    } finally {
      if (fs.existsSync(jobPath)) fs.unlinkSync(jobPath);
    }
  });

  it("executes --run <job.json> --out <result.json> and writes JSON result to file", () => {
    if (!workerBin) return;
    const jobPath = path.join(BUILD_DIR, "test-job-mesh-box-out.json");
    const outPath = path.join(BUILD_DIR, "test-result-mesh-box-out.json");
    try {
      fs.writeFileSync(
        jobPath,
        JSON.stringify({
          task: "mesh_box",
          nx: 3,
          ny: 3,
          nz: 3,
          dx: 1.0,
          dy: 1.0,
          dz: 1.0,
        }),
        "utf8",
      );

      const stdout = execFileSync(workerBin, ["--run", jobPath, "--out", outPath], {
        encoding: "utf8",
      });
      assert.equal(stdout.trim(), "");
      assert.ok(fs.existsSync(outPath));

      const res = JSON.parse(fs.readFileSync(outPath, "utf8")) as Record<string, unknown>;
      assert.equal(res["status"], "ok");
      assert.equal(res["task"], "mesh_box");
      assert.equal(res["backend"], "wasm2c-native");
      assert.equal(res["numNodes"], 64);
      assert.equal(res["numTets"], 162);
      assert.equal(typeof res["elapsedUs"], "number");
      assert.ok((res["elapsedUs"] as number) >= 0);
      assert.equal(typeof res["gpuBackend"], "string");
      assert.equal(typeof res["hardwareFp64"], "boolean");
    } finally {
      if (fs.existsSync(jobPath)) fs.unlinkSync(jobPath);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  });

  it("executes --run <job.json> for selftest and gpu_probe tasks", () => {
    if (!workerBin) return;
    const selftestJob = path.join(BUILD_DIR, "test-job-selftest.json");
    const gpuProbeJob = path.join(BUILD_DIR, "test-job-gpu-probe.json");
    try {
      fs.writeFileSync(selftestJob, JSON.stringify({ task: "selftest" }), "utf8");
      const selftestOut = execFileSync(workerBin, ["--run", selftestJob], { encoding: "utf8" });
      const selftestRes = JSON.parse(selftestOut) as Record<string, unknown>;
      assert.equal(selftestRes["status"], "ok");
      assert.equal(selftestRes["task"], "selftest");
      assert.equal(selftestRes["backend"], "wasm2c-native");
      assert.equal(selftestRes["numTets"], 48);
      assert.equal(typeof selftestRes["elapsedUs"], "number");

      fs.writeFileSync(gpuProbeJob, JSON.stringify({ task: "gpu_probe" }), "utf8");
      const gpuOut = execFileSync(workerBin, ["--run", gpuProbeJob], { encoding: "utf8" });
      const gpuRes = JSON.parse(gpuOut) as Record<string, unknown>;
      assert.equal(gpuRes["status"], "ok");
      assert.equal(gpuRes["task"], "gpu_probe");
      assert.equal(gpuRes["backend"], "wasm2c-native");
      assert.equal(typeof gpuRes["gpuBackend"], "string");
      assert.equal(typeof gpuRes["hardwareFp64"], "boolean");
    } finally {
      if (fs.existsSync(selftestJob)) fs.unlinkSync(selftestJob);
      if (fs.existsSync(gpuProbeJob)) fs.unlinkSync(gpuProbeJob);
    }
  });

  it("executes --run <job.json> simulate_dae exponential decay with FP64 RK4 accuracy", () => {
    if (!workerBin) return;
    const jobPath = path.join(BUILD_DIR, "test-job-simulate-dae-decay.json");
    try {
      fs.writeFileSync(
        jobPath,
        JSON.stringify({
          task: "simulate_dae",
          t0: 0.0,
          tEnd: 1.0,
          dt: 0.001,
          decayRate: 2.0,
          y0: 1.0,
          sampleInterval: 100,
        }),
        "utf8",
      );

      const out = execFileSync(workerBin, ["--run", jobPath], { encoding: "utf8" });
      const res = JSON.parse(out) as Record<string, unknown>;
      assert.equal(res["status"], "ok");
      assert.equal(res["task"], "simulate_dae");
      assert.equal(res["model"], "decay");
      assert.equal(res["backend"], "cpu-fp64-rk4");
      assert.equal(res["steps"], 1000);
      assert.ok(Math.abs((res["finalTime"] as number) - 1.0) < 1e-12);

      const finalState = res["finalState"] as number[];
      assert.ok(Array.isArray(finalState));
      assert.equal(finalState.length, 1);
      assert.ok(Math.abs(finalState[0]! - Math.exp(-2)) < 1e-8, `expected |${finalState[0]} - ${Math.exp(-2)}| < 1e-8`);

      const samples = res["samples"] as Array<{ t: number; y: number[] }>;
      assert.ok(Array.isArray(samples));
      assert.equal(samples.length, 11);
      assert.equal(samples[0]!.t, 0);
      assert.equal(samples[0]!.y[0], 1);
      assert.ok(Math.abs(samples[samples.length - 1]!.t - 1.0) < 1e-12);
      assert.ok(Math.abs(samples[samples.length - 1]!.y[0]! - finalState[0]!) < 1e-15);

      assert.equal(typeof res["elapsedUs"], "number");
      assert.ok((res["elapsedUs"] as number) >= 0);
      assert.equal(typeof res["gpuBackend"], "string");
      assert.equal(typeof res["hardwareFp64"], "boolean");
    } finally {
      if (fs.existsSync(jobPath)) fs.unlinkSync(jobPath);
    }
  });

  it("executes --run <job.json> simulate_dae harmonic oscillator with FP64 RK4 accuracy", () => {
    if (!workerBin) return;
    const jobPath = path.join(BUILD_DIR, "test-job-simulate-dae-harmonic.json");
    try {
      fs.writeFileSync(
        jobPath,
        JSON.stringify({
          task: "simulate_dae",
          model: "harmonic",
          t0: 0.0,
          tEnd: 1.0,
          dt: 0.001,
          omega: 2.0,
          y0: 1.0,
          sampleInterval: 100,
        }),
        "utf8",
      );

      const out = execFileSync(workerBin, ["--run", jobPath], { encoding: "utf8" });
      const res = JSON.parse(out) as Record<string, unknown>;
      assert.equal(res["status"], "ok");
      assert.equal(res["task"], "simulate_dae");
      assert.equal(res["model"], "harmonic");
      assert.equal(res["backend"], "cpu-fp64-rk4");
      assert.equal(res["steps"], 1000);
      assert.ok(Math.abs((res["finalTime"] as number) - 1.0) < 1e-12);

      const finalState = res["finalState"] as number[];
      assert.ok(Array.isArray(finalState));
      assert.equal(finalState.length, 2);
      assert.ok(
        Math.abs(finalState[0]! - Math.cos(2.0)) < 1e-7,
        `expected |${finalState[0]} - ${Math.cos(2.0)}| < 1e-7`,
      );
      assert.ok(
        Math.abs(finalState[1]! - -2.0 * Math.sin(2.0)) < 1e-7,
        `expected |${finalState[1]} - ${-2.0 * Math.sin(2.0)}| < 1e-7`,
      );

      const samples = res["samples"] as Array<{ t: number; y: number[] }>;
      assert.ok(Array.isArray(samples));
      assert.equal(samples.length, 11);
      assert.equal(samples[0]!.t, 0);
      assert.deepEqual(samples[0]!.y, [1, 0]);
      assert.ok(Math.abs(samples[samples.length - 1]!.t - 1.0) < 1e-12);

      assert.equal(typeof res["elapsedUs"], "number");
      assert.ok((res["elapsedUs"] as number) >= 0);
      assert.equal(typeof res["gpuBackend"], "string");
      assert.equal(typeof res["hardwareFp64"], "boolean");
    } finally {
      if (fs.existsSync(jobPath)) fs.unlinkSync(jobPath);
    }
  });
});
