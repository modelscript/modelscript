// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOpenScenario,
  simulateScenario,
} from "../src/index.js";

const CAR_FOLLOWING_SCENARIO = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="2026-10-26T12:00:00" description="Car Following Kinematics" author="ModelScript"/>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car"/>
    </ScenarioObject>
    <ScenarioObject name="Lead">
      <Vehicle name="Lead" vehicleCategory="car"/>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="Ego">
          <PrivateAction>
            <TeleportAction>
              <Position><WorldPosition x="0.0" y="0.0" z="0.0"/></Position>
            </TeleportAction>
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
        <Private entityRef="Lead">
          <PrivateAction>
            <TeleportAction>
              <Position><WorldPosition x="40.0" y="0.0" z="0.0"/></Position>
            </TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget><AbsoluteTargetSpeed value="15.0"/></SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
    <Story name="Story1">
      <Act name="Act1">
        <ManeuverGroup maximumExecutionCount="1" name="MG1">
          <Actors selectTriggeringEntities="false"><EntityRef entityRef="Ego"/></Actors>
          <Maneuver name="M1">
            <Event name="SlowDownEvent" priority="overwrite" maximumExecutionCount="1">
              <Action name="Brake">
                <PrivateAction>
                  <LongitudinalAction>
                    <SpeedAction>
                      <SpeedActionDynamics dynamicsShape="linear" value="2.0" dynamicsDimension="rate"/>
                      <SpeedActionTarget><AbsoluteTargetSpeed value="15.0"/></SpeedActionTarget>
                    </SpeedAction>
                  </LongitudinalAction>
                </PrivateAction>
              </Action>
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="TtcWarning" delay="0.0" conditionEdge="rising">
                    <ByValueCondition>
                      <SimulationTimeCondition value="2.0" rule="greaterOrEqual"/>
                    </ByValueCondition>
                  </Condition>
                </ConditionGroup>
              </StartTrigger>
            </Event>
          </Maneuver>
        </ManeuverGroup>
      </Act>
    </Story>
  </Storyboard>
</OpenSCENARIO>`;

test("OpenSCENARIO Solver: computes kinematic integration and time-to-collision monitoring", () => {
  const doc = parseOpenScenario(CAR_FOLLOWING_SCENARIO);
  const res = simulateScenario(doc, { duration: 6.0, stepSize: 0.1 });

  assert.equal(res.totalDuration, 6.0);
  assert.ok(res.stepsCount >= 60);

  const egoFinal = res.finalStates["Ego"];
  const leadFinal = res.finalStates["Lead"];
  assert.ok(egoFinal);
  assert.ok(leadFinal);

  // Ego slowed down to 15 m/s to match lead
  assert.equal(egoFinal.speed, 15.0);
  assert.equal(leadFinal.speed, 15.0);

  // Both have moved forward
  assert.ok(egoFinal.x > 80.0);
  assert.ok(leadFinal.x > 100.0);

  // No collision occurred
  assert.equal(res.hasCollision, false);
  assert.ok(res.minTtc < 15.0);
});
