// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { ModelScriptCompiler, unwrapNode } from "../src/index.js";

test("Phase 3: Salsa QueryEngine Integration", async (t) => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  await t.test("computes natural alignment struct memory layout", () => {
    const code = `
      @unmanaged
      struct Particle {
        x: f64;
        y: f64;
        id: i32;
        active: bool;
      }
    `;

    const tree = compiler.parse(code);
    const structNode = unwrapNode(tree.rootNode.namedChildren[0]);
    assert.equal(structNode.type, "StructDeclaration");

    const layout = compiler.queries.structLayout(structNode);
    assert.equal(layout.name, "Particle");
    assert.equal(layout.alignment, 8); // f64 alignment dominates

    // x: f64 at offset 0 (size 8)
    // y: f64 at offset 8 (size 8)
    // id: i32 at offset 16 (size 4)
    // active: bool at offset 20 (size 1)
    // total size with tail padding to align 8: 24 bytes
    assert.equal(layout.fields.length, 4);
    assert.equal(layout.fields[0].name, "x");
    assert.equal(layout.fields[0].offset, 0);
    assert.equal(layout.fields[0].size, 8);

    assert.equal(layout.fields[1].name, "y");
    assert.equal(layout.fields[1].offset, 8);
    assert.equal(layout.fields[1].size, 8);

    assert.equal(layout.fields[2].name, "id");
    assert.equal(layout.fields[2].offset, 16);
    assert.equal(layout.fields[2].size, 4);

    assert.equal(layout.fields[3].name, "active");
    assert.equal(layout.fields[3].offset, 20);
    assert.equal(layout.fields[3].size, 1);

    assert.equal(layout.totalSize, 24);
  });

  await t.test("infers expression types correctly", () => {
    const code = `
      let a = 42;
      let b = 3.14;
      let c = a + 10;
      let d = b * 2.0;
      let isOk = c > 50;
      let items = [1, 2, 3];
    `;

    const tree = compiler.parse(code);
    const statements = tree.rootNode.namedChildren.map(unwrapNode);

    // a = 42 -> i32
    const exprA = statements[0].childForFieldName("value");
    assert.deepEqual(compiler.queries.inferExpressionType(exprA), { kind: "i32" });

    // b = 3.14 -> f64
    const exprB = statements[1].childForFieldName("value");
    assert.deepEqual(compiler.queries.inferExpressionType(exprB), { kind: "f64" });

    // isOk = c > 50 -> bool
    const exprC = statements[4].childForFieldName("value");
    assert.deepEqual(compiler.queries.inferExpressionType(exprC), { kind: "bool" });

    // items = [1, 2, 3] -> array of i32
    const exprD = statements[5].childForFieldName("value");
    assert.deepEqual(compiler.queries.inferExpressionType(exprD), {
      kind: "array",
      element: { kind: "i32" },
    });
  });

  await t.test("infers FLWOR projection return collection type", () => {
    const code = `
      let result = for x in data
        where x.active == true
        return x.val * 1.5;
    `;

    const tree = compiler.parse(code);
    const statement = unwrapNode(tree.rootNode.namedChildren[0]);
    const flworExpr = statement.childForFieldName("value");
    const inferred = compiler.queries.inferExpressionType(flworExpr);

    assert.deepEqual(inferred, {
      kind: "array",
      element: { kind: "f64" },
    });
  });

  await t.test("memoizes queries and invalidates on revision change", () => {
    const code = `
      @unmanaged
      struct CacheTest {
        val: i32;
      }
    `;

    const tree = compiler.parse(code);
    const structNode = unwrapNode(tree.rootNode.namedChildren[0]);

    const l1 = compiler.queries.structLayout(structNode);
    const l2 = compiler.queries.structLayout(structNode);
    assert.equal(l1, l2); // Same object reference from memoized cache

    compiler.queries.incrementRevision();
    const l3 = compiler.queries.structLayout(structNode);
    assert.deepEqual(l3, l1);
    assert.notEqual(l3, l1); // Recomputed because of revision increment
  });
});
