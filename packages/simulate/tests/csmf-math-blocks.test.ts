// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsmfControlGraph } from "../src/solvers/emt/elements/csmf-controls.js";

const noSense = () => 0;

describe("CSMF math blocks", () => {
  it("square, inv and fp_int are memoryless", () => {
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: -2.6 },
        { id: "sq", kind: "square", inputs: ["c"] },
        { id: "iv", kind: "inv", inputs: ["c"] },
        { id: "fi", kind: "fp_int", inputs: ["c"] },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("sq") - 6.76) < 1e-12);
    assert.ok(Math.abs(g.getOutput("iv") - 1 / -2.6) < 1e-12);
    assert.equal(g.getOutput("fi"), -2);
  });

  it("inv traps division by zero to the output limit", () => {
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: 0 },
        { id: "iv", kind: "inv", inputs: ["c"], maxOut: 500 },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    assert.equal(g.getOutput("iv"), 500);
  });

  it("integral of a constant ramps linearly (trapezoidal)", () => {
    const dt = 1e-3;
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: 2 },
        { id: "i", kind: "integral", inputs: ["c"] },
      ],
      dt,
    );
    for (let k = 0; k < 1000; k++) g.step(noSense, noSense);
    // First step sees uPrev = 0, so the trapezoid loses half a step: 2 * (1 - dt/2).
    assert.ok(Math.abs(g.getOutput("i") - 2 * (1 - dt / 2)) < 1e-9);
  });
});

describe("abcdq0 (split per axis)", () => {
  it("maps a balanced set aligned with theta to d=amplitude, q=0, 0=0", () => {
    const th = 0.7;
    const t2 = (2 * Math.PI) / 3;
    const amp = 3;
    const g = new CsmfControlGraph(
      [
        { id: "a", kind: "const", value: amp * Math.cos(th) },
        { id: "b", kind: "const", value: amp * Math.cos(th - t2) },
        { id: "c", kind: "const", value: amp * Math.cos(th + t2) },
        { id: "th", kind: "const", value: th },
        { id: "d", kind: "abcdq0_d", inputs: ["a", "b", "c", "th"] },
        { id: "q", kind: "abcdq0_q", inputs: ["a", "b", "c", "th"] },
        { id: "z", kind: "abcdq0_0", inputs: ["a", "b", "c", "th"] },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("d") - amp) < 1e-12);
    assert.ok(Math.abs(g.getOutput("q")) < 1e-12);
    assert.ok(Math.abs(g.getOutput("z")) < 1e-12);
  });
});
