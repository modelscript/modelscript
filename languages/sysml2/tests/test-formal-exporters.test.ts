// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportToNuXmv, exportToOcra } from "../src/exporters/nuxmv-exporter.js";
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

    // Nonlinear expression
    const c4 = {
      expression: "x * y + z <= 10.0",
      operator: "<=" as const,
      lhs: "x * y + z",
      rhs: 10,
      source: "sysml2" as const,
    };
    assert.strictEqual(expressionToSmtLib(c4), "(<= (+ (* x y) z) 10.0)");
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

  it("should export nonlinear SMT-LIB v2 benchmarks with QF_NRA logic and optimization objectives", () => {
    const fakeDb = {
      allEntries: () => [
        {
          id: 1,
          ruleName: "ConstraintUsage",
          kind: "Usage",
          name: "c_power",
          startByte: 0,
          endByte: 30,
          metadata: {},
        },
      ],
      cstText: () => "constraint c_power { v * i <= 500.0 }",
      symbol: () => null,
      childrenOf: () => [],
      byName: () => [],
    };

    const smt = exportToSmtLib(fakeDb as any, {
      minimize: ["v * i"],
      maximize: ["efficiency"],
    });

    assert(smt.includes("(set-logic QF_NRA)"));
    assert(smt.includes("(declare-const i Real)"));
    assert(smt.includes("(declare-const v Real)"));
    assert(smt.includes("(assert (<= (* v i) 500.0))"));
    assert(smt.includes("(minimize (* v i))"));
    assert(smt.includes("(maximize efficiency)"));
    assert(smt.includes("(check-sat)"));
  });

  it("should export user functions from calc def to define-fun in SMT-LIB v2", () => {
    const fakeDb = {
      allEntries: () => [
        {
          id: 1,
          ruleName: "CalculationDefinition",
          kind: "Definition",
          name: "square",
          startByte: 0,
          endByte: 50,
          metadata: {},
        },
        {
          id: 2,
          ruleName: "ConstraintUsage",
          kind: "Usage",
          name: "c1",
          startByte: 51,
          endByte: 80,
          metadata: {},
        },
      ],
      cstText: (start: number) => {
        if (start === 0) return "calc def square(x: Real): Real { return x * x; }";
        return "constraint c1 { x <= 10.0 }";
      },
      symbol: () => null,
      childrenOf: () => [],
      byName: () => [],
    };

    const smt = exportToSmtLib(fakeDb as any);
    assert(smt.includes("(define-fun square ((x Real)) Real (* x x))"));
    assert(smt.includes("(declare-const x Real)"));
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

  it("should export nuXmv modules with IVAR inputs and hierarchical substate variables", () => {
    const fakeDb = {
      allEntries: () => [
        {
          id: 1,
          ruleName: "StateDefinition",
          kind: "Definition",
          name: "Normal",
          startByte: 0,
          endByte: 10,
          metadata: {},
        },
        {
          id: 2,
          ruleName: "StateDefinition",
          kind: "Definition",
          name: "Degraded",
          startByte: 11,
          endByte: 20,
          metadata: {},
        },
      ],
      parentOf: () => null,
      cstText: () => null,
    };

    const smv = exportToNuXmv(fakeDb as any, {
      moduleName: "VehicleController",
      inputVars: [
        { name: "pedal_pos", type: "0..100" },
        { name: "brake_pressed", type: "boolean" },
      ],
      outputVars: [{ name: "torque_demand", type: "-500..500" }],
      substates: {
        mode: ["Standby", "Active", "Emergency"],
      },
    });

    assert(smv.includes("MODULE VehicleController"));
    assert(smv.includes("IVAR"));
    assert(smv.includes("pedal_pos : 0..100;"));
    assert(smv.includes("brake_pressed : boolean;"));
    assert(smv.includes("state : { Normal, Degraded };"));
    assert(smv.includes("mode : { Standby, Active, Emergency };"));
    assert(smv.includes("torque_demand : -500..500;"));
    assert(smv.includes("init(mode) := Standby;"));
  });

  it("should export compositional assume-guarantee contracts to OCRA (.oss) format", () => {
    const contracts = [
      {
        name: "PowerSourceContract",
        inputs: ["grid_voltage"],
        outputs: ["v_out", "i_out"],
        assumptions: ["grid_voltage >= 110.0 && grid_voltage <= 240.0"],
        guarantees: ["v_out >= 48.0 && v_out <= 52.0", "i_out <= 20.0"],
      },
      {
        name: "MotorContract",
        inputs: ["v_in", "i_in"],
        outputs: ["torque", "speed"],
        assumptions: ["v_in >= 45.0 && v_in <= 55.0"],
        guarantees: ["torque <= 150.0"],
      },
    ];

    const oss = exportToOcra(contracts, { systemName: "DriveSystem" });

    assert(oss.includes("COMPONENT DriveSystem"));
    assert(oss.includes("INTERFACE"));
    assert(oss.includes("INPUT grid_voltage : real;"));
    assert(oss.includes("INPUT v_in : real;"));
    assert(oss.includes("OUTPUT v_out : real;"));
    assert(oss.includes("CONTRACT PowerSourceContract"));
    assert(oss.includes("assume: grid_voltage >= 110.0 and grid_voltage <= 240.0;"));
    assert(oss.includes("guarantee: v_out >= 48.0 and v_out <= 52.0 and i_out <= 20.0;"));
    assert(oss.includes("CONTRACT MotorContract"));
    assert(oss.includes("assume: v_in >= 45.0 and v_in <= 55.0;"));
    assert(oss.includes("guarantee: torque <= 150.0;"));
  });
});
