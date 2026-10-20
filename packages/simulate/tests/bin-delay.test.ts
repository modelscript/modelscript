// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsmfControlGraph } from "../src/solvers/emt/elements/csmf-controls.js";

const noSense = () => 0;

/** Drives bin_delay with a time-dependent input (via a mutable const) and returns the output per step. */
const run = (inputAt: (t: number) => number, params: Record<string, number>, steps: number, dt = 1e-3): number[] => {
  const g = new CsmfControlGraph(
    [
      { id: "x", kind: "const", value: 0 },
      { id: "d", kind: "bin_delay", inputs: ["x"], params },
    ],
    dt,
  );
  const out: number[] = [];
  for (let k = 0; k < steps; k++) {
    g.blocks[g.blockMap.get("x")!]!.config.value = inputAt(k * dt);
    g.step(noSense, noSense);
    out.push(g.getOutput("d"));
  }
  return out;
};

describe("bin_delay", () => {
  it("delays the rising edge by T", () => {
    const o = run((t) => (t >= 0.01 ? 1 : 0), { T: 0.02, Toff: 0, INITST: 0 }, 60);
    assert.equal(o[10], 0);
    assert.equal(o[25], 0);
    assert.equal(o[40], 1);
  });

  it("delays the falling edge by Toff", () => {
    const o = run((t) => (t < 0.01 ? 1 : 0), { T: 0, Toff: 0.02, INITST: 1 }, 60);
    assert.equal(o[5], 1);
    assert.equal(o[20], 1);
    assert.equal(o[40], 0);
  });

  it("swallows a pulse shorter than the on-delay", () => {
    const o = run((t) => (t >= 0.01 && t < 0.015 ? 1 : 0), { T: 0.02, Toff: 0.02, INITST: 0 }, 60);
    assert.ok(o.every((v) => v === 0));
  });

  it("starts at INITST", () => {
    const o = run(() => 1, { T: 0.5, Toff: 0.5, INITST: 0 }, 5);
    assert.equal(o[0], 0);
    const o2 = run(() => 0, { T: 0.5, Toff: 0.5, INITST: 1 }, 5);
    assert.equal(o2[0], 1);
  });
});
