import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { NodeFileSystem } from "../../../apps/cli/src/util/filesystem.js";
import { Context } from "../src/compiler/context.js";
import { ModelicaDAE } from "../src/compiler/modelica/dae.js";
import { ModelicaFlattener } from "../src/compiler/modelica/flattener.js";
import { ModelicaSimulator } from "../src/compiler/modelica/simulator.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

async function main() {
  const ctx = new Context(new NodeFileSystem());
  const packageDir = "/home/omar/git/modelscript/packages/core/tests/msl/Modelica 4.1.0";
  await ctx.addLibrary(packageDir);

  const className = "Modelica.Electrical.Analog.Examples.CauerLowPassAnalog";
  const cls = ctx.query(className);
  if (!cls) throw new Error(`Class ${className} not found`);

  const dae = new ModelicaDAE(cls.name ?? "DAE", cls.description);
  const flattener = new ModelicaFlattener();
  cls.accept(flattener, ["", dae]);
  flattener.generateFlowBalanceEquations(dae);
  flattener.foldDAEConstants(dae);

  const sim = new ModelicaSimulator(dae);
  sim.prepare();

  // Run with step 0.001 for high accuracy
  const result = await sim.simulate(0, 10, 0.001);
  console.log(`Points: ${result.t.length}`);

  // Compare peak C1.v
  const c1vIdx = result.states.indexOf("C1.v");
  let peakV = 0,
    peakT = 0;
  if (c1vIdx >= 0) {
    for (let i = 0; i < result.t.length; i++) {
      const v = result.y[i]?.[c1vIdx] ?? 0;
      if (v > peakV) {
        peakV = v;
        peakT = result.t[i] ?? 0;
      }
    }
  }
  console.log(`C1.v peak: ${peakV.toFixed(6)} at t=${peakT.toFixed(4)} (OM ref: ~0.85 at t≈2)`);

  // Also run with step 0.0001 to see if accuracy improves
  const result2 = await sim.simulate(0, 5, 0.0001);
  console.log(`Points (fine): ${result2.t.length}`);
  const c1vIdx2 = result2.states.indexOf("C1.v");
  let peakV2 = 0,
    peakT2 = 0;
  if (c1vIdx2 >= 0) {
    for (let i = 0; i < result2.t.length; i++) {
      const v = result2.y[i]?.[c1vIdx2] ?? 0;
      if (v > peakV2) {
        peakV2 = v;
        peakT2 = result2.t[i] ?? 0;
      }
    }
  }
  console.log(`C1.v peak (fine): ${peakV2.toFixed(6)} at t=${peakT2.toFixed(4)}`);
}

main().catch(console.error);
