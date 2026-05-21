/**
 * Phase 2 parity test: extends, modifications, inner/outer, enums, 2D arrays
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

interface TestCase {
  name: string;
  src: string;
  className: string;
}

const tests: TestCase[] = [
  {
    name: "Single extends",
    className: "Child",
    src: `model Base
  Real x(start = 1.0);
equation
  der(x) = -x;
end Base;

model Child
  extends Base;
  Real y;
equation
  y = 2.0 * x;
end Child;`,
  },
  {
    name: "Extends with modification",
    className: "Modified",
    src: `model Base
  parameter Real k = 1.0;
  Real x(start = 0.0);
equation
  der(x) = -k * x;
end Base;

model Modified
  extends Base(k = 5.0);
end Modified;`,
  },
  {
    name: "Protected section",
    className: "WithProtected",
    src: `model WithProtected
  Real x(start = 1.0);
protected
  parameter Real k = 2.0;
equation
  der(x) = -k * x;
end WithProtected;`,
  },
  {
    name: "Built-in functions (abs, sqrt, sign)",
    className: "BuiltinFuncs",
    src: `model BuiltinFuncs
  Real x(start = 1.0);
  Real y;
  Real z;
equation
  der(x) = -x;
  y = abs(x);
  z = sqrt(x);
end BuiltinFuncs;`,
  },
  {
    name: "Multi-level extends (A→B→C)",
    className: "C",
    src: `model A
  Real x(start = 1.0);
equation
  der(x) = -x;
end A;

model B
  extends A;
  Real y;
equation
  y = 2.0 * x;
end B;

model C
  extends B;
  Real z;
equation
  z = x + y;
end C;`,
  },
  {
    name: "If-equation with parameter condition",
    className: "WithIf",
    src: `model WithIf
  parameter Boolean useHighK = true;
  parameter Real kLow = 1.0;
  parameter Real kHigh = 10.0;
  Real x(start = 1.0);
equation
  if useHighK then
    der(x) = -kHigh * x;
  else
    der(x) = -kLow * x;
  end if;
end WithIf;`,
  },
];

for (const test of tests) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Test: ${test.name}`);
  console.log("=".repeat(60));

  // Legacy path
  const ctx1 = new Context(new NodeFileSystem());
  ctx1.load(test.src);
  const dae = ctx1.flattenDAE(test.className);
  let legacyText = "";
  if (dae) {
    const out = new StringWriter();
    const printer = new ArenaDAEPrinter(out, dae.arena);
    printer.printDAE(dae.arena);
    legacyText = out.toString().trim();
  }

  // Arena path
  const ctx2 = new Context(new NodeFileSystem());
  ctx2.load(test.src);
  const arena = ctx2.flattenArena(test.className);
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
