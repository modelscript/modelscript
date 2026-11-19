// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeSolidAABB } from "@modelscript/cad";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateScad } from "../src/evaluator.js";
import { getScadParser, ScadPatcher } from "../src/index.js";

describe("OpenSCAD +Z-up Cylinder & ScadPatcher Affine Expression Inversion", () => {
  it("evaluates uncentered cylinder along canonical +Z axis [0, h]", async () => {
    const parser = await getScadParser();
    const tree = parser.parse("cylinder(r = 5, h = 20);");
    assert.ok(tree?.rootNode);
    const solid = evaluateScad(tree.rootNode);
    assert.ok(solid, "Expected evaluated solid");
    const boxBounds = computeSolidAABB(solid);
    assert.deepStrictEqual(boxBounds.min, [-5, -5, 0]);
    assert.deepStrictEqual(boxBounds.max, [5, 5, 20]);
  });

  it("inverts single-variable affine cube & cylinder dimension formulas back to driving variable", async () => {
    const parser = await getScadParser();
    const src = `w = 10;\ncube([w * 2 + 4, 15, 5]);`;
    const tree = parser.parse(src);
    assert.ok(tree?.rootNode);

    const res = ScadPatcher.patchPrimitiveDimension(src, tree.rootNode, 0, 44, undefined, "w", "cube");
    assert.ok(res);
    assert.strictEqual(res.locked ?? false, false);
    assert.strictEqual(res.invertedVariable, "w");
    assert.ok(res.updatedSource.includes("w = 20;"), `Expected w = 20;, got:\n${res.updatedSource}`);
    assert.ok(res.updatedSource.includes("w * 2 + 4"), "Symbolic formula w * 2 + 4 must be preserved");
  });

  it("inverts transitive single-variable variable chains safely", async () => {
    const parser = await getScadParser();
    const src = `base = 5;\nscaled = base * 2;\ncube([scaled + 2, 10, 10]);`;
    const tree = parser.parse(src);
    assert.ok(tree?.rootNode);

    // target scaled + 2 = 22 => scaled = 20 => base * 2 = 20 => base = 10
    const res = ScadPatcher.patchPrimitiveDimension(src, tree.rootNode, 0, 22, undefined, "scaled", "cube");
    assert.ok(res);
    assert.strictEqual(res.locked ?? false, false);
    assert.strictEqual(res.invertedVariable, "base");
    assert.ok(res.updatedSource.includes("base = 10;"), `Expected base = 10;, got:\n${res.updatedSource}`);
    assert.ok(res.updatedSource.includes("scaled = base * 2;"));
  });

  it("explicitly locks multi-variable and non-affine expressions without corrupting source", async () => {
    const parser = await getScadParser();
    const src = `w1 = 10;\nw2 = 5;\ncube([w1 + w2, 20, 10]);`;
    const tree = parser.parse(src);
    assert.ok(tree?.rootNode);

    const res = ScadPatcher.patchPrimitiveDimension(src, tree.rootNode, 0, 30, undefined, "w1", "cube");
    assert.ok(res);
    assert.strictEqual(res.locked, true);
    assert.deepStrictEqual(res.lockedVariables, ["w1", "w2"]);
    assert.ok(res.lockReason?.includes("w1, w2"), `Expected lockReason mentioning w1, w2, got: ${res.lockReason}`);
    assert.strictEqual(res.updatedSource, src);
  });

  it("inverts single-var transform offsets and locks multi-var transform vectors", async () => {
    const parser = await getScadParser();
    const affineSrc = `dx = 10;\ntranslate([dx * 2 + 5, 0, 0]) cube([5, 5, 5]);`;
    const affineTree = parser.parse(affineSrc);
    const resOk = ScadPatcher.patchTransformArgument(affineSrc, affineTree.rootNode, "translate", 0, [45, 0, 0]);
    assert.ok(resOk);
    assert.strictEqual(resOk.locked ?? false, false);
    assert.ok(resOk.updatedSource.includes("dx = 20;"), `Expected dx = 20;, got:\n${resOk.updatedSource}`);

    const multiSrc = `x1 = 10;\nx2 = 5;\ntranslate([x1 + x2, 0, 0]) cube([5, 5, 5]);`;
    const multiTree = parser.parse(multiSrc);
    const resLock = ScadPatcher.patchTransformArgument(multiSrc, multiTree.rootNode, "translate", 0, [25, 0, 0]);
    assert.ok(resLock);
    assert.strictEqual(resLock.locked, true);
    assert.strictEqual(resLock.updatedSource, multiSrc);
  });

  it("maps dimensionParams per slot without leaking literals, compound formulas, or $fn", async () => {
    const parser = await getScadParser();
    const unwrapMeta = (s: any): any => (s?.sourceMetadata ? s.sourceMetadata : s?.child ? unwrapMeta(s.child) : null);

    // 1. Mixed literal and variable slots in cube vector
    const t1 = parser.parse(`width = 25;\ncube([10, width, 5]);`);
    const m1 = unwrapMeta(evaluateScad(t1.rootNode));
    assert.deepStrictEqual(m1?.dimensionParams, [undefined, "width", undefined]);

    // 2. Multi-variable formula in X must not mis-attribute Y/Z to 'clearance'/'height'
    const t2 = parser.parse(
      `width = 10;\nclearance = 2;\nheight = 15;\ndepth = 8;\ncube([width * 2 + clearance, height, depth]);`,
    );
    const m2 = unwrapMeta(evaluateScad(t2.rootNode));
    assert.deepStrictEqual(m2?.dimensionParams, [undefined, "height", "depth"]);

    // 3. Cylinder named args (h, r) map to [radial, height, radial] ignoring $fn
    const t3 = parser.parse(`height = 30;\nrad = 6;\nsegs = 24;\ncylinder(h = height, r = rad, $fn = segs);`);
    const m3 = unwrapMeta(evaluateScad(t3.rootNode));
    assert.deepStrictEqual(m3?.dimensionParams, ["rad", "height", "rad"]);

    // 4. Sphere with literal radius and variable $fn must not blame $fn variable
    const t4 = parser.parse(`segs = 24;\nsphere(r = 10, $fn = segs);`);
    const m4 = unwrapMeta(evaluateScad(t4.rootNode));
    assert.strictEqual(m4?.parameterName, undefined);
    assert.strictEqual(m4?.dimensionParams, undefined);
  });
});
