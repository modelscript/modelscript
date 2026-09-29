// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { AssumeGuaranteeContract, ChcLowering, ChcSystem, SpacerEngine } from "../src/formal/chc/index.js";
import { type InductiveSpec } from "../src/formal/inductive_prover.js";

describe("Constrained Horn Clauses (CHC) & Spacer Engine (Generalized PDR)", () => {
  describe("CHC System Construction & Representation", () => {
    it("should build and inspect canonical Horn clauses", () => {
      const chc = new ChcSystem();
      chc.addPredicate({
        name: "Inv",
        arity: 2,
        varNames: ["x", "y"],
        types: ["real", "real"],
      });

      // Fact: x == 0 & y == 0 => Inv(x, y)
      chc.addFact(
        "Inv",
        ["x", "y"],
        [
          { expr: { kind: "var", name: "x" }, rel: "==", rhs: 0 },
          { expr: { kind: "var", name: "y" }, rel: "==", rhs: 0 },
        ],
      );

      // Rule: Inv(x, y) & x' - x == 1 & y' - y == 1 => Inv(x', y')
      chc.addRule(
        { name: "Inv", args: ["x_prime", "y_prime"] },
        [{ name: "Inv", args: ["x", "y"] }],
        [
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "x_prime" },
              right: { kind: "var", name: "x" },
            },
            rel: "==",
            rhs: 1,
          },
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "y_prime" },
              right: { kind: "var", name: "y" },
            },
            rel: "==",
            rhs: 1,
          },
        ],
      );

      // Query: Inv(x, y) & x >= 10 & y <= 0 => false
      chc.addQuery(
        [{ name: "Inv", args: ["x", "y"] }],
        [
          { expr: { kind: "var", name: "x" }, rel: ">=", rhs: 10 },
          { expr: { kind: "var", name: "y" }, rel: "<=", rhs: 0 },
        ],
      );

      assert.strictEqual(chc.getAllPredicates().length, 1);
      assert.strictEqual(chc.getFacts().length, 1);
      assert.strictEqual(chc.getRules().length, 1);
      assert.strictEqual(chc.getQueries().length, 1);
      assert.strictEqual(chc.getClauses().length, 3);
    });
  });

  describe("Transition System Lowering & Invariant Proofs", () => {
    it("should prove safe transition system invariant via Spacer generalized PDR", () => {
      // System:
      // Init: x == 0
      // Step: x' - x == 1, guard: x <= 9
      // Invariant: x <= 15
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
          { expr: { kind: "var", name: "x" }, rel: "<=", rhs: 9 },
        ],
        invariant: [{ expr: { kind: "var", name: "x" }, rel: "<=", rhs: 15 }],
      };

      const chc = ChcLowering.fromInductiveSpec(spec);
      const spacer = new SpacerEngine(chc, { maxDepth: 10 });
      const res = spacer.check();

      assert.strictEqual(res.status, "SAFE");
      assert.ok(res.depth >= 1);
      assert.ok(res.summary.includes("SAFE"));
    });

    it("should extract counterexample derivation trace when safety hazard is reachable", () => {
      // System:
      // Init: x == 0
      // Step: x' - x == 1
      // Hazard: x == 2 (reachable in 2 steps: 0 -> 1 -> 2)
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
        // Invariant violates at x == 2
        invariant: [{ expr: { kind: "var", name: "x" }, rel: "<=", rhs: 1 }],
      };

      const chc = ChcLowering.fromInductiveSpec(spec);
      const spacer = new SpacerEngine(chc, { maxDepth: 5 });
      const res = spacer.check();

      assert.strictEqual(res.status, "UNSAFE");
      assert.ok(res.counterexample);
      assert.ok(res.counterexample.length >= 2);
      assert.ok(res.summary.includes("UNSAFE"));
    });
  });

  describe("Assume-Guarantee Contract Lowering & Compositional Verification", () => {
    it("should verify Assume-Guarantee contract safety using CHC lowering", () => {
      // Contract: Temperature Monitor
      // Inputs: u (heating power in [0, 5])
      // State: T (temperature)
      // Output: y (status)
      // Init: T == 20
      // Assumption: u <= 5
      // Step: T' - T == 1
      // Guarantee: T <= 50 (over 10 steps with guard T <= 30)
      const contract: AssumeGuaranteeContract = {
        name: "ThermalController",
        inputs: ["u"],
        states: ["T"],
        outputs: ["y"],
        init: [{ expr: { kind: "var", name: "T" }, rel: "==", rhs: 20 }],
        assumptions: [{ expr: { kind: "var", name: "u" }, rel: "<=", rhs: 5 }],
        transition: [
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "T_prime" },
              right: { kind: "var", name: "T" },
            },
            rel: "==",
            rhs: 1,
          },
          // Guard: T <= 28
          { expr: { kind: "var", name: "T" }, rel: "<=", rhs: 28 },
        ],
        guarantees: [{ expr: { kind: "var", name: "T" }, rel: "<=", rhs: 40 }],
      };

      const chc = ChcLowering.fromContract(contract);
      const spacer = new SpacerEngine(chc, { maxDepth: 10 });
      const res = spacer.check();

      assert.strictEqual(res.status, "SAFE");
      assert.ok(res.summary.includes("SAFE"));
    });

    it("should verify hierarchical multi-component composition without monolithic flattening", () => {
      // Component 1: Sensor reading
      // Init: s == 0, Step: s' - s == 1, s <= 5. Guarantee: s <= 10.
      const sensor: AssumeGuaranteeContract = {
        name: "Sensor",
        inputs: [],
        states: ["s"],
        outputs: ["s_out"],
        init: [{ expr: { kind: "var", name: "s" }, rel: "==", rhs: 0 }],
        assumptions: [],
        transition: [
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "s_prime" },
              right: { kind: "var", name: "s" },
            },
            rel: "==",
            rhs: 1,
          },
          { expr: { kind: "var", name: "s" }, rel: "<=", rhs: 5 },
        ],
        guarantees: [{ expr: { kind: "var", name: "s" }, rel: "<=", rhs: 10 }],
      };

      // Component 2: Actuator
      // Init: a == 0, Step: a' - a == 2, a <= 8. Guarantee: a <= 15.
      const actuator: AssumeGuaranteeContract = {
        name: "Actuator",
        inputs: ["cmd"],
        states: ["a"],
        outputs: ["pos"],
        init: [{ expr: { kind: "var", name: "a" }, rel: "==", rhs: 0 }],
        assumptions: [{ expr: { kind: "var", name: "cmd" }, rel: "<=", rhs: 10 }],
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
          { expr: { kind: "var", name: "a" }, rel: "<=", rhs: 8 },
        ],
        guarantees: [{ expr: { kind: "var", name: "a" }, rel: "<=", rhs: 20 }],
      };

      // Wiring constraint: actuator command equals sensor output
      const wiring = [
        {
          expr: {
            kind: "sub",
            left: { kind: "var", name: "cmd" },
            right: { kind: "var", name: "s" },
          },
          rel: "==",
          rhs: 0,
        },
      ];

      // System requirements: combined sum s + a <= 40
      const sysReqs = [
        {
          expr: {
            kind: "add",
            left: { kind: "var", name: "s" },
            right: { kind: "var", name: "a" },
          },
          rel: "<=",
          rhs: 40,
        },
      ];

      const sysChc = ChcLowering.compose("AvionicsSystem", [sensor, actuator], wiring, sysReqs, ["s", "a"], ["s", "a"]);

      const spacer = new SpacerEngine(sysChc, { maxDepth: 10 });
      const res = spacer.check();

      assert.strictEqual(res.status, "SAFE");
      assert.ok(res.summary.includes("SAFE"));
    });
  });
});
