// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbstractDomainOracle } from "../src/formal/oracles/abstract_domain_oracle.js";
import { CaeContractOracle } from "../src/formal/oracles/cae_contract_oracle.js";
import { CausalizationTheoryOracle } from "../src/formal/oracles/causalization_oracle.js";
import { ConstraintTheoryOracle } from "../src/formal/oracles/constraint_oracle.js";
import { DimensionalTheoryOracle } from "../src/formal/oracles/dimensional_oracle.js";
import { EntailmentTheoryOracle } from "../src/formal/oracles/entailment_oracle.js";
import { FlowAlgebraOracle } from "../src/formal/oracles/flow_algebra_oracle.js";
import { OntologyTheoryOracle } from "../src/formal/oracles/ontology_oracle.js";
import { SafetyTheoryOracle } from "../src/formal/oracles/safety_theory_oracle.js";
import { SpatialPhysicsOracle } from "../src/formal/oracles/spatial_physics_oracle.js";
import { ToleranceStackOracle } from "../src/formal/oracles/tolerance_stack_oracle.js";
import { UqTheoryOracle } from "../src/formal/oracles/uq_oracle.js";

describe("Semantic Theory Oracles — pushLevel/popLevel Uniformity", () => {
  it("should implement pushLevel and popLevel across all 12 theory oracles", () => {
    const oracles = [
      new OntologyTheoryOracle(),
      new ConstraintTheoryOracle(),
      new AbstractDomainOracle(),
      new SpatialPhysicsOracle(),
      new ToleranceStackOracle(),
      new DimensionalTheoryOracle(),
      new CaeContractOracle(),
      new FlowAlgebraOracle(),
      new SafetyTheoryOracle(),
      new CausalizationTheoryOracle(),
      new EntailmentTheoryOracle(),
      new UqTheoryOracle(),
    ];

    for (const oracle of oracles) {
      assert.strictEqual(typeof (oracle as any).pushLevel, "function", `${oracle.name} must implement pushLevel()`);
      assert.strictEqual(typeof (oracle as any).popLevel, "function", `${oracle.name} must implement popLevel()`);
    }
  });

  it("should maintain clean multi-level state snapshots without pollution in FlowAlgebraOracle", () => {
    const oracle = new FlowAlgebraOracle();
    oracle.assertLiteral({
      id: 1,
      predicate: "portType",
      args: ["PType", [{ name: "flow", direction: "inout", isFlow: true }]],
      isNegated: false,
    });

    // Level 1: connect p1 to p2
    oracle.pushLevel();
    oracle.assertLiteral({ id: 2, predicate: "portUsage", args: ["p1", "PType"], isNegated: false });
    oracle.assertLiteral({ id: 3, predicate: "portUsage", args: ["p2", "PType"], isNegated: false });
    oracle.assertLiteral({ id: 4, predicate: "connect", args: ["p1", "p2"], isNegated: false });

    assert.strictEqual(oracle.propagateEqualities().length, 1);

    // Level 2: connect p3 to p4
    oracle.pushLevel();
    oracle.assertLiteral({ id: 5, predicate: "portUsage", args: ["p3", "PType"], isNegated: false });
    oracle.assertLiteral({ id: 6, predicate: "portUsage", args: ["p4", "PType"], isNegated: false });
    oracle.assertLiteral({ id: 7, predicate: "connect", args: ["p3", "p4"], isNegated: false });

    assert.strictEqual(oracle.propagateEqualities().length, 2);

    // Level 3: connect p5 to p6
    oracle.pushLevel();
    oracle.assertLiteral({ id: 8, predicate: "portUsage", args: ["p5", "PType"], isNegated: false });
    oracle.assertLiteral({ id: 9, predicate: "portUsage", args: ["p6", "PType"], isNegated: false });
    oracle.assertLiteral({ id: 10, predicate: "connect", args: ["p5", "p6"], isNegated: false });

    assert.strictEqual(oracle.propagateEqualities().length, 3);

    // Pop 2 levels back to Level 1
    oracle.popLevel();
    oracle.popLevel();

    assert.strictEqual(oracle.propagateEqualities().length, 1);
    assert.ok(oracle.getEffectiveItems("p1"));
    assert.strictEqual(oracle.getEffectiveItems("p3"), null);
    assert.strictEqual(oracle.getEffectiveItems("p5"), null);

    // Pop final level to base
    oracle.popLevel();
    assert.strictEqual(oracle.propagateEqualities().length, 0);
    assert.strictEqual(oracle.getEffectiveItems("p1"), null);
  });

  it("should support 3-level push and pop in SafetyTheoryOracle without residual hazard states", () => {
    const oracle = new SafetyTheoryOracle();

    // Base level: hazard 0
    oracle.registerHazard({
      id: "H0",
      name: "Hazard 0",
      description: "Base",
      severity: "S1",
      exposure: "E1",
      controllability: "C1",
      targetAsil: "QM",
    });

    assert.strictEqual(oracle.propagateEqualities().length, 1);

    // Level 1: hazard 1
    oracle.pushLevel();
    oracle.registerHazard({
      id: "H1",
      name: "Hazard 1",
      description: "L1",
      severity: "S2",
      exposure: "E2",
      controllability: "C2",
      targetAsil: "ASIL-B",
    });
    assert.strictEqual(oracle.propagateEqualities().length, 2);

    // Level 2: hazard 2
    oracle.pushLevel();
    oracle.registerHazard({
      id: "H2",
      name: "Hazard 2",
      description: "L2",
      severity: "S3",
      exposure: "E3",
      controllability: "C3",
      targetAsil: "ASIL-D",
    });
    assert.strictEqual(oracle.propagateEqualities().length, 3);

    // Pop back to Level 1
    oracle.popLevel();
    assert.strictEqual(oracle.propagateEqualities().length, 2);

    // Pop back to Base
    oracle.popLevel();
    assert.strictEqual(oracle.propagateEqualities().length, 1);
    assert.strictEqual(oracle.propagateEqualities()[0].varA, "H0.actualPmhf");
  });

  it("should support 3-level push and pop in CausalizationTheoryOracle", () => {
    const oracle = new CausalizationTheoryOracle();

    // Base
    oracle.assertLiteral({
      id: 1,
      predicate: "equation",
      args: ["eq1", ["x", "y"]],
      isNegated: false,
    });

    // Level 1: add loop
    oracle.pushLevel();
    oracle.assertLiteral({
      id: 2,
      predicate: "sampleRate",
      args: ["loop1", 1000, 50],
      isNegated: false,
    });
    assert.strictEqual(oracle.checkSat().isSat, true);

    // Level 2: add unstable sample rate violating Nyquist
    oracle.pushLevel();
    oracle.assertLiteral({
      id: 3,
      predicate: "sampleRate",
      args: ["loop2", 100, 200], // 100 < 10 * 200 => UNSAT
      isNegated: false,
    });
    assert.strictEqual(oracle.checkSat().isSat, false);

    // Pop level 2
    oracle.popLevel();
    assert.strictEqual(oracle.checkSat().isSat, true);

    // Pop level 1
    oracle.popLevel();
    assert.strictEqual(oracle.checkSat().isSat, true);
  });

  it("should support 3-level push and pop in UqTheoryOracle and EntailmentTheoryOracle", () => {
    const uq = new UqTheoryOracle();
    uq.setDistribution("temp", { kind: "normal", mean: 100, stdDev: 5 });

    uq.pushLevel();
    uq.assertLiteral({
      id: 1,
      predicate: "probBound",
      args: ["temp", ">", 115, 0.05], // mean 100, 3 sigma = 115, prob < 0.05 => SAT
      isNegated: false,
    });
    assert.strictEqual(uq.checkSat().isSat, true);

    uq.pushLevel();
    uq.assertLiteral({
      id: 2,
      predicate: "probBound",
      args: ["temp", ">", 100, 0.01], // mean 100, P(temp > 100) = 0.5 > 0.01 => UNSAT
      isNegated: false,
    });
    assert.strictEqual(uq.checkSat().isSat, false);

    uq.popLevel();
    assert.strictEqual(uq.checkSat().isSat, true);

    uq.popLevel();
    assert.strictEqual(uq.checkSat().isSat, true);

    // Entailment
    const entailment = new EntailmentTheoryOracle();
    entailment.assertLiteral({
      id: 10,
      predicate: "requirement",
      args: ["REQ-SYS-01", "pressure", "<=", 100],
      isNegated: false,
    });

    entailment.pushLevel();
    entailment.assertLiteral({
      id: 11,
      predicate: "requirement",
      args: ["REQ-SUB-01", "pressure", "<=", 80],
      isNegated: false,
    });
    entailment.assertLiteral({
      id: 12,
      predicate: "entailment",
      args: ["REQ-SYS-01", ["REQ-SUB-01"]],
      isNegated: false,
    });
    assert.strictEqual(entailment.checkSat().isSat, true);

    entailment.pushLevel();
    entailment.assertLiteral({
      id: 13,
      predicate: "requirement",
      args: ["REQ-SUB-02", "pressure", "<=", 120], // 120 > 100 => UNSAT
      isNegated: false,
    });
    entailment.assertLiteral({
      id: 14,
      predicate: "entailment",
      args: ["REQ-SYS-01", ["REQ-SUB-02"]],
      isNegated: false,
    });
    assert.strictEqual(entailment.checkSat().isSat, false);

    entailment.popLevel();
    assert.strictEqual(entailment.checkSat().isSat, true);

    entailment.popLevel();
    assert.strictEqual(entailment.checkSat().isSat, true);
  });
});
