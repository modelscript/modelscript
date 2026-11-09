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

async function runBenchmark(N: number) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mo-bench-phase2-${N}-`));
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

    console.log(`\n=== Benchmarking Scalarized Model for N = ${N.toLocaleString()} ===`);

    const t0 = performance.now();
    const dae = context.flattenArena(`ScaleModel_${N}`, undefined, undefined, {
      arrayMode: "scalarize",
      backend: "hybrid",
    });
    const flattenMs = performance.now() - t0;
    console.log(
      `  Flattening (scalarized): ${flattenMs.toFixed(1)}ms (vars=${dae.varCount.toLocaleString()}, eqs=${dae.eqCount.toLocaleString()})`,
    );

    const t2 = performance.now();
    foldArenaConstants(dae);
    eliminateArenaAliases(dae);
    performBltTransformationArena(dae);
    const daeProcessMs = performance.now() - t2;
    console.log(`  DAE Post-processing: ${daeProcessMs.toFixed(1)}ms`);

    const t4 = performance.now();
    const simRes = simulateArena(dae, {
      startTime: 0,
      stopTime: 0.05,
      numberOfIntervals: 1,
      solver: "euler",
    });
    const simMs = performance.now() - t4;
    console.log(`  Simulation (In-WASM Bytecode): ${simMs.toFixed(1)}ms`);

    // Verify numerical accuracy: x(0.05) ≈ 1 - 0.05 = 0.95
    const finalVal = simRes.y[simRes.y.length - 1]![0]!;
    console.log(`  Sample final state value x[0](0.05) = ${finalVal.toFixed(4)} (expected 0.9500)`);
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
  console.log("Phase 2 Verification: In-WASM Linear Bytecode Execution on Scalarized Models");
  console.log("==========================================================================");

  for (const N of [1000, 10000, 50000]) {
    await runBenchmark(N);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
