// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { InductiveProver, type InductiveSpec } from "../src/formal/inductive_prover.js";

describe("First-Order Inductive Invariant Prover & Lemma Strengthening (Imandra)", () => {
  it("should directly prove an inductive invariant without strengthening", () => {
    // Monotonic increment:
    // Init: x == 0
    // Transition: x_prime - x == 1
    // Invariant: x >= 0
    const spec: InductiveSpec = {
      variables: ["x"],
      init: [{ expr: { kind: "var", name: "x" }, rel: "==", rhs: 0 }],
      transition: [
        {
          expr: {
            kind: "sub",
            left: { kind: "var", name: "x_prime" },
            right: { kind: "var", name: "x" },
          },
          rel: "==",
          rhs: 1,
        },
      ],
      invariant: [{ expr: { kind: "var", name: "x" }, rel: ">=", rhs: 0 }],
      domainBounds: new Map([["x", new Interval(0, 100)]]),
    };

    const res = InductiveProver.proveInvariant(spec);
    assert.strictEqual(res.status, "PROVEN");
    assert.strictEqual(res.isInductive, true);
    assert.strictEqual(res.initiationHolds, true);
    assert.strictEqual(res.consecutionHolds, true);
    assert.ok(res.summary.includes("Inductive proof verified"));
  });

  it("should refute an invariant that violates initiation", () => {
    // Init: x == -5
    // Invariant: x >= 0
    const spec: InductiveSpec = {
      variables: ["x"],
      init: [{ expr: { kind: "var", name: "x" }, rel: "==", rhs: -5 }],
      transition: [
        {
          expr: {
            kind: "sub",
            left: { kind: "var", name: "x_prime" },
            right: { kind: "var", name: "x" },
          },
          rel: "==",
          rhs: 1,
        },
      ],
      invariant: [{ expr: { kind: "var", name: "x" }, rel: ">=", rhs: 0 }],
    };

    const res = InductiveProver.proveInvariant(spec);
    assert.strictEqual(res.status, "DISPROVEN");
    assert.strictEqual(res.isInductive, false);
    assert.strictEqual(res.initiationHolds, false);
    assert.strictEqual(res.counterexample?.type, "INIT_VIOLATION");
  });

  it("should prove an invariant via automated lemma strengthening when consecution fails with CTI", () => {
    // Classic Imandra benchmark:
    // Init: x == 0, y == 0
    // Transition: x_prime - x == 1, y_prime - y == 1, x <= 9
    // Invariant: y <= 10
    //
    // Consecution alone fails because an unconstrained CTI pre-state (x=0, y=10)
    // transitions to (x=1, y=11), violating y <= 10.
    //
    // Automated lemma strengthening discovers the Karr invariant: (x - y == 0).
    // With (y <= 10 & x - y == 0), under x <= 9, y is also <= 9, so y_prime = 10 <= 10.
    // The strengthened invariant is proven inductive!
    const spec: InductiveSpec = {
      variables: ["x", "y"],
      init: [
        { expr: { kind: "var", name: "x" }, rel: "==", rhs: 0 },
        { expr: { kind: "var", name: "y" }, rel: "==", rhs: 0 },
      ],
      transition: [
        // x_prime - x == 1
        {
          expr: {
            kind: "sub",
            left: { kind: "var", name: "x_prime" },
            right: { kind: "var", name: "x" },
          },
          rel: "==",
          rhs: 1,
        },
        // y_prime - y == 1
        {
          expr: {
            kind: "sub",
            left: { kind: "var", name: "y_prime" },
            right: { kind: "var", name: "y" },
          },
          rel: "==",
          rhs: 1,
        },
        // Loop guard: x <= 9
        {
          expr: { kind: "var", name: "x" },
          rel: "<=",
          rhs: 9,
        },
      ],
      invariant: [{ expr: { kind: "var", name: "y" }, rel: "<=", rhs: 10 }],
      domainBounds: new Map([
        ["x", new Interval(0, 50)],
        ["y", new Interval(0, 50)],
      ]),
    };

    const res = InductiveProver.proveInvariant(spec);
    assert.strictEqual(res.status, "STRENGTHENED");
    assert.strictEqual(res.isInductive, true);
    assert.strictEqual(res.initiationHolds, true);
    assert.strictEqual(res.consecutionHolds, true);
    assert.ok(res.strengtheningLemmas && res.strengtheningLemmas.length > 0);
    assert.ok(res.summary.includes("automated lemma strengthening"));
  });

  it("should synthesize conserved linear quantities for non-unitary affine steps", () => {
    // Affine system:
    // Init: a == 0, b == 0
    // Step: a' - a == 2, b' - b == 4
    // Candidate Karr invariant: 4*a - 2*b == 0
    const spec: InductiveSpec = {
      variables: ["a", "b"],
      init: [
        { expr: { kind: "var", name: "a" }, rel: "==", rhs: 0 },
        { expr: { kind: "var", name: "b" }, rel: "==", rhs: 0 },
      ],
      transition: [
        {
          expr: {
            kind: "sub",
            left: { kind: "var", name: "a_prime" },
            right: { kind: "var", name: "a" },
          },
          rel: "==",
          rhs: 2,
        },
        {
          expr: {
            kind: "sub",
            left: { kind: "var", name: "b_prime" },
            right: { kind: "var", name: "b" },
          },
          rel: "==",
          rhs: 4,
        },
        // Guard: a <= 10
        {
          expr: { kind: "var", name: "a" },
          rel: "<=",
          rhs: 10,
        },
      ],
      invariant: [{ expr: { kind: "var", name: "b" }, rel: "<=", rhs: 24 }],
      domainBounds: new Map([
        ["a", new Interval(0, 50)],
        ["b", new Interval(0, 100)],
      ]),
    };

    const res = InductiveProver.proveInvariant(spec);
    assert.strictEqual(res.status, "STRENGTHENED");
    assert.strictEqual(res.isInductive, true);
    assert.ok(res.strengtheningLemmas && res.strengtheningLemmas.length > 0);
  });
});
