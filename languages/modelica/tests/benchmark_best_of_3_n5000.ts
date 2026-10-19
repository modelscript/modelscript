// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
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

async function benchN5000() {
  const N = 5000;
  const baseSrc = generateHeatConduction1D(N);
  const uri = `file:///benchmark/HeatConduction1D_${N}.mo`;

  console.log(">>> Benchmarking N=5000 Cold Start (Best of 3 after 1 warmup)...");
  const coldRuns: number[] = [];
  for (let run = 0; run < 4; run++) {
    const { parser, facade } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const t0 = performance.now();
    ctx.load(baseSrc, uri);
    await ctx.queryEngine.runAllLintsAsync(uri);
    const tree = ctx.getTree(uri);
    const rootPtr = tree ? ((tree.rootNode as any).id ?? (tree.rootNode as any).ptr ?? (tree as any).rootPtr ?? 0) : 0;
    if (rootPtr && facade) {
      (facade as any).getDiagnostics(rootPtr);
    }
    ctx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);
    const t1 = performance.now();
    if (run > 0) {
      coldRuns.push(t1 - t0);
    }
    console.log(`  Cold run ${run} (run 0 is warmup): ${(t1 - t0).toFixed(2)} ms`);
  }
  const coldBest = Math.min(...coldRuns);
  console.log(`Cold Start Best: ${coldBest.toFixed(2)} ms`);

  console.log("\n>>> Benchmarking N=5000 Incremental Edits (Persistent Context, Best of 3 after 1 warmup)...");
  const { parser, facade } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);
  const ctx = new Context(new NodeFileSystem());

  // Initial load into memory
  ctx.load(baseSrc, uri);
  ctx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);

  const conditions = [
    {
      name: "Param rename",
      mutate: (s: string) =>
        s.replace("parameter Real L = 1.0;", "parameter Real L_new = 1.0;").replace("dx = L / N;", "dx = L_new / N;"),
    },
    {
      name: "State modifier",
      mutate: (s: string) => s.replace("start=zeros(N)", "start=ones(N)"),
    },
    {
      name: "Equation edit",
      mutate: (s: string) => s.replace("100.0 - 2.0*T[1]", "200.0 - 2.0*T[1]"),
    },
    {
      name: "Structural loop",
      mutate: (s: string) => s.replace("equation\n", "equation\n  T[1] = T[N];\n"),
    },
    {
      name: "Variable rename",
      mutate: (s: string) =>
        s.replace("parameter Real alpha = 1e-4;", "parameter Real my_alpha = 1e-4;").replace(/alpha \*/g, "my_alpha *"),
    },
    {
      name: "Type error",
      mutate: (s: string) => s.replace("1e-4", '"string_value"'),
    },
    {
      name: "Syntax error",
      mutate: (s: string) => s.replace("parameter Real dx = L / N;", "parameter Real dx = L / N"),
    },
  ];

  const editBest: Record<string, number> = {};

  for (const cond of conditions) {
    const editSrc = cond.mutate(baseSrc);
    const editRanges = computeEditRanges(baseSrc, editSrc);
    const editStart = editRanges.length > 0 ? editRanges[0].startOffset : 0;
    const editNewEnd = editRanges.length > 0 ? editRanges[editRanges.length - 1].endOffset : 0;

    const runs: number[] = [];
    for (let r = 0; r < 4; r++) {
      const t0 = performance.now();
      ctx.load(editSrc, uri);
      await ctx.queryEngine.runAllLintsAsync(uri);
      const tree = ctx.getTree(uri);
      const rootPtr = tree
        ? ((tree.rootNode as any).id ?? (tree.rootNode as any).ptr ?? (tree as any).rootPtr ?? 0)
        : 0;
      if (rootPtr && facade) {
        (facade as any).getDiagnostics(rootPtr, editStart, editNewEnd);
      }
      try {
        ctx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);
      } catch {
        /* ignore */
      }
      const t1 = performance.now();

      if (r > 0) {
        runs.push(t1 - t0);
      }

      // Revert back to baseSrc for next iteration
      ctx.load(baseSrc, uri);
      try {
        ctx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);
      } catch {
        /* ignore */
      }
    }

    const best = Math.min(...runs);
    editBest[cond.name] = best;
    console.log(`  ${cond.name.padEnd(20)}: ${best.toFixed(2)} ms (runs: ${runs.map((t) => t.toFixed(1)).join(", ")})`);
  }

  console.log("\nALL N=5000 BEST-OF-3 RESULTS:");
  console.log(JSON.stringify({ coldBest, editBest }, null, 2));
}

benchN5000().catch(console.error);
