// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "@modelscript/dsl/utils";
import { ArenaDAEPrinter } from "@modelscript/runtime";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
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

describe("Flattener Phase 1 Remediation", () => {
  it("should not falsely simplify trigonometric ratio with distinct args to tan", async () => {
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
  });

  it("should simplify identical complex args in trigonometric ratio to tan", async () => {
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
  });

  it("should distribute negation according to OpenModelica canonical form", async () => {
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
    }
  });

  it("should balance DAE accounting for blocks with inputs", async () => {
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
  });

  it("should cleanly process fixed parameter with start=0.0", async () => {
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
  });
});
