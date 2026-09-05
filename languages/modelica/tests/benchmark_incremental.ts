// SPDX-License-Identifier: AGPL-3.0-or-later
import { createWasmParser } from "@modelscript/modelica/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function main() {
  const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  const Ns = [10, 100, 1000, 5000];
  const RUNS = 3;

  console.log("================================================================================");
  console.log("Incremental Edit Benchmark with New In-Place WASM DAE & Salsa 3.0");
  console.log("================================================================================");

  for (const N of Ns) {
    const src = generateHeatConduction1D(N);
    const filename = `file:///HeatConduction1D_${N}.mo`;
    const modelName = `HeatConduction1D_${N}`;

    let coldIndexSum = 0;
    let coldFlattenSum = 0;
    let eqIndexSum = 0;
    let eqFlattenSum = 0;
    let paramIndexSum = 0;
    let paramFlattenSum = 0;
    let stateIndexSum = 0;
    let stateFlattenSum = 0;
    let structIndexSum = 0;
    let structFlattenSum = 0;

    for (let r = 0; r < RUNS; r++) {
      const ctx = new Context(new NodeFileSystem());
      const c0 = performance.now();
      ctx.load(src, filename);
      const c1 = performance.now();
      const daeInitial = ctx.flattenArena(modelName, undefined, filename);
      const c2 = performance.now();
      coldIndexSum += c1 - c0;
      coldFlattenSum += c2 - c1;

      // Edit 1: Isolated Equation Edit
      const mutatedEq = src.replace("100.0 - 2.0*T[1]", "200.0 - 2.0*T[1]");
      const t0 = performance.now();
      ctx.load(mutatedEq, filename);
      const t1 = performance.now();
      const daeEq = ctx.flattenArena(modelName, undefined, filename);
      const t2 = performance.now();
      eqIndexSum += t1 - t0;
      eqFlattenSum += t2 - t1;

      // Edit 2: Parameter Value Edit (L = 1.0 -> 2.0)
      const mutatedParam = mutatedEq.replace("parameter Real L = 1.0;", "parameter Real L = 2.0;");
      const t3 = performance.now();
      ctx.load(mutatedParam, filename);
      const t4 = performance.now();
      const daeParam = ctx.flattenArena(modelName, undefined, filename);
      const t5 = performance.now();
      paramIndexSum += t4 - t3;
      paramFlattenSum += t5 - t4;

      // Edit 3: Global State Modifier (start=zeros(N) -> start=ones(N))
      const mutatedState = mutatedParam.replace("start=zeros(N)", "start=ones(N)");
      const t6 = performance.now();
      ctx.load(mutatedState, filename);
      const t7 = performance.now();
      const daeState = ctx.flattenArena(modelName, undefined, filename);
      const t8 = performance.now();
      stateIndexSum += t7 - t6;
      stateFlattenSum += t8 - t7;

      // Edit 4: Isolated Structural Edit (add algebraic loop / equation)
      const mutatedStructural = mutatedState.replace("equation\n", "equation\n  T[1] = T[N];\n");
      const t9 = performance.now();
      ctx.load(mutatedStructural, filename);
      const t10 = performance.now();
      const daeStructural = ctx.flattenArena(modelName, undefined, filename);
      const t11 = performance.now();
      structIndexSum += t10 - t9;
      structFlattenSum += t11 - t10;
    }

    const avgColdIndex = coldIndexSum / RUNS;
    const avgColdFlatten = coldFlattenSum / RUNS;
    const avgEqIndex = eqIndexSum / RUNS;
    const avgEqFlatten = eqFlattenSum / RUNS;
    const avgParamIndex = paramIndexSum / RUNS;
    const avgParamFlatten = paramFlattenSum / RUNS;
    const avgStateIndex = stateIndexSum / RUNS;
    const avgStateFlatten = stateFlattenSum / RUNS;
    const avgStructIndex = structIndexSum / RUNS;
    const avgStructFlatten = structFlattenSum / RUNS;

    console.log(`\n--- N = ${N} Equations (Average of ${RUNS} runs) ---`);
    console.log(
      `  Cold Start:             re-index=${avgColdIndex.toFixed(2)}ms, flatten=${avgColdFlatten.toFixed(2)}ms, total=${(avgColdIndex + avgColdFlatten).toFixed(2)}ms`,
    );
    console.log(
      `  Isolated Equation Edit: re-index=${avgEqIndex.toFixed(2)}ms, re-flatten=${avgEqFlatten.toFixed(2)}ms, total=${(avgEqIndex + avgEqFlatten).toFixed(2)}ms`,
    );
    console.log(
      `  Parameter Value Edit:   re-index=${avgParamIndex.toFixed(2)}ms, re-flatten=${avgParamFlatten.toFixed(2)}ms, total=${(avgParamIndex + avgParamFlatten).toFixed(2)}ms`,
    );
    console.log(
      `  Global State Modifier:  re-index=${avgStateIndex.toFixed(2)}ms, re-flatten=${avgStateFlatten.toFixed(2)}ms, total=${(avgStateIndex + avgStateFlatten).toFixed(2)}ms`,
    );
    console.log(
      `  Structural Edit:        re-index=${avgStructIndex.toFixed(2)}ms, re-flatten=${avgStructFlatten.toFixed(2)}ms, total=${(avgStructIndex + avgStructFlatten).toFixed(2)}ms`,
    );
  }
}

main().catch(console.error);
