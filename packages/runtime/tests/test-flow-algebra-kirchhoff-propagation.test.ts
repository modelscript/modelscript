// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConstraintTheoryOracle } from "../src/formal/oracles/constraint_oracle.js";
import { FlowAlgebraOracle } from "../src/formal/oracles/flow_algebra_oracle.js";
import { SemanticTheoryCoordinator } from "../src/formal/theory_coordinator.js";

describe("FlowAlgebraOracle — Kirchhoff Potential & Flow Propagation", () => {
  it("should propagate both potential equality and flow anti-symmetry relations", () => {
    const oracle = new FlowAlgebraOracle();

    // 1. Define fluid port type with potential (p) and flow (m_flow)
    oracle.assertLiteral({
      id: 1,
      predicate: "portType",
      args: [
        "FluidPort",
        [
          { name: "p", direction: "inout", isFlow: false },
          { name: "m_flow", direction: "inout", isFlow: true },
        ],
      ],
      isNegated: false,
    });

    // 2. Instantiate port usages
    oracle.assertLiteral({
      id: 2,
      predicate: "portUsage",
      args: ["pipeA.port", "FluidPort"],
      isNegated: false,
    });
    oracle.assertLiteral({
      id: 3,
      predicate: "portUsage",
      args: ["pipeB.port", "FluidPort"],
      isNegated: false,
    });

    // 3. Connect pipeA.port and pipeB.port
    oracle.assertLiteral({
      id: 4,
      predicate: "connect",
      args: ["pipeA.port", "pipeB.port"],
      isNegated: false,
    });

    // 4. Propagate equalities
    const eqs = oracle.propagateEqualities();
    assert.ok(eqs.length >= 2, `Expected at least 2 equalities, got ${eqs.length}`);

    const potentialEq = eqs.find(
      (e) =>
        (e.varA === "pipeA.port.p" && e.varB === "pipeB.port.p") ||
        (e.varA === "pipeB.port.p" && e.varB === "pipeA.port.p"),
    );
    assert.ok(potentialEq, "Must emit potential equality for pressure p across connection");
    assert.ok(potentialEq.justifications.includes(4), "Must include connect literal ID in justifications");

    const flowEq = eqs.find(
      (e) =>
        (e.varA === "pipeA.port.m_flow" && e.varB === "-pipeB.port.m_flow") ||
        (e.varA === "pipeB.port.m_flow" && e.varB === "-pipeA.port.m_flow"),
    );
    assert.ok(flowEq, "Must emit Kirchhoff flow balance relation (m_flow = -m_flow) across connection");
    assert.ok(flowEq.justifications.includes(4), "Must include connect literal ID in flow justifications");
  });

  it("should propagate potential equality to ConstraintTheoryOracle and catch pressure conflict", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const flowOracle = new FlowAlgebraOracle();
    const constraintOracle = new ConstraintTheoryOracle();

    coordinator.registerOracle(flowOracle);
    coordinator.registerOracle(constraintOracle);

    // Subscribe constraint oracle to port variables
    coordinator.subscribe("pipe1.out.p", constraintOracle);
    coordinator.subscribe("pipe2.in.p", constraintOracle);

    flowOracle.assertLiteral({
      id: 1,
      predicate: "portType",
      args: [
        "HydraulicPort",
        [
          { name: "p", direction: "inout", isFlow: false },
          { name: "q", direction: "inout", isFlow: true },
        ],
      ],
      isNegated: false,
    });
    flowOracle.assertLiteral({
      id: 2,
      predicate: "portUsage",
      args: ["pipe1.out", "HydraulicPort"],
      isNegated: false,
    });
    flowOracle.assertLiteral({
      id: 3,
      predicate: "portUsage",
      args: ["pipe2.in", "HydraulicPort"],
      isNegated: false,
    });
    coordinator.assertLiteral({
      id: 4,
      predicate: "connect",
      args: ["pipe1.out", "pipe2.in"],
      domain: "constraint",
      isNegated: false,
    });

    // In constraint oracle: pipe1.out.p in [100000, 100000], pipe2.in.p in [200000, 200000]
    coordinator.assertLiteral({
      id: 5,
      predicate: "interval",
      args: ["pipe1.out.p", 100000, 100000],
      domain: "constraint",
      isNegated: false,
    });
    coordinator.assertLiteral({
      id: 6,
      predicate: "interval",
      args: ["pipe2.in.p", 200000, 200000],
      domain: "constraint",
      isNegated: false,
    });

    const res = coordinator.checkSat();
    assert.strictEqual(res.isSat, false, "Pressure contradiction across connected ports should be UNSAT");
    assert.ok(res.conflict, "Conflict clause should be produced");
  });
});
