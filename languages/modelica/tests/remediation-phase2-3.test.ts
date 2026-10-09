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

async function initContext(files: Record<string, string>) {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);
  const ctx = new Context(new NodeFileSystem());
  for (const [name, src] of Object.entries(files)) {
    const uri = `file:///test/${name}.mo`;
    ctx.load(src, uri);
  }
  return ctx;
}

function printArena(arena: any): string {
  const out = new StringWriter();
  const printer = new ArenaDAEPrinter(out, arena, true);
  printer.printDAE(arena);
  return out.toString().trim();
}

describe("Flattener Phase 2 & 3 Remediation", () => {
  it("should isolate flattener lifecycle state across sequential calls", async () => {
    const model1 = `
model ModelWithInner
  inner parameter Real sharedParam = 42.0;
  Real x;
equation
  x = sharedParam;
end ModelWithInner;
`;
    const model2 = `
model IndependentModel
  Real y;
equation
  y = 10.0;
end IndependentModel;
`;
    const ctx = await initContext({
      ModelWithInner: model1,
      IndependentModel: model2,
    });

    const arena1 = ctx.flattenArena("ModelWithInner", undefined, "file:///test/ModelWithInner.mo");
    assert(arena1 !== null);
    const text1 = printArena(arena1);
    assert(text1.includes("sharedParam"), "ModelWithInner must include sharedParam");

    // Flatten second model immediately using the same flattener
    const arena2 = ctx.flattenArena("IndependentModel", undefined, "file:///test/IndependentModel.mo");
    assert(arena2 !== null);
    const text2 = printArena(arena2);
    assert(!text2.includes("sharedParam"), "IndependentModel must NOT retain any inner parameters from ModelWithInner");
    assert(!arena2.extensionMetadata.expandableBuses?.length, "IndependentModel must have empty expandable buses");
    assert.strictEqual(arena2.getVarCount(), 1, "IndependentModel must have exactly 1 variable");
  });

  it("should instantiate hierarchical components and resolve names correctly", async () => {
    const hierModel = `
model Sub
  Real u;
  Real v;
equation
  v = 2.0 * u;
end Sub;

model Hierarchical
  Sub s1;
  Sub s2;
equation
  s1.u = 1.0;
  s2.u = s1.v;
end Hierarchical;
`;
    const ctx = await initContext({ Hierarchical: hierModel });
    const arena = ctx.flattenArena("Hierarchical", undefined, "file:///test/Hierarchical.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("s1.u"), "Hierarchical model must have s1.u");
    assert(text.includes("s1.v"), "Hierarchical model must have s1.v");
    assert(text.includes("s2.u"), "Hierarchical model must have s2.u");
    assert(text.includes("s2.v"), "Hierarchical model must have s2.v");
  });

  it("should parse and flatten matrix with nested comma arguments accurately", async () => {
    const matrixModel = `
model MatrixWithNestedArgs
  Real M[2, 2] = [max(1.0, 2.0), 3.0; 4.0, min(5.0, 6.0)];
  Real x;
equation
  x = M[1, 1] + M[2, 2];
end MatrixWithNestedArgs;
`;
    const ctx = await initContext({ MatrixWithNestedArgs: matrixModel });
    const arena = ctx.flattenArena("MatrixWithNestedArgs", undefined, "file:///test/MatrixWithNestedArgs.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("M[1,1]"), "Matrix elements must be flattened properly");
    assert(text.includes("M[2,2]"), "Matrix elements must be flattened properly");
  });

  it("should work correctly with scalarization and constant folding in single pass", async () => {
    const simpleFoldModel = `
model SimpleFold
  constant Real a = 10.0;
  constant Real b = 20.0;
  Real x;
equation
  x = a + b;
end SimpleFold;
`;
    const ctx = await initContext({ SimpleFold: simpleFoldModel });
    const arena = ctx.flattenArena("SimpleFold", undefined, "file:///test/SimpleFold.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("30.0"), `Constants must be folded into 30.0. Got: ${text}`);
  });
});
