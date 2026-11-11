// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const benchDir = path.resolve(__dirname, ".bench_omc_work");

function runOmc(
  mosContent: string,
  timeoutMs = 90000,
): { durationMs: number; stdout: string; stderr: string; success: boolean; error?: string } {
  if (!fs.existsSync(benchDir)) fs.mkdirSync(benchDir, { recursive: true });
  const mosFile = path.join(benchDir, `script_${Date.now()}_${Math.random().toString(36).slice(2)}.mos`);
  fs.writeFileSync(mosFile, mosContent, "utf-8");

  const t0 = performance.now();
  const proc = spawnSync("omc", [mosFile], {
    cwd: benchDir,
    timeout: timeoutMs,
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const durationMs = performance.now() - t0;

  try {
    fs.unlinkSync(mosFile);
  } catch {}

  const stdout = proc.stdout || "";
  const stderr = proc.stderr || "";

  if (proc.error) {
    return { durationMs, stdout, stderr, success: false, error: proc.error.message };
  }

  const hasOmcError = stdout.includes("Error:") || stderr.includes("Error:");
  const success = proc.status === 0 && !hasOmcError;
  return { durationMs, stdout, stderr, success, error: success ? undefined : stderr || stdout.slice(0, 500) };
}

async function main() {
  const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  const wasmReleasePath = path.resolve("apps/ide/dist/extension/server/dist/release.wasm");
  await initBltWasm(wasmReleasePath);

  if (!fs.existsSync(benchDir)) fs.mkdirSync(benchDir, { recursive: true });

  console.log("=========================================================================================");
  console.log(" Head-to-Head Benchmark: ModelScript vs OpenModelica 1.27 (OMC)");
  console.log("=========================================================================================\n");

  // -------------------------------------------------------------------------------------
  // Test Suite 1: Banded 1D PDE (Tridiagonal State Coupling der(T[i]) = T[i-1] - 2*T[i] + T[i+1])
  // -------------------------------------------------------------------------------------
  console.log("--- ARCHETYPE 1: Banded 1D PDE (Coupled States) ---");
  console.log("Size (N)   | ModelScript Flat | OMC Flat     | ModelScript Sim (10s) | OMC Sim (10s)");
  console.log("-----------+------------------+--------------+-----------------------+---------------");

  for (const n of [1000, 10000, 25000, 50000]) {
    const moContent = `model CoupledPDE
  parameter Integer N = ${n};
  Real T[N](each start = 1.0);
equation
  der(T[1]) = -2.0 * T[1] + T[2];
  for i in 2:N-1 loop
    der(T[i]) = T[i-1] - 2.0 * T[i] + T[i+1];
  end for;
  der(T[N]) = T[N-1] - 2.0 * T[N];
end CoupledPDE;
`;
    const moPath = path.join(benchDir, `CoupledPDE_${n}.mo`);
    fs.writeFileSync(moPath, moContent, "utf-8");

    // ModelScript Flattening
    const ctx = new Context(new NodeFileSystem());
    const uri = `file://${moPath}`;
    ctx.load(moContent, uri);
    const msFlat0 = performance.now();
    const dae = ctx.flattenArena("CoupledPDE", undefined, uri, { arrayMode: "scalarize" });
    const msFlatMs = performance.now() - msFlat0;

    // ModelScript Simulation
    let msSimMs = 0;
    let msSimPass = false;
    try {
      const msSim0 = performance.now();
      const res = simulateArena(dae, { startTime: 0, stopTime: 0.1, stepSize: 0.01, method: "euler" });
      msSimMs = performance.now() - msSim0;
      msSimPass = !res.failed;
    } catch {}

    // OMC Flattening
    const omcFlatMos = `loadFile("${moPath.replace(/\\/g, "/")}");
res := instantiateModel(CoupledPDE);
err := getErrorString();
`;
    const omcFlatRes = runOmc(omcFlatMos, 90000);

    // OMC Simulation (C code generation + GCC compilation + Execution)
    const omcSimMos = `loadFile("${moPath.replace(/\\/g, "/")}");
simRes := simulate(CoupledPDE, startTime=0.0, stopTime=0.1, numberOfIntervals=10, method="euler", outputFormat="csv");
`;
    const omcSimRes = runOmc(omcSimMos, 90000);

    const msFlatStr = `${msFlatMs.toFixed(1)}ms`.padStart(16);
    const omcFlatStr = (
      omcFlatRes.success
        ? `${omcFlatRes.durationMs.toFixed(1)}ms`
        : omcFlatRes.error?.includes("TIMEDOUT")
          ? "TIMEOUT"
          : "ERROR"
    ).padStart(12);
    const msSimStr = (msSimPass ? `${msSimMs.toFixed(1)}ms` : "ERROR").padStart(21);
    const omcSimStr = (
      omcSimRes.success
        ? `${omcSimRes.durationMs.toFixed(1)}ms`
        : omcSimRes.error?.includes("TIMEDOUT")
          ? "TIMEOUT"
          : "FAILED"
    ).padStart(13);

    console.log(`${n.toLocaleString().padEnd(10)} | ${msFlatStr} | ${omcFlatStr} | ${msSimStr} | ${omcSimStr}`);
  }

  // -------------------------------------------------------------------------------------
  // Test Suite 2: Coupled Linear Algebraic Loop (Simultaneous Systems)
  // -------------------------------------------------------------------------------------
  console.log("\n--- ARCHETYPE 2: Coupled Algebraic Loop (Simultaneous Systems) ---");
  console.log("Size (N)   | ModelScript Flat | OMC Flat     | ModelScript Sim       | OMC Sim");
  console.log("-----------+------------------+--------------+-----------------------+---------------");

  for (const n of [100, 500, 1000]) {
    const moContent = `model CoupledAlgDAE
  parameter Integer N = ${n};
  Real x[N](each start = 1.0);
  Real y[N];
equation
  for i in 1:N loop
    der(x[i]) = -x[i] + y[i];
  end for;
  y[1] = 0.5 * x[1] + 0.2 * y[2];
  for i in 2:N-1 loop
    y[i] = 0.5 * x[i] + 0.2 * y[i-1] + 0.2 * y[i+1];
  end for;
  y[N] = 0.5 * x[N] + 0.2 * y[N-1];
end CoupledAlgDAE;
`;
    const moPath = path.join(benchDir, `CoupledAlgDAE_${n}.mo`);
    fs.writeFileSync(moPath, moContent, "utf-8");

    // ModelScript Flattening
    const ctx = new Context(new NodeFileSystem());
    const uri = `file://${moPath}`;
    ctx.load(moContent, uri);
    const msFlat0 = performance.now();
    const dae = ctx.flattenArena("CoupledAlgDAE", undefined, uri, { arrayMode: "scalarize" });
    const msFlatMs = performance.now() - msFlat0;

    // ModelScript Simulation
    let msSimMs = 0;
    let msSimPass = false;
    try {
      const msSim0 = performance.now();
      const res = simulateArena(dae, { startTime: 0, stopTime: 0.1, stepSize: 0.01, method: "euler" });
      msSimMs = performance.now() - msSim0;
      msSimPass = !res.failed;
    } catch {}

    // OMC Flattening
    const omcFlatMos = `loadFile("${moPath.replace(/\\/g, "/")}");
res := instantiateModel(CoupledAlgDAE);
err := getErrorString();
`;
    const omcFlatRes = runOmc(omcFlatMos, 90000);

    // OMC Simulation
    const omcSimMos = `loadFile("${moPath.replace(/\\/g, "/")}");
simRes := simulate(CoupledAlgDAE, startTime=0.0, stopTime=0.1, numberOfIntervals=10, method="euler", outputFormat="csv");
`;
    const omcSimRes = runOmc(omcSimMos, 90000);

    const msFlatStr = `${msFlatMs.toFixed(1)}ms`.padStart(16);
    const omcFlatStr = (
      omcFlatRes.success
        ? `${omcFlatRes.durationMs.toFixed(1)}ms`
        : omcFlatRes.error?.includes("TIMEDOUT")
          ? "TIMEOUT"
          : "ERROR"
    ).padStart(12);
    const msSimStr = (msSimPass ? `${msSimMs.toFixed(1)}ms` : "ERROR").padStart(21);
    const omcSimStr = (
      omcSimRes.success
        ? `${omcSimRes.durationMs.toFixed(1)}ms`
        : omcSimRes.error?.includes("TIMEDOUT")
          ? "TIMEOUT"
          : "FAILED"
    ).padStart(13);

    console.log(`${n.toLocaleString().padEnd(10)} | ${msFlatStr} | ${omcFlatStr} | ${msSimStr} | ${omcSimStr}`);
  }

  // Cleanup
  try {
    fs.rmSync(benchDir, { recursive: true, force: true });
  } catch {}

  console.log("\n=========================================================================================");
}

main().catch(console.error);
