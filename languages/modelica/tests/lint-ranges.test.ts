// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

function sliceDiagnostic(source: string, d: any): string {
  if (typeof d.startOffset === "number" && typeof d.endOffset === "number") {
    return source.slice(d.startOffset, d.endOffset);
  }
  const startLine = d.range ? d.range.start.line : (d.startLine ?? 1) - 1;
  const startCol = d.range ? d.range.start.character : (d.startColumn ?? 1) - 1;
  const endLine = d.range ? d.range.end.line : (d.endLine ?? 1) - 1;
  const endCol = d.range ? d.range.end.character : (d.endColumn ?? 1) - 1;

  const lines = source.split(/\r?\n/);
  if (startLine === endLine) {
    return (lines[startLine] ?? "").slice(startCol, endCol);
  }
  const chunks: string[] = [];
  chunks.push((lines[startLine] ?? "").slice(startCol));
  for (let i = startLine + 1; i < endLine; i++) {
    chunks.push(lines[i] ?? "");
  }
  chunks.push((lines[endLine] ?? "").slice(0, endCol));
  return chunks.join("\n");
}

describe("Modelica Diagnostic Source Range Narrowing", () => {
  let parser: any;
  let facade: any;

  before(async () => {
    const res = await createWasmParser(modelicaWasm);
    parser = res.parser;
    facade = res.facade;
    Context.registerParser(".mo", parser as any);
  });

  function getCstDiagnostics(source: string): any[] {
    const root = facade.parseIncremental(source, 0, 0, source.length, "file:///test.mo");
    assert.ok(root > 0, "Expected valid CST root");
    return facade.getDiagnostics(root, 0, 0, source);
  }

  it("narrows M5001 equationTypeMismatch to the mismatched RHS literal and preserves message", () => {
    const source = `
model M5001RangeTest
  Real x;
equation
  x = "hello";
end M5001RangeTest;
`;
    const diags = getCstDiagnostics(source);
    const m5001 = diags.find((d: any) => d.code === 5001);

    assert.ok(m5001, `Expected M5001 diagnostic in ${JSON.stringify(diags)}`);
    assert.strictEqual(sliceDiagnostic(source, m5001), '"hello"');
    assert.ok(m5001.message.includes("Type mismatch in equation"), `Unexpected message: ${m5001.message}`);
  });

  it("narrows M3001 typeMismatchBinding to the RHS literal", () => {
    const source = `
model M3001RangeTest
  Real x = "bad";
end M3001RangeTest;
`;
    const diags = getCstDiagnostics(source);
    const m3001 = diags.find((d: any) => d.code === 3001);

    assert.ok(m3001, `Expected M3001 diagnostic in ${JSON.stringify(diags)}`);
    assert.strictEqual(sliceDiagnostic(source, m3001), '"bad"');
  });

  it("narrows M5006 assignmentTypeMismatch to the RHS value expression", () => {
    const source = `
function M5006RangeTest
  output Real y;
algorithm
  y := "bad";
end M5006RangeTest;
`;
    const diags = getCstDiagnostics(source);
    const m5006 = diags.find((d: any) => d.code === 5006);

    assert.ok(m5006, `Expected M5006 diagnostic in ${JSON.stringify(diags)}`);
    assert.strictEqual(sliceDiagnostic(source, m5006), '"bad"');
  });

  it("narrows M5004 connectFlowMismatch to the non-flow connector reference", () => {
    const source = `
connector FlowPin
  flow Real i;
end FlowPin;

connector PotentialPin
  Real v;
end PotentialPin;

model M5004RangeTest
  FlowPin a;
  PotentialPin b;
equation
  connect(a, b);
end M5004RangeTest;
`;
    const diags = getCstDiagnostics(source);
    const m5004 = diags.find((d: any) => d.code === 5004);

    assert.ok(m5004, `Expected M5004 diagnostic in ${JSON.stringify(diags)}`);
    const sliced = sliceDiagnostic(source, m5004);
    assert.ok(sliced === "a" || sliced === "b", `Expected narrow connector ref, got: ${JSON.stringify(sliced)}`);
  });

  it("narrows whenIllegalContext to the 'when' keyword", () => {
    const source = `
function AlgoCheck
  input Real x;
  output Real y;
algorithm
  y := 0;
  when x > 1 then
    y := 1;
  end when;
end AlgoCheck;
`;
    const diags = getCstDiagnostics(source);
    const whenDiag = diags.find((d: any) => d.code !== 4130 && d.message?.toLowerCase().includes("when"));

    assert.ok(whenDiag, `Expected when-context diagnostic in ${JSON.stringify(diags)}`);
    assert.strictEqual(sliceDiagnostic(source, whenDiag), "when");
  });

  it("does not include leading spaces after ':=' in M5021 CFA uninitialized read", async () => {
    const ctx = new Context(new NodeFileSystem());
    const source = `
function M5021SpaceTest
  output Real y;
protected
  Real z;
algorithm
  y :=   z + 1;
end M5021SpaceTest;
`;
    const uri = "file:///test/M5021SpaceTest.mo";
    ctx.load(source, uri);
    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5021 = diags.find(
      (d: any) => d.code === 5021 || d.message?.includes("read before being definitely assigned"),
    );

    assert.ok(m5021, `Expected M5021 diagnostic in ${JSON.stringify(diags)}`);
    const sliced = sliceDiagnostic(source, m5021);
    assert.strictEqual(sliced, sliced.trim(), `Unexpected whitespace in slice: ${JSON.stringify(sliced)}`);
  });

  it("narrows M4062 external object diagnostic to identifier name via Salsa lint", async () => {
    const ctx = new Context(new NodeFileSystem());
    const source = `
class MyExtObj
  extends ExternalObject;
end MyExtObj;

model ExtHolder
  MyExtObj obj;
end ExtHolder;
`;
    const uri = "file:///test/M4062RangeTest.mo";
    ctx.load(source, uri);
    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const extDiag = diags.find((d: any) => d.code === 4062 || d.message?.includes("ExternalObject"));
    if (extDiag) {
      const sliced = sliceDiagnostic(source, extDiag);
      assert.strictEqual(sliced, sliced.trim(), `Unexpected whitespace in slice: ${JSON.stringify(sliced)}`);
      assert.ok(!sliced.includes("\n"), `Expected single-token identifier slice, got: ${JSON.stringify(sliced)}`);
    }
  });
});
