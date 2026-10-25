// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEasy5, parseEasy5Table } from "../src/index.js";

describe("@modelscript/easy5 Parser Suite", () => {
  it("parses classical and modern EASY5 models with components, parameters, and connections", () => {
    const source = `MODEL: FlightControlActuator
TITLE: "Pitch Axis Hydraulic Servo Loop"

COMPONENTS:
  LA01 TYPE=GP/LA TITLE="Pitch Rate Lead-Lag" X=100 Y=200
    XP: TAU1=0.05, TAU2=0.02, GAIN=2.5
    S0: S1=0.0

  SJ01 TYPE=GP/SJ TITLE="Error Summing Junction" X=300 Y=200
    XP: SGN1=1.0, SGN2=-1.0, K1=1.0, K2=1.0

  IN01 TYPE=GP/IN TITLE="Hydraulic Integrator" X=500 Y=200
    XP: GAIN=10.0, UL=1.0, LL=-1.0
    S0: S1=0.0

  LM01 TYPE=GP/LM TITLE="Stroke Limiter" X=700 Y=200
    XP: UL=0.8, LL=-0.8

CONNECTIONS:
  SJ01.OUT -> LA01.IN
  LA01.OUT -> IN01.IN
  IN01.OUT -> LM01.IN
  LM01.OUT -> SJ01.IN2
`;

    const model = parseEasy5(source);
    assert.strictEqual(model.name, "FlightControlActuator");
    assert.strictEqual(model.title, "Pitch Axis Hydraulic Servo Loop");
    assert.strictEqual(model.components.size, 4);

    const la = model.components.get("LA01");
    assert.ok(la);
    assert.strictEqual(la.type, "GP/LA");
    assert.strictEqual(la.title, "Pitch Rate Lead-Lag");
    assert.strictEqual(la.parameters["TAU1"], 0.05);
    assert.strictEqual(la.parameters["TAU2"], 0.02);
    assert.strictEqual(la.parameters["GAIN"], 2.5);
    assert.strictEqual(la.initialStates["S1"], 0.0);
    assert.strictEqual(la.location?.x, 100);
    assert.strictEqual(la.location?.y, 200);

    const sj = model.components.get("SJ01");
    assert.ok(sj);
    assert.strictEqual(sj.parameters["SGN2"], -1.0);

    assert.strictEqual(model.connections.length, 4);
    assert.strictEqual(model.connections[0]!.fromComponent, "SJ01");
    assert.strictEqual(model.connections[0]!.fromPort, "OUT");
    assert.strictEqual(model.connections[0]!.toComponent, "LA01");
    assert.strictEqual(model.connections[0]!.toPort, "IN");
  });

  it("extracts embedded User General (UG) Fortran code blocks", () => {
    const source = `MODEL: AeroUserComponent
COMPONENTS:
  UG01 TYPE=GP/UG TITLE="Aerodynamic Damping Block"
    PORTS: IN=input, OUT=output
    XP: DAMP=0.15
    FORTRAN:
      ! Continuous derivative equation
      SD(1) = -XP(1) * IN + S(1)
      OUT = S(1)
    ENDFORTRAN
`;

    const model = parseEasy5(source);
    const ug = model.components.get("UG01");
    assert.ok(ug);
    assert.ok(ug.userCode);
    assert.ok(ug.userCode.includes("SD(1) = -XP(1) * IN + S(1)"));
    assert.ok(ug.userCode.includes("OUT = S(1)"));
  });

  it("parses 1D and 2D lookup tables (.tab)", () => {
    const tableSource = `TABLE: AERO_COEFFICIENT
DIMENSION: 1
X: -10.0, -5.0, 0.0, 5.0, 10.0
DATA: -0.8, -0.4, 0.0, 0.45, 0.9
`;
    const tab = parseEasy5Table(tableSource);
    assert.strictEqual(tab.name, "AERO_COEFFICIENT");
    assert.strictEqual(tab.dimension, 1);
    assert.deepStrictEqual(tab.xValues, [-10.0, -5.0, 0.0, 5.0, 10.0]);
    assert.deepStrictEqual(tab.data, [-0.8, -0.4, 0.0, 0.45, 0.9]);
  });
});
