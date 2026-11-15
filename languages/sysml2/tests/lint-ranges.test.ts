// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "../src/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

function sliceOffset(source: string, d: { startOffset?: number; endOffset?: number }): string {
  if (typeof d.startOffset === "number" && typeof d.endOffset === "number") {
    return source.slice(d.startOffset, d.endOffset);
  }
  return "";
}

describe("SysML v2 Diagnostic Source Range Narrowing", () => {
  it("prevents child body fieldRanges from polluting parent declaredName on empty definition lint", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();
    const source = `
part def OuterEmpty {
  part inner : MissingType;
}
`;
    const uri = "file:///test/NestedFieldRange.sysml";
    const tree = parser.parse(source);
    ws.register(uri, () => (tree ? (tree.rootNode as any) : null));
    const unified = await ws.getIndexAsync();
    const qe = createSysML2QueryEngine(unified, tree);
    const db = qe.toQueryDB();

    const outer = db.byName("OuterEmpty")[0];
    assert.ok(outer, "Expected OuterEmpty symbol");
    assert.ok(outer.fieldRanges?.declaredName, "Expected OuterEmpty declaredName fieldRange");
    const outerNameSlice = source.slice(
      outer.fieldRanges.declaredName.startOffset,
      outer.fieldRanges.declaredName.endOffset,
    );
    assert.strictEqual(outerNameSlice, "OuterEmpty");

    const diags = await qe.runAllLintsAsync(uri);
    for (const d of diags) {
      const sliced = sliceOffset(source, d);
      if (sliced) {
        assert.strictEqual(
          sliced,
          sliced.trim(),
          `Diagnostic has leading/trailing whitespace: ${JSON.stringify(sliced)}`,
        );
        assert.notStrictEqual(sliced, "part", "Diagnostic should not highlight 'part' keyword alone");
      }
    }
  });

  it("narrows S3004 invalid multiplicity bounds to the bounds span, not 'part'", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();
    const source = `
part def Vehicle {
  part wheel[5..2];
}
`;
    const uri = "file:///test/MultiplicityBounds.sysml";
    const tree = parser.parse(source);
    ws.register(uri, () => (tree ? (tree.rootNode as any) : null));
    const unified = await ws.getIndexAsync();
    const qe = createSysML2QueryEngine(unified, tree);

    const diags = await qe.runAllLintsAsync(uri);
    const s3004 = diags.find((d: any) => d.code === 3004);
    assert.ok(s3004, `Expected S3004 diagnostic for [5..2] in ${JSON.stringify(diags)}`);
    const sliced = sliceOffset(source, s3004);
    assert.ok(
      sliced.includes("5") && sliced.includes("2"),
      `Expected multiplicity bounds slice, got: ${JSON.stringify(sliced)}`,
    );
    assert.ok(!sliced.startsWith("part"), `S3004 should not start on 'part', got: ${JSON.stringify(sliced)}`);
  });

  it("narrows S3005 / S3006 requirement reference diagnostics away from leading keywords", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();
    const source = `
part def BrakeSystem;
part def Car {
  part brakes : BrakeSystem;
  satisfy BrakeSystem by brakes;
}
`;
    const uri = "file:///test/SatisfyTarget.sysml";
    const tree = parser.parse(source);
    ws.register(uri, () => (tree ? (tree.rootNode as any) : null));
    const unified = await ws.getIndexAsync();
    const qe = createSysML2QueryEngine(unified, tree);

    const diags = await qe.runAllLintsAsync(uri);
    const s3005 = diags.find((d: any) => d.code === 3005);
    if (s3005) {
      const sliced = sliceOffset(source, s3005);
      assert.ok(
        !sliced.startsWith("satisfy"),
        `S3005 should not highlight 'satisfy' keyword, got: ${JSON.stringify(sliced)}`,
      );
    }
  });
});
