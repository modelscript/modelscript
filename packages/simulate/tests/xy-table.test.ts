// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsmfControlGraph } from "../src/solvers/emt/elements/csmf-controls.js";

const noSense = () => 0;

const evalAt = (u: number, extra: Record<string, number> = {}): number => {
  const g = new CsmfControlGraph(
    [
      { id: "x", kind: "const", value: u },
      {
        id: "t",
        kind: "xy_table",
        inputs: ["x"],
        params: { N: 4, X1: 0, Y1: 1.3, X2: 1, Y2: 1.2, X3: 2, Y3: 1.1, X4: 3, Y4: 1.0, ...extra },
      },
    ],
    1e-3,
  );
  g.step(noSense, noSense);
  return g.getOutput("t");
};

describe("xy_table (xy_transfer_function)", () => {
  it("interpolates linearly between points", () => {
    assert.ok(Math.abs(evalAt(0.5) - 1.25) < 1e-12);
    assert.ok(Math.abs(evalAt(2.5) - 1.05) < 1e-12);
  });
  it("hits the table points exactly", () => {
    assert.equal(evalAt(1), 1.2);
    assert.equal(evalAt(3), 1.0);
  });
  it("holds the end values outside the range", () => {
    assert.equal(evalAt(-5), 1.3);
    assert.equal(evalAt(99), 1.0);
  });
  it("applies Ky and Yoff", () => {
    assert.ok(Math.abs(evalAt(1, { Ky: 2, Yoff: 0.5 }) - 2.9) < 1e-12);
  });
  it("skips points that did not evaluate to numbers", () => {
    assert.ok(Math.abs(evalAt(1.5, { X3: Number.NaN }) - 1.15) < 1e-12);
  });
});
