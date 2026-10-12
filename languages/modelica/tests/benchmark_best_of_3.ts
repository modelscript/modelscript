// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Context, computeEditRanges } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

function generateHeatConduction1D(n: number): string {
  let code = `model HeatConduction1D_${n}\n`;
  code += `  parameter Integer N = ${n};\n`;
  code += `  parameter Real L = 1.0;\n`;
  code += `  parameter Real dx = L / N;\n`;
  code += `  parameter Real alpha = 1e-4;\n\n`;
  code += `  Real T[N] (start=zeros(N));\n\n`;
  code += `equation\n`;
  code += `  der(T[1]) = alpha * (100.0 - 2.0*T[1] + T[2]) / (dx^2);\n`;
  for (let i = 2; i <= n - 1; i++) {
    code += `  der(T[${i}]) = alpha * (T[${i - 1}] - 2.0*T[${i}] + T[${i + 1}]) / (dx^2);\n`;
  }
  if (n > 1) {
    code += `  der(T[${n}]) = 2.0 * alpha * (T[${n - 1}] - T[${n}]) / (dx^2);\n`;
  }
  code += `end HeatConduction1D_${n};`;
  return code;
}

interface ConditionTiming {
  name: string;
  totalMs: number;
  diags: number;
}

async function runSinglePass(N: number): Promise<ConditionTiming[]> {
  const baseSrc = generateHeatConduction1D(N);
  const uri = `file:///benchmark/HeatConduction1D_${N}.mo`;

  const results: ConditionTiming[] = [];

  const runCondition = async (name: string, mutator?: (src: string) => string): Promise<ConditionTiming> => {
    const { parser, facade } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    if (mutator) {
      ctx.load(baseSrc, uri);
      ctx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);
    }

    const src = mutator ? mutator(baseSrc) : baseSrc;
    const editRanges = mutator ? computeEditRanges(baseSrc, src) : [];
    const t0 = performance.now();
    ctx.load(src, uri);
    const diags = await ctx.queryEngine.runAllLintsAsync(uri);

    const tree = ctx.getTree(uri);
    const rootPtr = tree ? ((tree.rootNode as any).id ?? (tree.rootNode as any).ptr ?? (tree as any).rootPtr ?? 0) : 0;
    let cstDiags: any[] = [];
    if (rootPtr && facade) {
      if (editRanges.length > 0) {
        const editStart = editRanges[0].startByte;
        const editNewEnd = editRanges[editRanges.length - 1].endByte;
        cstDiags = (facade as any).getDiagnostics(rootPtr, editStart, editNewEnd);
      } else {
        cstDiags = (facade as any).getDiagnostics(rootPtr);
      }
    }

    try {
      ctx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);
    } catch {
      /* ignore */
    }
    const tEnd = performance.now();

    if (typeof (parser as any).reset === "function") {
      (parser as any).reset();
    }

    const totalCount = (cstDiags?.length || 0) + (diags?.length || 0);
    const res: ConditionTiming = {
      name,
      totalMs: tEnd - t0,
      diags: totalCount,
    };
    results.push(res);
    return res;
  };

  // 1. Cold Start
  await runCondition("Cold Start");

  // 2. Root Parameter Rename
  await runCondition("Param rename", (s) =>
    s.replace("parameter Real L = 1.0;", "parameter Real L_new = 1.0;").replace("dx = L / N;", "dx = L_new / N;"),
  );

  // 3. Global State Modifier
  await runCondition("State modifier", (s) => s.replace("start=zeros(N)", "start=ones(N)"));

  // 4. Isolated Equation Edit
  await runCondition("Equation edit", (s) => s.replace("100.0 - 2.0*T[1]", "200.0 - 2.0*T[1]"));

  // 5. Isolated Structural Edit
  await runCondition("Structural loop", (s) => s.replace("equation\n", "equation\n  T[1] = T[N];\n"));

  // 6. Local Variable Rename
  await runCondition("Variable rename", (s) =>
    s.replace("parameter Real alpha = 1e-4;", "parameter Real my_alpha = 1e-4;").replace(/alpha \*/g, "my_alpha *"),
  );

  // 7. Introduce Type Error
  await runCondition("Type error", (s) => s.replace("1e-4", '"string_value"'));

  // 8. Introduce Syntax Error
  await runCondition("Syntax error", (s) => s.replace("parameter Real dx = L / N;", "parameter Real dx = L / N"));

  return results;
}

async function main() {
  const Ns = [10, 100, 1000, 5000];
  console.log("================================================================================");
  console.log("BENCHMARKING MODELSCRIPT & OMC (BEST OF 3 AFTER 1 WARM-UP)");
  console.log("================================================================================");

  const msBest: Record<number, Record<string, number>> = {};
  const msDiags: Record<number, Record<string, number>> = {};

  for (const n of Ns) {
    console.log(`\n>>> Benchmarking ModelScript N=${n}...`);
    // Warm-up
    await runSinglePass(n);

    // 3 timed runs
    const r1 = await runSinglePass(n);
    const r2 = await runSinglePass(n);
    const r3 = await runSinglePass(n);

    msBest[n] = {};
    msDiags[n] = {};
    for (let i = 0; i < r1.length; i++) {
      const condName = r1[i].name;
      const minVal = Math.min(r1[i].totalMs, r2[i].totalMs, r3[i].totalMs);
      msBest[n][condName] = minVal;
      msDiags[n][condName] = r1[i].diags;
      console.log(
        `  ${condName.padEnd(20)}: ${minVal.toFixed(2)} ms (runs: ${r1[i].totalMs.toFixed(1)}, ${r2[i].totalMs.toFixed(1)}, ${r3[i].totalMs.toFixed(1)})`,
      );
    }
  }

  console.log("\n>>> Benchmarking OMC (OpenModelica Compiler)...");
  const omcBest: Record<number, number> = {};

  for (const n of Ns) {
    const mosPath = `/home/omar/Desktop/amc2026-slides/scratch_bench/run_${n}.mos`;
    if (fs.existsSync(mosPath)) {
      execSync(`omc ${mosPath}`, { stdio: "ignore" }); // warm-up
      const times: number[] = [];
      for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        execSync(`omc ${mosPath}`, { stdio: "ignore" });
        const t1 = performance.now();
        times.push(t1 - t0);
      }
      omcBest[n] = Math.min(...times);
      console.log(`  OMC N=${n}: ${omcBest[n].toFixed(2)} ms (runs: ${times.map((t) => t.toFixed(1)).join(", ")})`);
    }
  }

  const finalResults = {
    msBest,
    msDiags,
    omcBest,
  };

  fs.writeFileSync(
    "/home/omar/Desktop/amc2026-slides/benchmark_best_of_3_results.json",
    JSON.stringify(finalResults, null, 2),
  );
  console.log(
    "\n=== COMPLETED! Results saved to /home/omar/Desktop/amc2026-slides/benchmark_best_of_3_results.json ===",
  );
}

main().catch(console.error);
