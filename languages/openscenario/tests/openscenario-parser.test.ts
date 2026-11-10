// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenScenario, serializeOpenScenario } from "../src/index.js";

const TEST_SCENARIO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="2026-10-26T12:00:00" description="Parser Test Scenario" author="ModelScript"/>
  <ParameterDeclarations>
    <ParameterDeclaration name="InitVelocity" parameterType="double" value="25.5"/>
    <ParameterDeclaration name="LaneIndex" parameterType="integer" value="2"/>
    <ParameterDeclaration name="ActiveFlag" parameterType="boolean" value="true"/>
  </ParameterDeclarations>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car">
        <Performance maxSpeed="50.0" maxAcceleration="3.5" maxDeceleration="7.0"/>
        <BoundingBox>
          <Center x="0.0" y="0.0" z="0.0"/>
          <Dimensions width="1.8" length="4.5" height="1.4"/>
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="Pedestrian1">
      <Pedestrian name="Pedestrian1" pedestrianCategory="pedestrian" mass="75.0">
        <BoundingBox>
          <Center x="0.0" y="0.0" z="0.0"/>
          <Dimensions width="0.5" length="0.5" height="1.75"/>
        </BoundingBox>
      </Pedestrian>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="Ego">
          <PrivateAction>
            <TeleportAction>
              <Position>
                <LanePosition roadId="1" laneId="1" s="10.0"/>
              </Position>
            </TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="$InitVelocity"/>
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
        <Private entityRef="Pedestrian1">
          <PrivateAction>
            <TeleportAction>
              <Position>
                <WorldPosition x="100.0" y="5.0" z="0.0" h="1.57"/>
              </Position>
            </TeleportAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
    <Story name="PedestrianCrossingStory">
      <Act name="CrossingAct">
        <ManeuverGroup maximumExecutionCount="1" name="CrossingGroup">
          <Actors selectTriggeringEntities="false">
            <EntityRef entityRef="Pedestrian1"/>
          </Actors>
          <Maneuver name="CrossStreetManeuver">
            <Event name="StartWalkEvent" priority="overwrite" maximumExecutionCount="1">
              <Action name="WalkAction">
                <PrivateAction>
                  <LongitudinalAction>
                    <SpeedAction>
                      <SpeedActionDynamics dynamicsShape="linear" value="1.0" dynamicsDimension="rate"/>
                      <SpeedActionTarget>
                        <AbsoluteTargetSpeed value="1.4"/>
                      </SpeedActionTarget>
                    </SpeedAction>
                  </LongitudinalAction>
                </PrivateAction>
              </Action>
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="TimeCond" delay="0.0" conditionEdge="rising">
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

test("OpenSCENARIO Parser: correctly parses parameters, entities, bounding boxes, and init actions", () => {
  const doc = parseOpenScenario(TEST_SCENARIO_XML, "pedestrian.xosc");

  assert.equal(doc.header.revMajor, 1);
  assert.equal(doc.header.revMinor, 2);
  assert.equal(doc.parameters.length, 3);
  assert.equal(doc.parameters[0]!.name, "InitVelocity");
  assert.equal(doc.parameters[0]!.value, "25.5");

  assert.equal(doc.entities.size, 2);
  const ego = doc.entities.get("Ego");
  assert.ok(ego);
  assert.equal(ego.isEgo, true);
  assert.equal(ego.initialSpeed, 25.5);
  assert.equal(ego.boundingBox?.dimensions.length, 4.5);

  const ped = doc.entities.get("Pedestrian1");
  assert.ok(ped);
  assert.equal(ped.initialPosition?.kind, "world");
  assert.equal(ped.initialPosition?.world?.x, 100.0);
  assert.equal(ped.initialPosition?.world?.y, 5.0);

  assert.equal(doc.stories.length, 1);
  assert.equal(doc.stories[0]!.name, "PedestrianCrossingStory");
});

test("OpenSCENARIO Serializer: preserves XML hierarchy, entities, and storyboard elements", () => {
  const doc = parseOpenScenario(TEST_SCENARIO_XML);
  const xml = serializeOpenScenario(doc);

  assert.ok(xml.includes("<OpenSCENARIO>"));
  assert.ok(xml.includes("PedestrianCrossingStory"));
  assert.ok(xml.includes('name="Ego"'));
  assert.ok(xml.includes('name="Pedestrian1"'));

  const reparsed = parseOpenScenario(xml);
  assert.equal(reparsed.entities.size, 2);
  assert.equal(reparsed.stories.length, 1);
});
