import { createWasmParser } from "@modelscript/modelica/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

const context = Context.createBatch(new NodeFileSystem());
await context.addLibrary("/home/omar/git/amc2026/modelsold/SimpleCircuit.mo");

import { initBltWasm } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate/core";

await initBltWasm();
const arena = context.flattenArena("SimpleCircuit");
if (!arena) throw new Error("Failed to flatten SimpleCircuit");
const res = simulateArena(arena, {
  stopTime: 2.0,
  step: 0.01,
  solver: "dopri5",
});
console.log("Simulate Dopri5 states:", res.states);
console.log("Final row:", res.t[res.t.length - 1], res.y[res.y.length - 1]);

console.log(
  "StateVars:",
  Array.from(sim.stateVars).map((i) => arena.getVarName(i)),
);
console.log(
  "DerivativeVars:",
  Array.from(sim.derivativeVars).map((i) => arena.getVarName(i)),
);
console.log(
  "ParameterVars:",
  Array.from(sim.parameterVars).map((i) => arena.getVarName(i)),
);
console.log("Blocks:", sim.blocks);

for (let i = 0; i < arena.varCount; i++) {
  console.log(
    `Var ${i}: name=${arena.getVarName(i)}, type=${arena.getVarType(i)}, variability=${arena.getVarVariability(i)}, causality=${arena.getVarCausality(i)}, startVal=${arena.getVarStartValue(i)}, hasExplicitExpr=${arena.hasExplicitVarExpression(i)}, explicitExpr=${arena.getExplicitVarExpression(i)}`,
  );
}
console.log("SimpleCircuit Eq Count:", arena.eqCount);
for (let i = 0; i < arena.eqCount; i++) {
  console.log(`Eq ${i}: kind=${arena.getEqKind(i)}, lhs=${arena.getEqLhs(i)}, rhs=${arena.getEqRhs(i)}`);
}
console.log("SimpleCircuit Expr Count:", arena.exprCount);
for (let i = 0; i < arena.exprCount; i++) {
  console.log(
    `Expr ${i}: kind=${arena.getExprKind(i)}, data1=${arena.getExprData1(i)}, left=${arena.getExprLeft(i)}, right=${arena.getExprRight(i)}`,
  );
}
