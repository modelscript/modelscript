// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import {
  eliminateArenaAliases,
  foldArenaConstants,
  initBltWasm,
  performBltTransformationArena,
} from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

interface BenchResult {
  scale: number;
  mode: "preserve" | "scalarize";
  varCount: number;
  eqCount: number;
  flattenMs: number;
  daeProcessMs: number;
  simMs: number;
  wasmMemMb: number;
  heapDeltaMb: number;
  rssMb: number;
}

async function runBenchmarkForScale(N: number, mode: "preserve" | "scalarize" = "preserve"): Promise<BenchResult> {
  // Force GC before start if available
  if (typeof global.gc === "function") {
    global.gc();
  }

  const initialHeap = process.memoryUsage().heapUsed;
  const initialRss = process.memoryUsage().rss;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mo-bench-${N}-`));
  const tempMoPath = path.join(tempDir, `ScaleModel_${N}.mo`);
  const modelContent = `model ScaleModel_${N}
  parameter Integer N = ${N};
  Real x[N](start = ones(N));
equation
  der(x) = -x;
end ScaleModel_${N};
`;
  fs.writeFileSync(tempMoPath, modelContent, "utf8");

  try {
    const context = Context.createBatch(new NodeFileSystem());
    await context.addLibrary(tempMoPath);

    // Stage 1: Flattening
    console.log(`  [N=${N.toLocaleString()}] Stage 1: Flattening...`);
    const t0 = performance.now();
    const dae = context.flattenArena(`ScaleModel_${N}`, undefined, undefined, {
      arrayMode: mode,
      backend: "hybrid",
    });
    const t1 = performance.now();
    const flattenMs = t1 - t0;
    console.log(`  [N=${N.toLocaleString()}] Flattening complete in ${(flattenMs / 1000).toFixed(2)}s`);

    const varCount = dae.varCount;
    const eqCount = dae.eqCount;

    // Stage 2: DAE Post-processing (Constant Folding, Alias Elimination, BLT)
    console.log(`  [N=${N.toLocaleString()}] Stage 2: DAE Post-processing (Folding, Alias, BLT)...`);
    const t2 = performance.now();
    foldArenaConstants(dae);
    eliminateArenaAliases(dae);
    performBltTransformationArena(dae);
    const t3 = performance.now();
    const daeProcessMs = t3 - t2;
    console.log(`  [N=${N.toLocaleString()}] DAE Post-processing complete in ${(daeProcessMs / 1000).toFixed(3)}s`);

    // Stage 3: Simulation (1 communication step to verify numerical integration)
    console.log(`  [N=${N.toLocaleString()}] Stage 3: Simulating 1 integration step...`);
    const t4 = performance.now();
    simulateArena(dae, {
      startTime: 0,
      stopTime: 0.05,
      numberOfIntervals: 1,
      solver: "euler",
    });
    const t5 = performance.now();
    const simMs = t5 - t4;
    console.log(`  [N=${N.toLocaleString()}] Simulation complete in ${(simMs / 1000).toFixed(2)}s`);

    const finalHeap = process.memoryUsage().heapUsed;
    const finalRss = process.memoryUsage().rss;
    const wasmMemBytes = (dae.exports?.memory?.buffer?.byteLength as number) ?? 0;

    return {
      scale: N,
      mode,
      varCount,
      eqCount,
      flattenMs,
      daeProcessMs,
      simMs,
      wasmMemMb: wasmMemBytes / (1024 * 1024),
      heapDeltaMb: Math.max(0, (finalHeap - initialHeap) / (1024 * 1024)),
      rssMb: finalRss / (1024 * 1024),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);
  await initBltWasm();

  console.log("==========================================================================================");
  console.log("ModelScript Scalability Benchmark: Flattening, DAE Processing, and Simulation (1k to 1M)");
  console.log("==========================================================================================");

  const scales = [1000, 10000, 100000, 1000000];
  const results: BenchResult[] = [];

  for (const N of scales) {
    console.log(`\n--- Running Benchmark for N = ${N.toLocaleString()} variables (mode: preserve) ---`);
    try {
      const res = await runBenchmarkForScale(N, "preserve");
      results.push(res);
      console.log(
        `Scale ${N.toLocaleString()}: Flatten = ${res.flattenMs.toFixed(1)}ms | ` +
          `DAE Process = ${res.daeProcessMs.toFixed(1)}ms | ` +
          `Simulate = ${res.simMs.toFixed(1)}ms | ` +
          `WASM Mem = ${res.wasmMemMb.toFixed(1)}MB | ` +
          `Heap Delta = ${res.heapDeltaMb.toFixed(1)}MB`,
      );
    } catch (err) {
      console.error(`Error at N = ${N}:`, err);
    }
  }

  console.log("\n\n==========================================================================================");
  console.log("SUMMARY BENCHMARK REPORT");
  console.log("==========================================================================================");
  console.log(
    "| Variables | Mode | Flatten Time | DAE Process Time | Simulation Time | Peak WASM Memory | JS Heap Delta |",
  );
  console.log("|:---:|:---:|:---:|:---:|:---:|:---:|:---:|");
  for (const r of results) {
    const fStr = r.flattenMs >= 1000 ? `${(r.flattenMs / 1000).toFixed(2)}s` : `${r.flattenMs.toFixed(1)}ms`;
    const dStr = r.daeProcessMs >= 1000 ? `${(r.daeProcessMs / 1000).toFixed(2)}s` : `${r.daeProcessMs.toFixed(1)}ms`;
    const sStr = r.simMs >= 1000 ? `${(r.simMs / 1000).toFixed(2)}s` : `${r.simMs.toFixed(1)}ms`;
    console.log(
      `| ${r.scale.toLocaleString()} | ${r.mode} | ${fStr} | ${dStr} | ${sStr} | ${r.wasmMemMb.toFixed(1)} MB | ${r.heapDeltaMb.toFixed(1)} MB |`,
    );
  }
}

main().catch(console.error);
