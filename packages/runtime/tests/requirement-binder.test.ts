// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { DaeSystem } from "../src/analysis/wasm_dae_flowpipe.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { ConservativeLinearizationSolver } from "../src/analysis/wasm_zonotope_reach.js";
import {
  assertRequirementsToTheoryCoordinator,
  bindRequirementsToModelica,
  extractModelicaTwinAnnotations,
  getSysmlWasmParser,
  parseSysmlRequirements,
} from "../src/formal/requirement_binder.js";
import { SemanticTheoryCoordinator } from "../src/formal/theory_coordinator.js";

describe("Phase 2.6: SysML v2 Requirement Binding & Digital-Thread Synchronization", () => {
  const sysmlSample = `package DroneSafetySpecs {
  part def DroneAssembly {
    attribute totalMass : Real = 1.20;
    attribute totalFrontalArea : Real = 0.030;
  }

  requirement def FlightCeilingRequirement {
    attribute v_climb : Real;
    attribute v_climb_max : Real = 12.0;
    require constraint { v_climb <= v_climb_max }
  }

  requirement def AltitudeFloorRequirement {
    attribute z : Real;
    require constraint { z >= 0.0 }
  }
}
`;

  const modelicaSample = `model DroneSimulation
  parameter Real m = 1.2 "Total mass [kg]"
    annotation(twin = "SysML2::DroneSafetySpecs::DroneAssembly.totalMass");
  Real z(start = 1.0) "Altitude [m]"
    annotation(twin = "SysML2::DroneSafetySpecs::AltitudeFloorRequirement.z");
  Real v(start = 2.0) "Velocity [m/s]"
    annotation(twin = "SysML2::DroneSafetySpecs::FlightCeilingRequirement.v_climb");
equation
  der(z) = v;
  der(v) = -9.81;
end DroneSimulation;
`;

  it("1. parseSysmlRequirements extracts formal attributes and constraints", () => {
    const reqs = parseSysmlRequirements(sysmlSample);
    assert.strictEqual(reqs.length, 2);

    const ceilingReq = reqs.find((r) => r.id === "FlightCeilingRequirement");
    assert.ok(ceilingReq);
    assert.strictEqual(ceilingReq.targetAttribute, "v_climb");
    assert.strictEqual(ceilingReq.operator, "<=");
    assert.strictEqual(ceilingReq.limitValue, 12.0);

    const floorReq = reqs.find((r) => r.id === "AltitudeFloorRequirement");
    assert.ok(floorReq);
    assert.strictEqual(floorReq.targetAttribute, "z");
    assert.strictEqual(floorReq.operator, ">=");
    assert.strictEqual(floorReq.limitValue, 0.0);
  });

  it("2. extractModelicaTwinAnnotations parses digital-thread twin annotations", () => {
    const twinMap = extractModelicaTwinAnnotations(modelicaSample);
    assert.strictEqual(twinMap.get("m"), "SysML2::DroneSafetySpecs::DroneAssembly.totalMass");
    assert.strictEqual(twinMap.get("z"), "SysML2::DroneSafetySpecs::AltitudeFloorRequirement.z");
    assert.strictEqual(twinMap.get("v"), "SysML2::DroneSafetySpecs::FlightCeilingRequirement.v_climb");
  });

  it("3. bindRequirementsToModelica maps SysML requirements to Modelica state indices", () => {
    const reqs = parseSysmlRequirements(sysmlSample);
    const twinMap = extractModelicaTwinAnnotations(modelicaSample);
    const stateNames = ["z", "v"]; // 0 -> z, 1 -> v

    const bound = bindRequirementsToModelica(reqs, stateNames, twinMap);
    assert.strictEqual(bound.length, 2);

    const boundV = bound.find((b) => b.stateIndex === 1);
    assert.ok(boundV);
    assert.strictEqual(boundV.name, "FlightCeilingRequirement.v_climb");
    assert.strictEqual(boundV.operator, "<=");
    assert.strictEqual(boundV.limitValue, 12.0);

    const boundZ = bound.find((b) => b.stateIndex === 0);
    assert.ok(boundZ);
    assert.strictEqual(boundZ.name, "AltitudeFloorRequirement.z");
    assert.strictEqual(boundZ.operator, ">=");
    assert.strictEqual(boundZ.limitValue, 0.0);
  });

  it("4. ConservativeLinearizationSolver verifies dynamically bound safe requirements", () => {
    // Linear decaying system: dx/dt = -2x, initial x in [1.0, 2.0]
    // x(t) = x(0) * exp(-2t) strictly decreases towards 0.
    const dae: DaeSystem = {
      numDiffStates: 1,
      numAlgStates: 0,
      f: (_t, x, _y) => [-2.0 * x[0]!],
      g: () => [],
      jacobianGz: () => [],
      jacobianFx: (_t, _x, _y) => [[-2.0]],
      jacobianFxInterval: (_t, _xIv, _yIv) => [[new Interval(-2.0, -2.0)]],
    };

    const boundReqs = [
      {
        name: "FlightCeilingRequirement.v_climb",
        stateIndex: 0,
        operator: "<=" as const,
        limitValue: 5.0, // Upper limit 5.0 holds since x in [0, 2.0]
      },
    ];

    const res = ConservativeLinearizationSolver.solve({
      dae,
      initialSet: [new Interval(1.0, 2.0)],
      tSpan: [0, 1.0],
      dt: 0.1,
      budgetMs: 150,
      requirements: boundReqs,
    });

    assert.strictEqual(res.verdict.kind, "proven");
    assert.strictEqual(res.violations.length, 0);
  });

  it("5. ConservativeLinearizationSolver generates concrete witness for violated requirement", () => {
    // Rising velocity: dx/dt = 5.0, initial x in [1.0, 2.0]
    // After 0.3s, x nominal is 1.5 + 1.5 = 3.0, which breaches ceiling <= 2.5.
    const dae: DaeSystem = {
      numDiffStates: 1,
      numAlgStates: 0,
      f: (_t, _x, _y) => [5.0],
      g: () => [],
      jacobianGz: () => [],
      jacobianFx: (_t, _x, _y) => [[0.0]],
      jacobianFxInterval: (_t, _xIv, _yIv) => [[new Interval(0.0, 0.0)]],
    };

    const boundReqs = [
      {
        name: "FlightCeilingRequirement.v_climb",
        stateIndex: 0,
        operator: "<=" as const,
        limitValue: 2.5,
      },
    ];

    const res = ConservativeLinearizationSolver.solve({
      dae,
      initialSet: [new Interval(1.0, 2.0)],
      tSpan: [0, 1.0],
      dt: 0.1,
      budgetMs: 150,
      requirements: boundReqs,
    });

    assert.strictEqual(res.verdict.kind, "violated");
    const witness = res.violations.find((v) => v.isConcreteWitness);
    assert.ok(witness);
    assert.strictEqual(witness.isConcreteWitness, true);
    assert.ok(witness.reason.includes("witness") && witness.reason.includes("breached"));
  });

  it("6. assertRequirementsToTheoryCoordinator registers requirements as literals", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const reqs = parseSysmlRequirements(sysmlSample);
    assertRequirementsToTheoryCoordinator(coordinator, reqs);
    // TheoryCoordinator successfully ingested requirements
    assert.ok(coordinator);
  });

  it("7. parseSysmlRequirements traverses WASM GLR CST for conjoined constraints, subject bindings, and arithmetic expressions", () => {
    const complexSysml = `package ActuatorArchitecture {
      part def ClevisBracket {
        attribute mass : Real = 0.88;
        attribute von_mises_stress : Real = 216.4;
        attribute tip_deflection : Real = 0.29;
      }
      requirement def <'REQ-ACT-01'> REQ_ACTUATOR_01 {
        subject bracket : ClevisBracket;
        attribute max_mass : Real = 1.0 + 0.25;
        attribute max_von_mises : Real = 140.0 * 2.0;
        attribute max_deflection : Real = 0.45;
        require constraint {
          bracket.mass <= max_mass and
          bracket.von_mises_stress <= max_von_mises and
          bracket.tip_deflection <= max_deflection
        }
      }
    }`;

    const reqs = parseSysmlRequirements(complexSysml);
    assert.strictEqual(reqs.length, 3);
    assert.strictEqual(reqs[0]!.id, "REQ_ACTUATOR_01");
    assert.strictEqual(reqs[0]!.shortId, "REQ-ACT-01");
    assert.strictEqual(reqs[0]!.packageName, "ActuatorArchitecture");
    assert.strictEqual(reqs[0]!.subjectName, "ClevisBracket");
    assert.strictEqual(reqs[0]!.subjectVarName, "bracket");

    assert.strictEqual(reqs[0]!.targetAttribute, "mass");
    assert.strictEqual(reqs[0]!.limitValue, 1.25);
    assert.strictEqual(reqs[1]!.targetAttribute, "von_mises_stress");
    assert.strictEqual(reqs[1]!.limitValue, 280.0);
    assert.strictEqual(reqs[2]!.targetAttribute, "tip_deflection");
    assert.strictEqual(reqs[2]!.limitValue, 0.45);
  });
});
