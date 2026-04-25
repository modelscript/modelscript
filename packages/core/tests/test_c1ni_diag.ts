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

  console.log("State vars:", [...sim.stateVars].join(", "));

  const result = await sim.simulate(0, 5, 0.001);
  console.log(`Points: ${result.t.length}`);

  const timePoints = [1.01, 1.1, 1.5, 2.0, 3.0, 5.0];
  const cols = ["C1.v", "C2.v", "C3.v", "L1.i", "L2.i", "C1.i", "C1.n.i", "R1.i"];
  const indices: Record<string, number> = {};
  for (const name of cols) indices[name] = result.states.indexOf(name);

  console.log(`\n${"t".padEnd(8)} ${cols.map((c) => c.padEnd(12)).join(" ")}`);
  console.log("-".repeat(8 + cols.length * 13));

  for (const tp of timePoints) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < result.t.length; i++) {
      const dist = Math.abs((result.t[i] ?? 0) - tp);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const row = result.y[bestIdx];
    if (!row) continue;
    const t = result.t[bestIdx] ?? 0;
    const vals = cols.map((c) => {
      const idx = indices[c] ?? -1;
      return idx >= 0 ? (row[idx] ?? 0).toFixed(6).padEnd(12) : "N/A".padEnd(12);
    });
    console.log(`${t.toFixed(4).padEnd(8)} ${vals.join(" ")}`);
  }

  // Verify L1.i is non-zero after step
  const l1iIdx = indices["L1.i"] ?? -1;
  if (l1iIdx >= 0) {
    let maxL1i = 0;
    for (let i = 0; i < result.t.length; i++) {
      const row = result.y[i];
      if (!row) continue;
      maxL1i = Math.max(maxL1i, Math.abs(row[l1iIdx] ?? 0));
    }
    console.log(`\nMax |L1.i|: ${maxL1i.toFixed(6)} ${maxL1i > 0.01 ? "✓ NON-ZERO" : "✗ STILL ZERO"}`);
  }
}

main().catch(console.error);
