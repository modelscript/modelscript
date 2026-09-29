// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoopInvariantAnalyzer } from "../src/loop-invariant-analyzer.js";

describe("SysML v2 First-Order Inductive Invariant Prover (Imandra Equivalent)", () => {
  it("proves a loop invariant directly via mathematical induction", () => {
    const loop = {
      condition: "i < 100",
      body: `
        assign i := i + 1;
        assign total := total + 5;
      `,
      invariants: ["total >= 0", "i >= 0"],
    };

    const initialBounds = new Map([
      ["i", { lower: 0, upper: 0 }],
      ["total", { lower: 0, upper: 0 }],
    ]);

    const res = LoopInvariantAnalyzer.analyzeLoop(loop, initialBounds);
    assert.strictEqual(res.isTerminating, true);
    assert.strictEqual(res.invariantHolds, true);
    assert.ok(res.inductiveProof);
    assert.strictEqual(res.inductiveProof.isInductive, true);
    assert.strictEqual(res.inductiveProof.initiationHolds, true);
    assert.strictEqual(res.inductiveProof.consecutionHolds, true);
  });

  it("proves an invariant via automated lemma strengthening when CTI arises", () => {
    // Classic Imandra benchmark for loops:
    // x = 0, y = 0
    // while (x < 10) { x = x + 1; y = y + 1; }
    // Invariant: y <= 10
    // Consecution on raw y <= 10 fails with CTI (x=0, y=10 -> y'=11).
    // Automated lemma strengthening synthesizes (x - y == 0).
    const loop = {
      condition: "x < 10",
      body: `
        assign x := x + 1;
        assign y := y + 1;
      `,
      invariants: ["y <= 10"],
    };

    const initialBounds = new Map([
      ["x", { lower: 0, upper: 0 }],
      ["y", { lower: 0, upper: 0 }],
    ]);

    const proof = LoopInvariantAnalyzer.proveInductiveInvariant(loop, initialBounds);
    assert.strictEqual(proof.status, "STRENGTHENED");
    assert.strictEqual(proof.isInductive, true);
    assert.ok(proof.strengtheningLemmas && proof.strengtheningLemmas.length > 0);
    assert.ok(proof.summary.includes("automated lemma strengthening"));
  });

  it("refutes an invalid loop invariant at initial state", () => {
    const loop = {
      condition: "x < 5",
      body: `
        assign x := x + 1;
      `,
      invariants: ["x >= 10"],
    };

    const initialBounds = new Map([["x", { lower: 0, upper: 0 }]]);

    const proof = LoopInvariantAnalyzer.proveInductiveInvariant(loop, initialBounds);
    assert.strictEqual(proof.status, "DISPROVEN");
    assert.strictEqual(proof.isInductive, false);
    assert.strictEqual(proof.initiationHolds, false);
    assert.strictEqual(proof.counterexample?.type, "INIT_VIOLATION");
  });

  it("discovers conserved affine quantities for multi-variable iterative algorithms", () => {
    // Two variables incremented by 2 and 4 respectively
    const loop = {
      condition: "u < 20",
      body: `
        assign u := u + 2;
        assign v := v + 4;
      `,
      invariants: ["v <= 50"],
    };

    const initialBounds = new Map([
      ["u", { lower: 0, upper: 0 }],
      ["v", { lower: 0, upper: 0 }],
    ]);

    const proof = LoopInvariantAnalyzer.proveInductiveInvariant(loop, initialBounds);
    assert.strictEqual(proof.status, "STRENGTHENED");
    assert.strictEqual(proof.isInductive, true);
    assert.ok(proof.strengtheningLemmas && proof.strengtheningLemmas.length > 0);
  });
});
