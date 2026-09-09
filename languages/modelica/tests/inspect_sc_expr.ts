import { createWasmParser } from "@modelscript/modelica/parser";
import { evaluateArenaRuntime } from "@modelscript/runtime";
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

const arena = context.flattenArena("SimpleCircuit");
if (!arena) throw new Error("Failed to flatten SimpleCircuit");
const eq0Lhs = arena.getEqLhs(0);
const eq0Rhs = arena.getEqRhs(0);
console.log("Eq 0 lhs kind:", arena.getExprKind(eq0Lhs), "data1:", arena.getExprData1(eq0Lhs));
console.log(
  "Eq 0 rhs kind:",
  arena.getExprKind(eq0Rhs),
  "left:",
  arena.getExprLeft(eq0Rhs),
  "right:",
  arena.getExprRight(eq0Rhs),
);

const env = new Float64Array(1000);
const rId = arena.interner.intern("R");
const cId = arena.interner.intern("C");
const vId = arena.interner.intern("V");

env[rId] = 10;
env[cId] = 0.01;
env[vId] = 5;
console.log("Eval with V=5:", evaluateArenaRuntime(arena, eq0Rhs, env));

env[vId] = 2;
console.log("Eval with V=2:", evaluateArenaRuntime(arena, eq0Rhs, env));
