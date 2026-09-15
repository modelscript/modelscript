// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { AffineMatrix2D } from "../src/affine-matrix.js";

describe("AffineMatrix2D (Mathematical Coordinate Systems)", () => {
  it("computes identity transform", () => {
    const m = AffineMatrix2D.identity();
    const p = m.transformPoint({ x: 10, y: 20 });
    assert.strictEqual(p.x, 10);
    assert.strictEqual(p.y, 20);
  });

  it("computes translation", () => {
    const m = AffineMatrix2D.translation(50, -30);
    const p = m.transformPoint({ x: 10, y: 20 });
    assert.strictEqual(p.x, 60);
    assert.strictEqual(p.y, -10);
  });

  it("computes 90-degree rotation", () => {
    const m = AffineMatrix2D.rotation(90);
    const p = m.transformPoint({ x: 10, y: 0 });
    assert.ok(Math.abs(p.x - 0) < 1e-6);
    assert.ok(Math.abs(p.y - 10) < 1e-6);
  });

  it("inverts Y axis symmetrically", () => {
    const m = AffineMatrix2D.identity().invertY();
    const p = m.transformPoint({ x: 15, y: 25 });
    assert.strictEqual(p.x, 15);
    assert.strictEqual(p.y, -25);
  });

  it("transforms rectangular extent bounds", () => {
    const m = AffineMatrix2D.translation(100, 200).scale(2, 3);
    const extent = m.transformExtent([
      [0, 0],
      [10, 20],
    ]);
    assert.strictEqual(extent[0][0], 100);
    assert.strictEqual(extent[0][1], 200);
    assert.strictEqual(extent[1][0], 120);
    assert.strictEqual(extent[1][1], 260);
  });

  it("inverts transformation matrix", () => {
    const m = AffineMatrix2D.translation(40, 60).rotate(45);
    const inv = m.inverse();
    const orig = { x: 12, y: 34 };
    const transformed = m.transformPoint(orig);
    const recovered = inv.transformPoint(transformed);
    assert.ok(Math.abs(recovered.x - orig.x) < 1e-5);
    assert.ok(Math.abs(recovered.y - orig.y) < 1e-5);
  });
});
