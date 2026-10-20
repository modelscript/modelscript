// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsmfControlGraph } from "../src/solvers/emt/elements/csmf-controls.js";

const noSense = () => 0;
const dt = 5e-5;

/** Steady-state amplitude gain of trans_filt for a sine at `f` Hz. */
const gainAt = (f: number, params: Record<string, number>): number => {
  const g = new CsmfControlGraph(
    [
      { id: "x", kind: "const", value: 0 },
      { id: "f", kind: "trans_filt", inputs: ["x"], params },
    ],
    dt,
  );
  const n = Math.round(40 / (f * dt));
  let peak = 0;
  for (let k = 0; k < n; k++) {
    g.blocks[g.blockMap.get("x")!]!.config.value = Math.sin(2 * Math.PI * f * k * dt);
    g.step(noSense, noSense);
    if (k > n / 2) peak = Math.max(peak, Math.abs(g.getOutput("f")));
  }
  return peak;
};

const lp = (order: number, fc: number): Record<string, number> => ({ Order: order, Band: 1, Type: 1, FBase: fc });

describe("trans_filt", () => {
  it("passes DC with unity gain and no start-up transient", () => {
    const g = new CsmfControlGraph(
      [
        { id: "x", kind: "const", value: 3 },
        { id: "f", kind: "trans_filt", inputs: ["x"], params: lp(2, 1000) },
      ],
      dt,
    );
    for (let k = 0; k < 5; k++) g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("f") - 3) < 1e-9, String(g.getOutput("f")));
  });

  it("is -3 dB at the cut-off (order 2 and order 1)", () => {
    assert.ok(Math.abs(gainAt(1000, lp(2, 1000)) - Math.SQRT1_2) < 0.01);
    assert.ok(Math.abs(gainAt(1000, lp(1, 1000)) - Math.SQRT1_2) < 0.01);
  });

  it("attenuates a decade above the cut-off by ~40 dB (order 2)", () => {
    const g = gainAt(2000, lp(2, 200));
    assert.ok(g < 0.02 && g > 0.004, String(g));
  });

  it("passes unsupported configurations through unchanged", () => {
    assert.ok(Math.abs(gainAt(5000, { Order: 4, Band: 1, Type: 1, FBase: 1000 }) - 1) < 1e-9);
    assert.ok(Math.abs(gainAt(5000, { Order: 2, Band: 2, Type: 1, FBase: 1000 }) - 1) < 1e-9);
  });
});
