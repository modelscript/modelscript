// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dynamoToModelica, parseDynamo } from "../src/index.js";

describe("@modelscript/dynamo Projections Suite (DYNAMO -> Modelica)", () => {
  it("projects Levels, Rates, Auxiliaries, Initials, Constants, Tables, and CLIP/STEP to valid Modelica", () => {
    const src = `
NOTE GROWTH WITH POLICY STEP
L POP.K=POP.J+(DT)*(BIRTH.JK-DEATH.JK)
N POP=100
R BIRTH.KL=POP.K*BR
R DEATH.KL=POP.K*DR.K
A DR.K=CLIP(0.03, 0.01, TIME.K, 10)+STEP(0.005, 20)
C BR=0.05
T LUT=0/0.5/1.0
SPEC DT=0.25/LENGTH=50
`;
    const model = parseDynamo(src);
    const mo = dynamoToModelica(model);

    assert.ok(mo.includes("model GROWTH_WITH_POLICY_STEP"));
    assert.ok(mo.includes("parameter Real DT = 0.25;"));
    assert.ok(mo.includes("parameter Real BR = 0.05;"));
    assert.ok(mo.includes("parameter Real LUT[3] = {0.0, 0.5, 1.0};"));
    assert.ok(mo.includes("Real POP;"));
    assert.ok(mo.includes("initial equation"));
    assert.ok(mo.includes("POP = 100.0;"));
    assert.ok(mo.includes("der(POP) = (BIRTH - DEATH);"));
    assert.ok(mo.includes("if time >= 10.0 then 0.03 else 0.01"));
    assert.ok(mo.includes("if time >= 20.0 then 0.005 else 0.0"));
    assert.ok(mo.includes("experiment(StartTime=0.0, StopTime=50.0, Interval=0.25)"));
    assert.ok(mo.includes("end GROWTH_WITH_POLICY_STEP;"));
  });
});
