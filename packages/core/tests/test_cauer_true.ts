import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { NodeFileSystem } from "../../../apps/cli/src/util/filesystem.js";
import { Context } from "../src/compiler/context.js";
import { ModelicaDAE, ModelicaDAEPrinter } from "../src/compiler/modelica/dae.js";
import { ModelicaFlattener } from "../src/compiler/modelica/flattener.js";
import { ModelicaSimulator } from "../src/compiler/modelica/simulator.js";
import { StringWriter } from "../src/util/io.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

async function main() {
  const ctx = new Context(new NodeFileSystem());
  const packageDir = "/home/omar/git/modelscript/packages/core/tests/msl/Modelica 4.1.0";
  await ctx.addLibrary(packageDir);

  const className = "Modelica.Electrical.Analog.Examples.CauerLowPassAnalog";
  console.log(`Starting flatten of ${className}...`);
  const cls = ctx.query(className);
  if (!cls) {
    throw new Error(`Class ${className} not found in Context. Loaded classes count: ${ctx.classes.length}`);
  }
  const t0 = performance.now();

  const dae = new ModelicaDAE(cls.name ?? "DAE", cls.description);
  const flattener = new ModelicaFlattener();
  cls.accept(flattener, ["", dae]);
  flattener.generateFlowBalanceEquations(dae);
  flattener.foldDAEConstants(dae);

  console.log("Class Diagnostics:");
  for (const d of (cls as { diagnostics?: Record<string, unknown>[] }).diagnostics ?? []) {
    console.log(`[${d.severity}] ${d.message}`);
  }

  console.log("DAE Diagnostics:");
  for (const d of dae.diagnostics) {
    console.log(`[${d.severity}] ${d.message}`);
  }

  console.log(`Flattened in ${performance.now() - t0}ms`);
  console.log(`DAE Equations: ${dae.equations.length}`);
  console.log(`DAE Variables: ${dae.variables.length}`);

  if (dae.equations.length === 0) {
    console.error("NO EQUATIONS IN DAE! The simulation is technically empty!");
    return;
  }

  const out = new StringWriter();
  const printer = new ModelicaDAEPrinter(out);
  dae.accept(printer);
  console.log("--- DAE Equations ---");
  console.log(out.toString());
  console.log("---------------------");

  const sim = new ModelicaSimulator(dae);
  sim.prepare();

  try {
    const tSim = performance.now();
    const exp = dae.experiment;
    const startTime = exp.startTime ?? 0;
    const stopTime = exp.stopTime ?? 60;
    const step = exp.interval ?? (stopTime - startTime) / 100;

    const parameterOverrides = new Map<string, number>();
    parameterOverrides.set("V.V", 24.0);

    const result = await sim.simulate(startTime, stopTime, step, { parameterOverrides });
    console.log(`Simulated ${result.t.length} points in ${performance.now() - tSim}ms`);

    // Print the final state variables
    const finalRow: Record<string, number> = {};
    for (let i = 0; i < result.states.length; i++) {
      finalRow[result.states[i]] = result.y[result.y.length - 1][i];
    }
    console.log("Final state values:", finalRow);
  } catch (e) {
    console.error(e);
  }
}

main().catch(console.error);
