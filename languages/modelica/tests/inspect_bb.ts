import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm } from "@modelscript/runtime";
import fs from "node:fs";
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
await initBltWasm();

const ctx = new Context(new NodeFileSystem());
const src = fs.readFileSync("/home/omar/git/amc2026/modelsold/BouncingBall.mo", "utf-8");
ctx.load(src, "file:///BouncingBall.mo");

const arena = ctx.flattenArena("BouncingBall", undefined, "file:///BouncingBall.mo");
if (!arena) throw new Error("Failed to flatten BouncingBall");

const res = simulateArena(arena, {
  startTime: 0,
  stopTime: 2.0,
  step: 0.01,
  solver: "dopri5",
});

console.log("States:", res.states);
console.log("Time, h, v samples:");
for (let i = 0; i < res.t.length; i += 10) {
  console.log(`t=${res.t[i].toFixed(2)}, h=${res.y[i][0].toFixed(4)}, v=${res.y[i][1].toFixed(4)}`);
}
