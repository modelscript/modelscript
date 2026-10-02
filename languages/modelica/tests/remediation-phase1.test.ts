// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "@modelscript/dsl/utils";
import { ArenaDAEPrinter } from "@modelscript/runtime";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function initContext(src: string, modelName: string) {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);
  const ctx = new Context(new NodeFileSystem());
  const uri = `file:///test/${modelName}.mo`;
  ctx.load(src, uri);
  return { ctx, uri };
}

function printArena(arena: any): string {
  const out = new StringWriter();
  const printer = new ArenaDAEPrinter(out, arena, true);
  printer.printDAE(arena);
  return out.toString().trim();
}

async function runTests() {
  console.log("Testing Flattener Phase 1 Remediation...");

  // 1. Trig ratio simplification: distinct args must NOT simplify to tan
  console.log("1. Testing trigonometric ratio simplification...");
  {
    const distinctArgsModel = `
model TrigDistinct
  Real x;
  Real y;
equation
  y = sin(x + 1.0) / cos(x + 2.0);
end TrigDistinct;
`;
    const { ctx, uri } = await initContext(distinctArgsModel, "TrigDistinct");
    const arena = ctx.flattenArena("TrigDistinct", undefined, uri);
    assert(arena !== null);
    const text = printArena(arena);
    assert(!text.includes("tan("), "sin(x + 1.0) / cos(x + 2.0) must NOT simplify to tan");
    assert(text.includes("sin(") && text.includes("cos("), "must retain sin and cos for distinct arguments");
    console.log("   ✔ Distinct args do not falsely simplify to tan");
  }

  {
    const sameArgsModel = `
model TrigSame
  Real x;
  Real y;
equation
  y = sin(x + 1.0) / cos(x + 1.0);
end TrigSame;
`;
    const { ctx, uri } = await initContext(sameArgsModel, "TrigSame");
    const arena = ctx.flattenArena("TrigSame", undefined, uri);
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("tan("), "sin(x + 1.0) / cos(x + 1.0) MUST simplify to tan");
    console.log("   ✔ Identical complex args correctly simplify to tan");
  }

  // 2. Negation distribution: -(a * b) => (-a) * b, -(a / b) => (-a) / b, -(-a) => a
  console.log("2. Testing negation distribution & double negation...");
  {
    const negModel = `
model NegDistribute
  Real a;
  Real b;
  Real y1;
  Real y2;
  Real y3;
equation
  y1 = -(a * b);
  y2 = -(a / b);
  y3 = -(-a);
end NegDistribute;
`;
    for (const backend of ["ts", "hybrid"] as const) {
      const { ctx, uri } = await initContext(negModel, `NegDistribute_${backend}`);
      const arena = ctx.flattenArena("NegDistribute", undefined, uri, { backend });
      assert(arena !== null);
      const text = printArena(arena);
      // -(a * b) => (-a) * b
      assert(
        text.includes("(-a) * b") || text.includes("-a * b"),
        `[${backend}] Expected negation on left factor: ${text}`,
      );
      // -(a / b) => (-a) / b
      assert(
        text.includes("(-a) / b") || text.includes("-a / b"),
        `[${backend}] Expected negation on numerator: ${text}`,
      );
      // -(-a) => a
      assert(text.includes("y3 = a"), `[${backend}] Expected double negation cancellation: ${text}`);
      console.log(`   ✔ [backend: ${backend}] Negation distribution matches OpenModelica canonical form`);
    }
  }

  // 3. Balance accounting on blocks with inputs
  console.log("3. Testing DAE balance accounting for blocks with inputs...");
  {
    const blockModel = `
block FilterBlock
  input Real u;
  output Real y;
equation
  y = 2.0 * u;
end FilterBlock;
`;
    const { ctx, uri } = await initContext(blockModel, "FilterBlock");
    const arena = ctx.flattenArena("FilterBlock", undefined, uri);
    assert(arena !== null);
    const unbalanced = arena!.diagnostics.filter((d: any) => d.code === 4004 || d.rule === "unbalanced-model");
    assert.strictEqual(unbalanced.length, 0, "Block with 1 input, 1 output, and 1 equation should be balanced");
    console.log("   ✔ Block with input correctly accounted as balanced");
  }

  // 4. Fixed parameter with start=0.0
  console.log("4. Testing fixed parameter evaluation with start=0.0...");
  {
    const fixedParamModel = `
model FixedZero
  parameter Real p(fixed = true, start = 0.0);
  Real y;
equation
  y = p + 2.0;
end FixedZero;
`;
    const { ctx, uri } = await initContext(fixedParamModel, "FixedZero");
    const arena = ctx.flattenArena("FixedZero", undefined, uri);
    assert(arena !== null);
    const text = printArena(arena);
    assert(arena!.varCount >= 2, "Expected variables to be present");
    console.log("   ✔ Fixed parameter start=0.0 processed cleanly");
  }

  console.log("\nAll Phase 1 remediation tests passed successfully!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
