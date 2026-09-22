// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportToNuXmv } from "../src/exporters/nuxmv-exporter.js";
import { exportToSmtLib, expressionToSmtLib } from "../src/exporters/smtlib-exporter.js";

describe("Zero-Overhead SMT-LIB2 & nuXmv Headless Export Bridges Suite", () => {
  it("should convert infix comparison constraints to prefix SMT-LIB v2 format", () => {
    const c1 = {
      expression: "voltage <= 420.0",
      operator: "<=" as const,
      lhs: "voltage",
      rhs: 420,
      source: "sysml2" as const,
    };
    assert.strictEqual(expressionToSmtLib(c1), "(<= voltage 420.0)");

    const c2 = {
      expression: "t1 - t2 <= 5.0",
      operator: "<=" as const,
      lhs: "t1 - t2",
      rhs: 5,
      source: "sysml2" as const,
    };
    assert.strictEqual(expressionToSmtLib(c2), "(<= (- t1 t2) 5.0)");

    const c3 = {
      expression: "speed >= 100",
      operator: ">=" as const,
      lhs: "speed",
      rhs: 100,
      source: "sysml2" as const,
    };
    assert.strictEqual(expressionToSmtLib(c3), "(>= speed 100.0)");
  });

  it("should export complete SMT-LIB v2 benchmarks with declarations and check-sat", () => {
    const fakeDb = {
      allEntries: () => [
        {
          id: 1,
          ruleName: "ConstraintUsage",
          kind: "Usage",
          name: "c1",
          startByte: 0,
          endByte: 20,
          metadata: {},
        },
      ],
      cstText: () => "constraint c1 { voltage <= 400.0 }",
      symbol: () => null,
      childrenOf: () => [],
      byName: () => [],
    };

    const smt = exportToSmtLib(fakeDb as any, { logic: "QF_LRA" });
    assert(smt.includes("(set-logic QF_LRA)"));
    assert(smt.includes("(declare-const voltage Real)"));
    assert(smt.includes("(assert (<= voltage 400.0))"));
    assert(smt.includes("(check-sat)"));
    assert(smt.includes("(get-model)"));
  });

  it("should export state machines to nuXmv (.smv) modules with transition relations", () => {
    const fakeDb = {
      allEntries: () => [
        {
          id: 1,
          ruleName: "StateDefinition",
          kind: "Definition",
          name: "Off",
          startByte: 0,
          endByte: 10,
          metadata: {},
        },
        {
          id: 2,
          ruleName: "StateDefinition",
          kind: "Definition",
          name: "Running",
          startByte: 11,
          endByte: 20,
          metadata: {},
        },
        {
          id: 3,
          ruleName: "TransitionUsage",
          kind: "Usage",
          name: "t1",
          startByte: 21,
          endByte: 50,
          metadata: { source: "Off", target: "Running", guard: "fuelLevel > 0" },
        },
      ],
      parentOf: () => null,
      cstText: () => null,
    };

    const smv = exportToNuXmv(fakeDb as any, {
      moduleName: "EngineSM",
      invariants: ["!(state = Error)"],
      ltlSpecs: ["G (state = Running -> F (state = Off))"],
    });

    assert(smv.includes("MODULE EngineSM"));
    assert(smv.includes("state : { Off, Running }"));
    assert(smv.includes("init(state) := Off;"));
    assert(smv.includes("next(state) := case"));
    assert(smv.includes("state = Off & (fuelLevel > 0) : Running;"));
    assert(smv.includes("INVARSPEC !(state = Error)"));
    assert(smv.includes("LTLSPEC G (state = Running -> F (state = Off))"));
  });
});
