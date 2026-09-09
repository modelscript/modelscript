import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateArena, simulateArenaAsync } from "../../../packages/simulate/src/core/simulate-arena.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);
await initBltWasm();

const ctx = new Context(new NodeFileSystem());
const srcSMD = fs.readFileSync("/home/omar/git/amc2026/modelsold/SpringMassDamper.mo", "utf-8");
ctx.load(srcSMD, "file:///SpringMassDamper.mo");

const arenaSMD = ctx.flattenArena("SpringMassDamper", undefined, "file:///SpringMassDamper.mo");
if (!arenaSMD) throw new Error("Failed to flatten SpringMassDamper");

console.log("=== SpringMassDamper Simulation ===");
const resDopri = simulateArena(arenaSMD, { startTime: 0, stopTime: 2.0, step: 0.01, solver: "dopri5" });
console.log(`Dopri5 final s(2.0): ${resDopri.y[resDopri.y.length - 1][0].toFixed(6)}`);

const resRk4 = simulateArena(arenaSMD, { startTime: 0, stopTime: 2.0, step: 0.01, solver: "rk4" });
console.log(`RK4 final s(2.0):    ${resRk4.y[resRk4.y.length - 1][0].toFixed(6)}`);

try {
  const resCvode = await simulateArenaAsync(arenaSMD, { startTime: 0, stopTime: 2.0, step: 0.01, solver: "cvode" });
  console.log(`CVODE final s(2.0):  ${resCvode.y[resCvode.y.length - 1][0].toFixed(6)}`);
} catch (e: any) {
  console.log(`CVODE error: ${e.message}`);
}

const srcBB = fs.readFileSync("/home/omar/git/amc2026/modelsold/BouncingBall.mo", "utf-8");
ctx.load(srcBB, "file:///BouncingBall.mo");
const arenaBB = ctx.flattenArena("BouncingBall", undefined, "file:///BouncingBall.mo");
if (!arenaBB) throw new Error("Failed to flatten BouncingBall");

console.log("\n=== BouncingBall Simulation ===");
const resBBDopri = simulateArena(arenaBB, { startTime: 0, stopTime: 2.0, step: 0.01, solver: "dopri5" });
console.log(`Dopri5 final h(2.0): ${resBBDopri.y[resBBDopri.y.length - 1][0].toFixed(6)}`);
