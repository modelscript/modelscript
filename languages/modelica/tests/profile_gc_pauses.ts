import { createWasmParser } from "@modelscript/modelica/parser";
import path from "node:path";
import { PerformanceObserver, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

function generateCascade(n: number): string {
  const lines = [`model Cascade_${n}`];
  for (let i = 1; i <= n; i++) lines.push(`  Real x${i}(start=1.0);`);
  lines.push("equation");
  lines.push("  der(x1) = -x1;");
  for (let i = 2; i <= n; i++) lines.push(`  der(x${i}) = x${i - 1} - x${i};`);
  lines.push(`end Cascade_${n};`);
  return lines.join("\n");
}

interface GCStats {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

async function runGCProfiling() {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  console.log("================================================================================");
  console.log("V8 Garbage Collection Pause Profiling: AST vs DAE Arena");
  console.log("================================================================================");

  const scales = [100, 1000, 5000];

  for (const N of scales) {
    const src = generateCascade(N);
    const uri = `file:///benchmark/Cascade_${N}.mo`;
    const modelName = `Cascade_${N}`;

    // Tracking structures for GC
    let currentPhase: "idle" | "ast" | "arena" = "idle";
    const phaseGC: Record<"ast" | "arena", GCStats> = {
      ast: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
      arena: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
    };

    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "gc" && (currentPhase === "ast" || currentPhase === "arena")) {
          const stats = phaseGC[currentPhase];
          stats.count++;
          stats.totalDurationMs += entry.duration;
          if (entry.duration > stats.maxDurationMs) {
            stats.maxDurationMs = entry.duration;
          }
        }
      }
    });
    obs.observe({ entryTypes: ["gc"] });

    // Force initial GC if available to clean previous slate
    if ((global as any).gc) {
      (global as any).gc();
    }

    const ctx = new Context(new NodeFileSystem());

    // Phase 1: AST Parsing & Semantic Indexing
    currentPhase = "ast";
    const t0 = performance.now();
    ctx.load(src, uri);
    const astDuration = performance.now() - t0;

    // Phase 2: DAE Arena Lowering & Flattening
    currentPhase = "arena";
    const t1 = performance.now();
    const arena = ctx.flattenArena(modelName, undefined, uri);
    const arenaDuration = performance.now() - t1;

    currentPhase = "idle";
    obs.disconnect();

    console.log(`\n--- Scale N = ${N} (${arena?.varCount ?? 0} vars, ${arena?.eqCount ?? 0} eqs) ---`);
    console.log(
      `Phase 1 [AST Parsing/Indexing]:   Wall=${astDuration.toFixed(1)}ms | GC Pauses: count=${phaseGC.ast.count}, total=${phaseGC.ast.totalDurationMs.toFixed(2)}ms, max=${phaseGC.ast.maxDurationMs.toFixed(2)}ms`,
    );
    console.log(
      `Phase 2 [DAE Arena Flattening]:  Wall=${arenaDuration.toFixed(1)}ms | GC Pauses: count=${phaseGC.arena.count}, total=${phaseGC.arena.totalDurationMs.toFixed(2)}ms, max=${phaseGC.arena.maxDurationMs.toFixed(2)}ms`,
    );
  }

  // Stress test: 30 repeated incremental edits on N=1000 to observe GC behavior over time
  console.log("\n--- Continuous Keystroke Stream Stress Test (30 edits on N=1,000) ---");
  const N_stress = 1000;
  const baseSrc = generateCascade(N_stress);
  const uri = `file:///benchmark/Cascade_${N_stress}.mo`;
  const ctx = new Context(new NodeFileSystem());
  ctx.load(baseSrc, uri);
  ctx.flattenArena(`Cascade_${N_stress}`, undefined, uri);

  const stressAstGC: GCStats = { count: 0, totalDurationMs: 0, maxDurationMs: 0 };
  const stressArenaGC: GCStats = { count: 0, totalDurationMs: 0, maxDurationMs: 0 };
  let currentStressPhase: "ast" | "arena" | "idle" = "idle";

  const stressObs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === "gc") {
        if (currentStressPhase === "ast") {
          stressAstGC.count++;
          stressAstGC.totalDurationMs += entry.duration;
          stressAstGC.maxDurationMs = Math.max(stressAstGC.maxDurationMs, entry.duration);
        } else if (currentStressPhase === "arena") {
          stressArenaGC.count++;
          stressArenaGC.totalDurationMs += entry.duration;
          stressArenaGC.maxDurationMs = Math.max(stressArenaGC.maxDurationMs, entry.duration);
        }
      }
    }
  });
  stressObs.observe({ entryTypes: ["gc"] });

  let totalAstTime = 0;
  let totalArenaTime = 0;

  for (let i = 0; i < 30; i++) {
    const mutated = baseSrc.replace("Real x1(start=1.0);", `Real x1(start=${(1.0 + i * 0.1).toFixed(1)});`);
    currentStressPhase = "ast";
    const t0 = performance.now();
    ctx.load(mutated, uri);
    totalAstTime += performance.now() - t0;

    currentStressPhase = "arena";
    const t1 = performance.now();
    ctx.flattenArena(`Cascade_${N_stress}`, undefined, uri);
    totalArenaTime += performance.now() - t1;
    currentStressPhase = "idle";
  }
  stressObs.disconnect();

  console.log(
    `Incremental AST Reload (30 iterations):   Total=${totalAstTime.toFixed(1)}ms (avg ${(totalAstTime / 30).toFixed(1)}ms/edit) | GC Pauses: count=${stressAstGC.count}, total=${stressAstGC.totalDurationMs.toFixed(2)}ms, max=${stressAstGC.maxDurationMs.toFixed(2)}ms`,
  );
  console.log(
    `Incremental Arena Flatten (30 iterations): Total=${totalArenaTime.toFixed(1)}ms (avg ${(totalArenaTime / 30).toFixed(1)}ms/edit) | GC Pauses: count=${stressArenaGC.count}, total=${stressArenaGC.totalDurationMs.toFixed(2)}ms, max=${stressArenaGC.maxDurationMs.toFixed(2)}ms`,
  );
}

runGCProfiling().catch(console.error);
