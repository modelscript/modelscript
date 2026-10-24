// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  AliasEliminationPass,
  BltPass,
  Causality,
  ConstantFoldingPass,
  DAEBuilder,
  DAEPass,
  DAEPassManager,
  EqKind,
  InspectableBipartiteGraph,
  PantelidesPass,
  PassContext,
  PassResult,
  ScalarizePass,
  VarType,
  Variability,
  createDefaultSimulationPipeline,
  initBltWasm,
} from "../src/index.js";

async function main() {
  console.log("=== Testing DAEPassManager & Modular Pass Pipeline ===");
  await initBltWasm();

  // 1. Pipeline construction & ordering tests
  console.log("1. Testing pass registration and reordering...");
  const pm = new DAEPassManager();
  pm.addPass(new ScalarizePass());
  pm.addPass(new ConstantFoldingPass());
  pm.addPass(new BltPass());

  assert.strictEqual(pm.getPasses().length, 3);
  assert.strictEqual(pm.getPasses()[0]?.name, "scalarize");
  assert.strictEqual(pm.getPasses()[1]?.name, "constant-folding");
  assert.strictEqual(pm.getPasses()[2]?.name, "blt");

  // Insert Pantelides before BLT
  pm.insertPassBefore("blt", new PantelidesPass());
  assert.strictEqual(pm.getPasses().length, 4);
  assert.strictEqual(pm.getPasses()[2]?.name, "pantelides");
  assert.strictEqual(pm.getPasses()[3]?.name, "blt");

  // Insert AliasElimination after constant-folding
  pm.insertPassAfter("constant-folding", new AliasEliminationPass());
  assert.strictEqual(pm.getPasses().length, 5);
  assert.strictEqual(pm.getPasses()[2]?.name, "alias-elimination");
  assert.strictEqual(pm.getPasses()[3]?.name, "pantelides");

  // 2. Custom Pass Registration
  console.log("2. Testing custom pass execution via fluent API...");
  class GainDoublerPass implements DAEPass {
    readonly name = "gain-doubler";
    readonly description = "Scales parameter k by 2.0";
    run(arena: DAEBuilder, ctx: PassContext): PassResult {
      const kVar = arena.variable("k");
      if (kVar) {
        kVar.setStart(kVar.start * 2.0);
        ctx.parameters.set("k", kVar.start);
        return { changed: true, message: `Doubled parameter k to ${kVar.start}` };
      }
      return { changed: false };
    }
  }

  pm.insertPassBefore("constant-folding", new GainDoublerPass());
  assert.strictEqual(pm.getPasses()[1]?.name, "gain-doubler");

  // 3. Execution on DAE arena
  console.log("3. Executing pipeline on DAE arena...");
  const dae = new DAEBuilder();
  const xId = dae.interner.intern("x");
  const derXId = dae.interner.intern("der(x)");
  const kId = dae.interner.intern("k");

  const xIdx = dae.addVariable(xId, VarType.Real, Variability.Continuous, Causality.Local, 1.0, 0);
  const derXIdx = dae.addVariable(derXId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const kIdx = dae.addVariable(kId, VarType.Real, Variability.Parameter, Causality.Local, 5.0, 0);

  // der(x) = -k * x
  const derXExpr = dae.varExpr("der(x)");
  const rhsExpr = dae.varExpr("k").neg().mul(dae.varExpr("x"));
  dae.addEquation(EqKind.Simple, derXExpr.id, rhsExpr.id);

  const initialCtx: Partial<PassContext> = {
    stateVars: new Set([xIdx]),
    derivativeVars: new Set([derXIdx]),
    parameterVars: new Set([kIdx]),
  };

  const summary = pm.run(dae, initialCtx);

  assert.strictEqual(summary.reports.length, 6, "All 6 passes should have executed");
  assert.ok(summary.totalDurationMs >= 0, "Execution time should be recorded");

  // Verify custom pass result
  const gainReport = summary.reports.find((r) => r.passName === "gain-doubler");
  assert.ok(gainReport !== undefined);
  assert.strictEqual(gainReport.result?.changed, true);
  assert.strictEqual(dae.getVarStartValue(kIdx), 10.0, "Start value of k should be doubled to 10.0");

  // Verify BLT pass output and Bipartite graph inspection
  const bltReport = summary.reports.find((r) => r.passName === "blt");
  assert.ok(bltReport !== undefined);
  assert.ok(summary.context.bltResult !== undefined);

  const bipartiteGraph = summary.context.sharedData.get("bipartiteGraph") as InspectableBipartiteGraph;
  assert.ok(bipartiteGraph !== undefined, "Bipartite graph should be attached to context");
  assert.strictEqual(bipartiteGraph.equationCount, dae.eqCount);
  assert.strictEqual(bipartiteGraph.variableCount, dae.varCount);
  assert.ok(Array.isArray(bipartiteGraph.blocks));

  // 4. Default Simulation Pipeline Factory
  console.log("4. Testing createDefaultSimulationPipeline factory...");
  const defaultPipe = createDefaultSimulationPipeline();
  assert.strictEqual(defaultPipe.getPasses().length, 5);

  console.log("=== All DAEPassManager tests passed successfully! ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
