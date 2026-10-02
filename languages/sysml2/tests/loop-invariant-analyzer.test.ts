// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { LoopInvariantAnalyzer } from "../src/loop-invariant-analyzer.js";

describe("SysML v2 Loop Invariant & Bounded Iteration Analyzer (Octagon DBM)", () => {
  it("proves loop termination and derives exact post-condition bounds", () => {
    const loop = {
      condition: "i < 10",
      body: `
        assign i := i + 1;
        assign total := total + 5;
      `,
    };

    const initialBounds = new Map([
      ["i", { lower: 0, upper: 0 }],
      ["total", { lower: 0, upper: 0 }],
    ]);

    const res = LoopInvariantAnalyzer.analyzeLoop(loop, initialBounds);

    assert.strictEqual(res.isTerminating, true);
    assert.strictEqual(res.iterationsEstimated, 10);
    assert.strictEqual(res.diagnostics.length, 0);

    const postI = res.postConditions.get("i");
    assert(postI, "Should compute post-condition for loop counter i");
    assert.strictEqual(postI.lower, 10);
    assert.strictEqual(postI.upper, 10);

    const postTotal = res.postConditions.get("total");
    assert(postTotal, "Should compute post-condition for total");
    assert.strictEqual(postTotal.lower, 50);
    assert.strictEqual(postTotal.upper, 50);
  });

  it("detects possible infinite loop when loop variable does not progress towards exit", () => {
    const loop = {
      condition: "counter < 50",
      body: `
        // counter is never updated!
        assign otherVal := otherVal + 1;
      `,
    };

    const initialBounds = new Map([
      ["counter", { lower: 0, upper: 0 }],
      ["otherVal", { lower: 0, upper: 0 }],
    ]);

    const res = LoopInvariantAnalyzer.analyzeLoop(loop, initialBounds);

    assert.strictEqual(res.isTerminating, false);
    const infLoopDiag = res.diagnostics.find((d) => d.rule === "possible-infinite-loop");
    assert(infLoopDiag, "Should flag possible infinite loop when counter does not progress");
  });

  it("detects infinite loop when loop variable moves in reverse direction", () => {
    const loop = {
      condition: "counter < 100",
      body: `
        // Decrementing instead of incrementing!
        assign counter := counter - 1;
      `,
    };

    const initialBounds = new Map([["counter", { lower: 50, upper: 50 }]]);

    const res = LoopInvariantAnalyzer.analyzeLoop(loop, initialBounds);

    assert.strictEqual(res.isTerminating, false);
    const infDiag = res.diagnostics.find((d) => d.rule === "possible-infinite-loop");
    assert(infDiag, "Should detect divergence away from condition threshold");
  });

  it("verifies satisfied loop invariants and detects invariant violations", () => {
    // 1. Satisfied invariant
    const safeLoop = {
      condition: "step < 4",
      body: `
        assign step := step + 1;
        assign buffer := buffer + 10;
      `,
      invariants: ["buffer <= 50"],
    };

    const initialBounds = new Map([
      ["step", { lower: 0, upper: 0 }],
      ["buffer", { lower: 0, upper: 0 }],
    ]);

    const safeRes = LoopInvariantAnalyzer.analyzeLoop(safeLoop, initialBounds);
    assert.strictEqual(safeRes.invariantHolds, true);
    assert.strictEqual(safeRes.diagnostics.length, 0);

    // 2. Violated invariant
    const unsafeLoop = {
      condition: "step < 10",
      body: `
        assign step := step + 1;
        assign buffer := buffer + 20;
      `,
      invariants: ["buffer <= 30"],
    };

    const unsafeRes = LoopInvariantAnalyzer.analyzeLoop(unsafeLoop, initialBounds);
    assert.strictEqual(unsafeRes.invariantHolds, false);
    const violDiag = unsafeRes.diagnostics.find((d) => d.rule === "loop-invariant-violation");
    assert(violDiag, "Should detect loop invariant violation when buffer exceeds 30");
  });

  it("tracks difference logic constraints across loop updates", () => {
    const diffLoop = {
      condition: "tick < 5",
      body: `
        assign tick := tick + 1;
        assign y := x + 10;
      `,
    };

    const initialBounds = new Map([
      ["tick", { lower: 0, upper: 0 }],
      ["x", { lower: 5, upper: 5 }],
      ["y", { lower: 15, upper: 15 }],
    ]);

    const res = LoopInvariantAnalyzer.analyzeLoop(diffLoop, initialBounds);
    assert.strictEqual(res.isTerminating, true);
    const postTick = res.postConditions.get("tick");
    assert.strictEqual(postTick?.lower, 5);
  });

  it("calculates exact stride overshoot exit bounds without artificial clamping", () => {
    // Loop: x starting at 0, while x < 10, x += 3.
    // Iterations: 0 -> 3 -> 6 -> 9 -> 12 (4 iterations)
    // Exit value must be exactly 12, NOT clamped to 10!
    const overshootLoop = {
      condition: "x < 10",
      body: `
        assign x := x + 3;
      `,
    };

    const initialBounds = new Map([["x", { lower: 0, upper: 0 }]]);
    const res = LoopInvariantAnalyzer.analyzeLoop(overshootLoop, initialBounds);

    assert.strictEqual(res.isTerminating, true);
    assert.strictEqual(res.iterationsEstimated, 4, "Must take 4 iterations to cross threshold 10 with step 3");
    const postX = res.postConditions.get("x");
    assert(postX, "Must derive post-conditions for x");
    assert.strictEqual(postX.lower, 12, "Exit value must be exactly 12 (0 + 4*3), not clamped to 10");
    assert.strictEqual(postX.upper, 12, "Exit value must be exactly 12 (0 + 4*3), not clamped to 10");
  });
});
