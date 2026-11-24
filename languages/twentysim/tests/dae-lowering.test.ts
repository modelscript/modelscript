// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerTwentySimToDae, twentySimToDae } from "../src/dae/index.js";
import { parseTwentySim } from "../src/parser/index.js";

const MASS_SPRING_DAMPER_EMX = `<?xml version="1.0"?>
<Document version="5.1">
  <Model name="MassSpringDamper">
    <Submodels>
      <Submodel name="F" type="Se"><Parameters><Parameter name="effort" value="10.0"/></Parameters></Submodel>
      <Submodel name="j1" type="1"/>
      <Submodel name="m" type="I"><Parameters><Parameter name="i" value="2.0"/></Parameters></Submodel>
      <Submodel name="b" type="R"><Parameters><Parameter name="r" value="1.0"/></Parameters></Submodel>
      <Submodel name="k" type="C"><Parameters><Parameter name="c" value="0.5"/></Parameters></Submodel>
    </Submodels>
    <Connections>
      <Connection id="b1" type="bond" from="F.p" to="j1.p"/>
      <Connection id="b2" type="bond" from="j1.p" to="m.p"/>
      <Connection id="b3" type="bond" from="j1.p" to="b.p"/>
      <Connection id="b4" type="bond" from="j1.p" to="k.p"/>
    </Connections>
  </Model>
</Document>`;

describe("20-sim Direct DAEBuilder Arena Lowering", () => {
  it("lowers a Mass-Spring-Damper Bond Graph (Se-1-I/R/C) into a balanced DAE", () => {
    const model = parseTwentySim(MASS_SPRING_DAMPER_EMX);
    const builder = new DAEBuilder(undefined, "MassSpringDamper");
    const res = lowerTwentySimToDae(builder, model);

    // 2 states: momentum (m_p_state) and displacement (k_q)
    assert.strictEqual(res.stateVarIndices.length, 2);
    // 4 parameters: F_effort, m_i, b_r, k_c
    assert.strictEqual(res.parameterVarIndices.length, 4);
    // Equations: Se(1) + I(2) + R(1) + C(2) + 1-junction(3 flow equalities + 1 effort balance) = 10
    assert.strictEqual(res.equationCount, 10);
    assert.strictEqual(builder.eqCount, 10);
    assert.ok(builder.lookupVariable("m_p_state") !== -1);
    assert.ok(builder.lookupVariable("k_q") !== -1);
  });

  it("lowers a parallel RLC Bond Graph on a 0-junction", () => {
    const rlcSid = `
model ParallelRLC
  submodels
    Sf Is (flow = 2.0);
    ZeroJunction j0;
    R R1 (r = 10.0);
    C C1 (c = 0.01);
    I L1 (i = 0.1);
  connections
    Is.p => j0.p;
    j0.p => R1.p;
    j0.p => C1.p;
    j0.p => L1.p;
end ParallelRLC;
`;
    const dae = twentySimToDae(rlcSid);
    assert.strictEqual(dae.eqCount, 10);
    assert.ok(dae.lookupVariable("C1_q") !== -1);
    assert.ok(dae.lookupVariable("L1_p_state") !== -1);
  });

  it("lowers Transformer (TF) and Gyrator (GY) two-port power-conserving elements", () => {
    const tfGySid = `
model ElectroMechanical
  submodels
    Se V (effort = 12.0);
    GY motor (r = 0.5);
    TF gear (r = 3.0);
    R load (r = 2.0);
  connections
    V.p => motor.p1;
    motor.p2 => gear.p1;
    gear.p2 => load.p;
end ElectroMechanical;
`;
    const dae = twentySimToDae(tfGySid);
    // Se(1) + GY(2) + TF(2) + R(1) + 3 direct bonds * 2 = 12 equations
    assert.strictEqual(dae.eqCount, 12);
    assert.ok(dae.lookupVariable("motor_p1_e") !== -1);
    assert.ok(dae.lookupVariable("gear_p2_f") !== -1);
  });

  it("lowers standalone SIDOPS ddt() and int() equations directly into DAEBuilder", () => {
    const sid = `
model FirstOrderDecay
  parameters
    real tau = 0.5;
  variables
    real x = 1.0;
  equations
    x = int(-x / tau, 1.0);
end FirstOrderDecay;
`;
    const model = parseTwentySim(sid);
    const builder = new DAEBuilder(undefined, "FirstOrderDecay");
    const res = lowerTwentySimToDae(builder, model);

    assert.strictEqual(res.stateVarIndices.length, 1);
    assert.strictEqual(res.parameterVarIndices.length, 1);
    assert.strictEqual(res.equationCount, 1);
  });
});
