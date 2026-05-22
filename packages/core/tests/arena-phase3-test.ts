/**
 * Phase 3 parity test: composite components, for-equations, when-equations,
 * enumeration types, connect equations, and named function arguments.
 *
 * Runs each model through both the legacy (flattenDAE) and arena (flattenArena)
 * pipelines, comparing the printed DAE output for parity.
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
  // ── Composite component with extends ──
  {
    name: "Composite component (B x where B extends A)",
    className: "Top",
    src: `model A
  Real v(start = 0.0);
end A;

model B
  extends A;
  Real i;
end B;

model Top
  B comp;
equation
  comp.v = 1.0;
  comp.i = 2.0;
end Top;`,
  },

  // ── For-equation with range ──
  {
    name: "For-equation with integer range",
    className: "ForEq",
    src: `model ForEq
  Real x[3];
equation
  for i in 1:3 loop
    x[i] = i * 1.0;
  end for;
end ForEq;`,
  },

  // ── When-equation ──
  {
    name: "When-equation (event-driven)",
    className: "WhenModel",
    src: `model WhenModel
  Real x(start = 1.0);
  discrete Real y(start = 0.0);
equation
  der(x) = -x;
  when x < 0.5 then
    y = x;
  end when;
end WhenModel;`,
  },

  // ── Multiple equation sections ──
  {
    name: "Multiple equation sections",
    className: "MultiSections",
    src: `model MultiSections
  Real x(start = 1.0);
  Real y(start = 0.0);
equation
  der(x) = -x;
equation
  der(y) = x;
end MultiSections;`,
  },

  // ── Initial equation section ──
  {
    name: "Initial equation section",
    className: "InitEq",
    src: `model InitEq
  Real x;
equation
  der(x) = -x;
initial equation
  x = 1.0;
end InitEq;`,
  },

  // ── Nested if-equation with elseif ──
  {
    name: "If-equation with elseif branches",
    className: "IfElseIf",
    src: `model IfElseIf
  parameter Integer mode = 2;
  Real x(start = 1.0);
equation
  if mode == 1 then
    der(x) = -x;
  elseif mode == 2 then
    der(x) = -2.0 * x;
  else
    der(x) = -3.0 * x;
  end if;
end IfElseIf;`,
  },

  // ── Algorithm section ──
  {
    name: "Algorithm section with if/assignment",
    className: "AlgoModel",
    src: `model AlgoModel
  Real x(start = 1.0);
  Real y;
equation
  der(x) = -x;
algorithm
  if x > 0.5 then
    y := 1.0;
  else
    y := 0.0;
  end if;
end AlgoModel;`,
  },

  // ── Constant variable ──
  {
    name: "Constant variable",
    className: "WithConst",
    src: `model WithConst
  constant Real pi = 3.14159;
  Real x(start = 0.0);
equation
  der(x) = pi;
end WithConst;`,
  },

  // ── Discrete variable ──
  {
    name: "Discrete variable with start",
    className: "DiscreteModel",
    src: `model DiscreteModel
  Real x(start = 1.0);
  discrete Real count(start = 0.0);
equation
  der(x) = -x;
  when x < 0.5 then
    count = pre(count) + 1.0;
  end when;
end DiscreteModel;`,
  },

  // ── Negation distribution ──
  {
    name: "Negation distribution -(a*b) → (-a)*b",
    className: "NegDist",
    src: `model NegDist
  parameter Real a = 2.0;
  parameter Real b = 3.0;
  Real x(start = 1.0);
equation
  der(x) = -(a * b) * x;
end NegDist;`,
  },

  // ── If-then-else expression ──
  {
    name: "If-then-else expression",
    className: "IfExpr",
    src: `model IfExpr
  parameter Boolean flag = true;
  Real x(start = 1.0);
equation
  der(x) = if flag then -x else -2.0 * x;
end IfExpr;`,
  },

  // ── Partial function application ──
  {
    name: "Partial function application",
    className: "PartialApplication1",
    src: `partial function pf
  input Real x;
  output Real z;
end pf;

function f1
  input Real x;
  input Real y;
  output Real z = x + y;
end f1;

function f2
  input Real x;
  input pf func;
  output Real z = x * func(x);
end f2;

class PartialApplication1
  Real x = f2(time, function f1(y = 2.0));
end PartialApplication1;`,
  },
];

let passed = 0;
let failed = 0;

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
    passed++;
  } else {
    console.log("❌ MISMATCH");
    console.log("--- Legacy ---");
    console.log(legacyText || "(null)");
    console.log("--- Arena ---");
    console.log(arenaText || "(null)");
    failed++;
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`SUMMARY: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
console.log("=".repeat(60));
