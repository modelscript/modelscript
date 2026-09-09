import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm } from "@modelscript/runtime";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateArena } from "../../../packages/simulate/src/core/simulate-arena.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

const context = Context.createBatch(new NodeFileSystem());
await context.addLibrary("/home/omar/git/amc2026/modelsold/SpringMassDamper.mo");

const arena = context.flattenArena("SpringMassDamper");
if (!arena) throw new Error("Failed to flatten SpringMassDamper");
for (let i = 0; i < arena.varCount; i++) {
  const name = arena.getVarName(i);
  const nameId = arena.getVarNameId(i);
  const internId = arena.interner.intern(name);
  console.log(`Var ${i} (${name}): getVarNameId=${nameId}, interner.intern=${internId}`);
}
await initBltWasm();

const outputStringIds = [57, 58, 59, 60, 61];
const res = simulateArena(arena, {
  startTime: 0,
  stopTime: 2.0,
  step: 0.01,
  solver: "dopri5",
  outputStringIds,
});

console.log("res.states:", res.states);
console.log("First row of y:", res.y[0]);
console.log("Last row of y:", res.y[res.y.length - 1]);
