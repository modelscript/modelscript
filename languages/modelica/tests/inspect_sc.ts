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
await context.addLibrary("/home/omar/git/amc2026/modelsold/SimpleCircuit.mo");

const arena1 = context.flattenArena("SimpleCircuit");
if (!arena1) throw new Error("Failed to flatten SimpleCircuit (arena1)");
console.log("arena1 eqCount:", arena1.eqCount);

const text = context.flatten("SimpleCircuit");
if (!text) throw new Error("Failed to flatten SimpleCircuit (text)");
console.log("flatten text:\n" + text);

const arena2 = context.flattenArena("SimpleCircuit");
if (!arena2) throw new Error("Failed to flatten SimpleCircuit (arena2)");
console.log("arena2 eqCount:", arena2.eqCount);
await initBltWasm();

const res = simulateArena(arena1, { startTime: 0, stopTime: 2.0, step: 0.01, solver: "dopri5" });
console.log("States:", res.states);
for (let i = 0; i <= 10; i++) {
  console.log(`t=${res.t[i].toFixed(2)}: V=${res.y[i][0]}`);
}
