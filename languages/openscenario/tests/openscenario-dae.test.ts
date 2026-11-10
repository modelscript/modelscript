// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOpenScenario,
  lowerOpenScenarioToDae,
  openScenarioToModelica,
} from "../src/index.js";

const DAE_SCENARIO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="2026-10-26T12:00:00" description="DAE Lowering Test" author="ModelScript"/>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car"/>
    </ScenarioObject>
    <ScenarioObject name="Npc1">
      <Vehicle name="Npc1" vehicleCategory="car"/>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="Ego">
          <PrivateAction>
            <TeleportAction><Position><WorldPosition x="0.0" y="0.0" z="0.0"/></Position></TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget><AbsoluteTargetSpeed value="25.0"/></SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
        <Private entityRef="Npc1">
          <PrivateAction>
            <TeleportAction><Position><WorldPosition x="30.0" y="0.0" z="0.0"/></Position></TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget><AbsoluteTargetSpeed value="20.0"/></SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
  </Storyboard>
</OpenSCENARIO>`;

test("OpenSCENARIO DAE Lowering: builds continuous differential-algebraic equations in arena", () => {
  const doc = parseOpenScenario(DAE_SCENARIO_XML);
  const dae = lowerOpenScenarioToDae(doc);

  assert.ok(dae.variables().length >= 14);
  assert.ok(dae.equations().length >= 14);

  assert.notEqual(dae.lookupVariable("Ego_x"), -1);
  assert.notEqual(dae.lookupVariable("Ego_vx"), -1);
  assert.notEqual(dae.lookupVariable("Npc1_x"), -1);
  assert.notEqual(dae.lookupVariable("Npc1_vx"), -1);
  assert.notEqual(dae.lookupVariable("rel_distance"), -1);
  assert.notEqual(dae.lookupVariable("rel_speed"), -1);
});

test("OpenSCENARIO Modelica Projection: translates kinematic scenario to executable Modelica model", () => {
  const doc = parseOpenScenario(DAE_SCENARIO_XML);
  const mo = openScenarioToModelica(doc, "TwoCarKinematics");

  assert.ok(mo.includes("model TwoCarKinematics"));
  assert.ok(mo.includes("Real Ego_x(start = 0.0)"));
  assert.ok(mo.includes("Real Ego_vx(start = 25.0)"));
  assert.ok(mo.includes("der(Ego_x) = Ego_vx;"));
  assert.ok(mo.includes("rel_distance = Npc1_x - Ego_x;"));
  assert.ok(mo.includes("end TwoCarKinematics;"));
});
