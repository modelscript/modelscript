import Modelica from "@modelscript/modelica/parser";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import Parser from "tree-sitter";
import { Context } from "../packages/core/src/compiler/context.js";
import { NodeFileSystem } from "../packages/core/tests/node-filesystem.js";

// Suppress excessive logging
const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("[DEBUG ARENA EVAL NAME]")) return;
  originalLog(...args);
};
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("[Context] toUnified")) return;
  originalError(...args);
};

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

function indexToPoint(text: string, index: number) {
  let row = 0;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") {
      row++;
      lastNewline = i;
    }
  }
  return { row, column: index - lastNewline - 1 };
}

function computeTreeEdit(oldText: string, newText: string) {
  const minLen = Math.min(oldText.length, newText.length);
  let prefixLen = 0;
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }
  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (oldSuffix > prefixLen && newSuffix > prefixLen && oldText[oldSuffix - 1] === newText[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }
  return {
    startIndex: prefixLen,
    oldEndIndex: oldSuffix,
    newEndIndex: newSuffix,
    startPosition: indexToPoint(oldText, prefixLen),
    oldEndPosition: indexToPoint(oldText, oldSuffix),
    newEndPosition: indexToPoint(newText, newSuffix),
  };
}

function loadIncremental(ctx: Context, parser: any, oldText: string, newText: string, uri: string) {
  const oldTree = (ctx as any)._trees.get(uri);
  const edit = computeTreeEdit(oldText, newText);
  oldTree.edit(edit);
  const newTree = parser.parse(newText, oldTree);
  (ctx as any)._trees.set(uri, newTree);
  ctx.workspaceIndex.markDirty(uri, () => newTree.rootNode as any, [
    {
      startByte: edit.startIndex,
      endByte: edit.newEndIndex,
    },
  ]);
  const unified = ctx.workspaceIndex.toUnified();
  ctx.queryEngine.updateIndex(unified);
}

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
    code += `  der(T[${n}]) = alpha * (T[${n - 1}] - T[${n}]) / (dx^2);\n`;
  }

  code += `  annotation(\n`;
  code += `    experiment(StartTime = 0, StopTime = 10, Tolerance = 1e-6, Interval = 0.1)\n`;
  code += `  );\n`;
  code += `end HeatConduction1D_${n};`;
  return code;
}

async function run() {
  const Ns = [10, 100, 1000, 10000, 100000];
  const results = {
    n_equations: Ns,
    cold_start: [] as number[],
    incremental_lexical: [] as number[],
    incremental_modifier: [] as number[],
    incremental_equation: [] as number[],
    incremental_structural: [] as number[],
  };

  for (const N of Ns) {
    originalLog(`\nRunning benchmark for N = ${N}...`);
    const sourceCode = generateHeatConduction1D(N);
    const className = `HeatConduction1D_${N}`;

    // Cold Start
    const ctx = new Context(new NodeFileSystem());
    const t0 = performance.now();
    ctx.load(sourceCode, "benchmark.mo");
    await ctx.queryEngine.runAllLintsAsync("benchmark.mo");
    const coldStartTime = performance.now() - t0;
    results.cold_start.push(Math.round(coldStartTime));
    originalLog(`  Cold Start: ${Math.round(coldStartTime)} ms (Revision: ${ctx.workspaceIndex.structuralRevision})`);

    // Lexical Mutation (rename parameter L to L_new)
    let mutatedLexical = sourceCode.replace("parameter Real L = 1.0;", "parameter Real L_new = 1.0;");
    mutatedLexical = mutatedLexical.replace(/ L /g, " L_new ");
    const t1 = performance.now();
    loadIncremental(ctx, parser, sourceCode, mutatedLexical, "benchmark.mo");
    await ctx.queryEngine.runAllLintsAsync("benchmark.mo");
    const lexicalTime = performance.now() - t1;
    results.incremental_lexical.push(Math.round(lexicalTime));
    originalLog(
      `  Lexical Mutation: ${Math.round(lexicalTime)} ms (Revision: ${ctx.workspaceIndex.structuralRevision})`,
    );

    // Modifier Mutation (change start=zeros(N) to start=ones(N))
    const mutatedModifier = mutatedLexical.replace("start=zeros(N)", "start=ones(N)");
    const t2 = performance.now();
    loadIncremental(ctx, parser, mutatedLexical, mutatedModifier, "benchmark.mo");
    await ctx.queryEngine.runAllLintsAsync("benchmark.mo");
    const modifierTime = performance.now() - t2;
    results.incremental_modifier.push(Math.round(modifierTime));
    originalLog(
      `  Modifier Mutation: ${Math.round(modifierTime)} ms (Revision: ${ctx.workspaceIndex.structuralRevision})`,
    );

    // Equation Mutation (change 100.0 to 200.0 in the first equation)
    const mutatedEquation = mutatedModifier.replace("100.0 - 2.0*T[1]", "200.0 - 2.0*T[1]");
    const t3 = performance.now();
    loadIncremental(ctx, parser, mutatedModifier, mutatedEquation, "benchmark.mo");
    await ctx.queryEngine.runAllLintsAsync("benchmark.mo");
    const equationTime = performance.now() - t3;
    results.incremental_equation.push(Math.round(equationTime));
    originalLog(
      `  Equation Mutation: ${Math.round(equationTime)} ms (Revision: ${ctx.workspaceIndex.structuralRevision})`,
    );

    // Structural Mutation (add cross-coupling algebraic loop: T[1] = T[N])
    const mutatedStructural = mutatedEquation.replace("equation\n", "equation\n  T[1] = T[N]; // structural loop\n");
    const t4 = performance.now();
    loadIncremental(ctx, parser, mutatedEquation, mutatedStructural, "benchmark.mo");
    await ctx.queryEngine.runAllLintsAsync("benchmark.mo");
    const structuralTime = performance.now() - t4;
    results.incremental_structural.push(Math.round(structuralTime));
    originalLog(
      `  Structural Mutation: ${Math.round(structuralTime)} ms (Revision: ${ctx.workspaceIndex.structuralRevision})`,
    );

    // Attempt GC
    Context.gcBetweenPhases();
  }

  const outPath = path.resolve("/home/omar/git/amc2026/data/measurements.json");

  // Read existing json to merge data instead of overwriting the whole file
  let existingData: any = {};
  if (fs.existsSync(outPath)) {
    existingData = JSON.parse(fs.readFileSync(outPath, "utf8"));
  }
  existingData.incremental_latency = results;

  fs.writeFileSync(outPath, JSON.stringify(existingData, null, 2));
  originalLog(`\nResults written to ${outPath}`);
}

run().catch(console.error);
