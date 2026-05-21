/**
 * Quick test: run a simple model through both flattenDAE (legacy) and
 * flattenArena (query) paths and compare the output.
 */
import { ArenaDAEPrinter } from "@modelscript/compiler";
import Modelica from "@modelscript/modelica/parser";
import { StringWriter } from "@modelscript/utils";
import Parser from "tree-sitter";
import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const models = [
  `model Simple
  Real x(start = 1.0);
equation
  der(x) = -x;
end Simple;`,
  `model TwoVars
  Real x(start = 1.0);
  Real y(start = 0.0);
  parameter Real a = 2.0;
equation
  der(x) = -a * x;
  y = x^2;
end TwoVars;`,
  `model WithParam
  parameter Real R = 100;
  parameter Real C = 0.01;
  Real v(start = 1.0);
equation
  der(v) = -v / (R * C);
end WithParam;`,
];

for (const src of models) {
  const nameMatch = src.match(/model\s+(\w+)/);
  const name = nameMatch?.[1] ?? "Unknown";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Model: ${name}`);
  console.log("=".repeat(60));

  // Legacy path
  const ctx1 = new Context(new NodeFileSystem());
  ctx1.load(src);
  const dae = ctx1.flattenDAE(name);
  let legacyText = "";
  if (dae) {
    const out = new StringWriter();
    const printer = new ArenaDAEPrinter(out, dae.arena);
    printer.printDAE(dae.arena);
    legacyText = out.toString().trim();
  }

  // Arena path
  const ctx2 = new Context(new NodeFileSystem());
  ctx2.load(src);
  const arena = ctx2.flattenArena(name);
  let arenaText = "";
  if (arena) {
    const out = new StringWriter();
    const printer = new ArenaDAEPrinter(out, arena);
    printer.printDAE(arena);
    arenaText = out.toString().trim();
  }

  if (legacyText === arenaText) {
    console.log("✅ MATCH");
    console.log(legacyText);
  } else {
    console.log("❌ MISMATCH");
    console.log("--- Legacy ---");
    console.log(legacyText || "(null)");
    console.log("--- Arena ---");
    console.log(arenaText || "(null)");
  }
}
