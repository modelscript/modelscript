// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import {
  eliminateArenaAliases,
  foldArenaConstants,
  initBltWasm,
  isolateSymbolicallyArena,
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

async function runBenchmark(N: number) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mo-bench-phase3-${N}-`));
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

    console.log(`\n=== Benchmarking Phase 3 In-WASM Batch Isolation for N = ${N.toLocaleString()} ===`);

    const dae = context.flattenArena(`ScaleModel_${N}`, undefined, undefined, {
      arrayMode: "scalarize",
      backend: "hybrid",
    });

    foldArenaConstants(dae);
    eliminateArenaAliases(dae);

    // Identify states and derivatives
    const stateVars = new Set<number>();
    const derVars = new Set<number>();
    for (let i = 0; i < dae.varCount; i++) {
      const vName = dae.getVarName(i);
      if (vName.startsWith("der(")) {
        derVars.add(i);
      } else if (vName.startsWith("x[")) {
        stateVars.add(i);
      }
    }

    const bltRes = performBltTransformationArena(dae, stateVars);
    const wasmExports = dae.exports as any;
    console.log(
      `  BLT blocks: ${bltRes.blocks.length.toLocaleString()}, Total equations: ${dae.eqCount.toLocaleString()}`,
    );

    // Collect 1x1 blocks
    const singleBlocks: { eqIdx: number; varIdx: number }[] = [];
    for (let b = 0; b < bltRes.blocks.length; b++) {
      const block = bltRes.blocks[b]!;
      if (block.eqIdxs.length === 1 && block.vars.length === 1) {
        singleBlocks.push({ eqIdx: block.eqIdxs[0]!, varIdx: block.vars[0]! });
      }
    }
    console.log(`  1x1 blocks count: ${singleBlocks.length.toLocaleString()}`);

    // Benchmark 1: In-WASM Batch Isolation
    const count = singleBlocks.length;
    const bytes = count * 4;
    const eqPtr = wasmExports.atomicChunkAlloc(bytes);
    const varPtr = wasmExports.atomicChunkAlloc(bytes);
    const outPtr = wasmExports.atomicChunkAlloc(bytes);

    const eqView = new Int32Array(wasmExports.memory.buffer, eqPtr, count);
    const varView = new Int32Array(wasmExports.memory.buffer, varPtr, count);
    for (let i = 0; i < count; i++) {
      eqView[i] = singleBlocks[i]!.eqIdx;
      varView[i] = singleBlocks[i]!.varIdx;
    }

    const tWasm0 = performance.now();
    wasmExports.dae_batchIsolate1x1Blocks(dae.ptr, eqPtr, varPtr, count, outPtr);
    const wasmIsoMs = performance.now() - tWasm0;

    const outView = new Int32Array(wasmExports.memory.buffer, outPtr, count);
    let wasmSuccessCount = 0;
    for (let i = 0; i < count; i++) {
      if (outView[i] !== -1 && outView[i] !== 0xffffffff) {
        wasmSuccessCount++;
      }
    }
    console.log(
      `  In-WASM Batch Isolation: ${wasmIsoMs.toFixed(2)}ms (solved: ${wasmSuccessCount.toLocaleString()} / ${count.toLocaleString()})`,
    );

    wasmExports.atomicChunkFree(eqPtr, bytes);
    wasmExports.atomicChunkFree(varPtr, bytes);
    wasmExports.atomicChunkFree(outPtr, bytes);

    // Benchmark 2: Legacy TypeScript loop isolateSymbolicallyArena
    const tTs0 = performance.now();
    let tsSuccessCount = 0;
    for (let i = 0; i < count; i++) {
      const res = isolateSymbolicallyArena(dae, singleBlocks[i]!.eqIdx, singleBlocks[i]!.varIdx);
      if (res !== -1) tsSuccessCount++;
    }
    const tsIsoMs = performance.now() - tTs0;
    console.log(
      `  Legacy TS Loop Isolation: ${tsIsoMs.toFixed(2)}ms (solved: ${tsSuccessCount.toLocaleString()} / ${count.toLocaleString()})`,
    );
    console.log(`  ⚡ Speedup: ${(tsIsoMs / Math.max(wasmIsoMs, 0.01)).toFixed(1)}x faster in WASM!`);

    // End-to-end simulation
    const tSim = performance.now();
    const simRes = simulateArena(dae, {
      startTime: 0,
      stopTime: 0.05,
      numberOfIntervals: 1,
      solver: "euler",
    });
    const simMs = performance.now() - tSim;
    console.log(`  End-to-end Simulation: ${simMs.toFixed(1)}ms`);

    const finalVal = simRes.y[simRes.y.length - 1]![0]!;
    console.log(`  Sample final state x[0](0.05) = ${finalVal.toFixed(4)} (expected 0.9500)`);
    if (Math.abs(finalVal - 0.95) > 1e-3) {
      throw new Error(`Numerical mismatch: expected 0.95, got ${finalVal}`);
    }
    console.log(`  ✔ Numerical accuracy verified!`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);
  await initBltWasm();

  console.log("==========================================================================");
  console.log("Phase 3 Verification: In-WASM Batch Symbolic Isolation vs Legacy TS Loop");
  console.log("==========================================================================");

  for (const N of [1000, 10000, 50000]) {
    await runBenchmark(N);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
