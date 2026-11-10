// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for ASAM OpenSCENARIO (Autonomous Driving Simulation & ADAS Verification).
 *
 * Evaluates:
 * 1. Multi-agent highway cut-in and emergency braking scenario ingestion (XML v1.2)
 * 2. Scenario state-machine orchestrator execution and kinematic trajectory generation
 * 3. Formal safety metrics: Time-To-Collision (TTC) and Responsibility-Sensitive Safety (RSS)
 * 4. Continuous DAE linear memory arena lowering and Modelica projection
 */

import assert from "node:assert/strict";
import {
  parseOpenScenario,
  simulateScenario,
  lowerOpenScenarioToDae,
  openScenarioToModelica,
  type OpenScenarioDocument,
} from "../src/index.js";

export const OPENSCENARIO_HIGHWAY_BENCHMARK = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="2026-10-26T12:00:00" description="Industrial Multi-Agent Highway Cut-In &amp; Emergency Braking Benchmark" author="ModelScript"/>
  <ParameterDeclarations>
    <ParameterDeclaration name="EgoSpeed" parameterType="double" value="30.0"/>
    <ParameterDeclaration name="LeadTruckSpeed" parameterType="double" value="22.0"/>
    <ParameterDeclaration name="AggressiveCutInSpeed" parameterType="double" value="28.0"/>
  </ParameterDeclarations>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car">
        <Performance maxSpeed="60.0" maxAcceleration="4.5" maxDeceleration="8.5"/>
        <BoundingBox>
          <Center x="0.0" y="0.0" z="0.0"/>
          <Dimensions width="1.9" length="4.9" height="1.45"/>
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="AggressiveCutInCar">
      <Vehicle name="AggressiveCutInCar" vehicleCategory="car">
        <Performance maxSpeed="55.0" maxAcceleration="4.0" maxDeceleration="7.5"/>
        <BoundingBox>
          <Center x="0.0" y="0.0" z="0.0"/>
          <Dimensions width="1.85" length="4.6" height="1.4"/>
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="LeadTruck">
      <Vehicle name="LeadTruck" vehicleCategory="truck">
        <Performance maxSpeed="35.0" maxAcceleration="2.0" maxDeceleration="5.5"/>
        <BoundingBox>
          <Center x="0.0" y="0.0" z="0.0"/>
          <Dimensions width="2.5" length="12.0" height="3.8"/>
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="Ego">
          <PrivateAction>
            <TeleportAction>
              <Position>
                <LanePosition roadId="1" laneId="1" s="0.0"/>
              </Position>
            </TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="$EgoSpeed"/>
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
        <Private entityRef="AggressiveCutInCar">
          <PrivateAction>
            <TeleportAction>
              <Position>
                <LanePosition roadId="1" laneId="2" s="45.0"/>
              </Position>
            </TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="$AggressiveCutInSpeed"/>
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
        <Private entityRef="LeadTruck">
          <PrivateAction>
            <TeleportAction>
              <Position>
                <LanePosition roadId="1" laneId="1" s="120.0"/>
              </Position>
            </TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="$LeadTruckSpeed"/>
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
    <Story name="HighwayCutInStory">
      <Act name="CutInAndDecelAct">
        <ManeuverGroup maximumExecutionCount="1" name="CutInGroup">
          <Actors selectTriggeringEntities="false">
            <EntityRef entityRef="AggressiveCutInCar"/>
          </Actors>
          <Maneuver name="LateralCutInManeuver">
            <Event name="LaneChangeEvent" priority="overwrite" maximumExecutionCount="1">
              <Action name="LaneChangeAction">
                <PrivateAction>
                  <LateralAction>
                    <LaneChangeAction>
                      <LaneChangeActionDynamics dynamicsShape="sinusoidal" value="2.5" dynamicsDimension="time"/>
                      <LaneChangeTarget>
                        <AbsoluteTargetLane value="1"/>
                      </LaneChangeTarget>
                    </LaneChangeAction>
                  </LateralAction>
                </PrivateAction>
              </Action>
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="TimeCutInTrigger" delay="0.0" conditionEdge="rising">
                    <ByValueCondition>
                      <SimulationTimeCondition value="1.5" rule="greaterOrEqual"/>
                    </ByValueCondition>
                  </Condition>
                </ConditionGroup>
              </StartTrigger>
            </Event>
            <Event name="SuddenBrakeEvent" priority="overwrite" maximumExecutionCount="1">
              <Action name="BrakeHardAction">
                <PrivateAction>
                  <LongitudinalAction>
                    <SpeedAction>
                      <SpeedActionDynamics dynamicsShape="linear" value="3.5" dynamicsDimension="rate"/>
                      <SpeedActionTarget>
                        <AbsoluteTargetSpeed value="18.0"/>
                      </SpeedActionTarget>
                    </SpeedAction>
                  </LongitudinalAction>
                </PrivateAction>
              </Action>
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="TimeBrakeTrigger" delay="0.0" conditionEdge="rising">
                    <ByValueCondition>
                      <SimulationTimeCondition value="3.5" rule="greaterOrEqual"/>
                    </ByValueCondition>
                  </Condition>
                </ConditionGroup>
              </StartTrigger>
            </Event>
          </Maneuver>
        </ManeuverGroup>
        <ManeuverGroup maximumExecutionCount="1" name="EgoAebGroup">
          <Actors selectTriggeringEntities="false">
            <EntityRef entityRef="Ego"/>
          </Actors>
          <Maneuver name="EgoBrakeManeuver">
            <Event name="EgoAebEvent" priority="overwrite" maximumExecutionCount="1">
              <Action name="EgoBrakeAction">
                <PrivateAction>
                  <LongitudinalAction>
                    <SpeedAction>
                      <SpeedActionDynamics dynamicsShape="linear" value="5.0" dynamicsDimension="rate"/>
                      <SpeedActionTarget>
                        <AbsoluteTargetSpeed value="18.0"/>
                      </SpeedActionTarget>
                    </SpeedAction>
                  </LongitudinalAction>
                </PrivateAction>
              </Action>
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="AebTrigger" delay="0.0" conditionEdge="rising">
                    <ByValueCondition>
                      <SimulationTimeCondition value="3.8" rule="greaterOrEqual"/>
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

export interface OpenScenarioBenchmarkMetrics {
  entitiesCount: number;
  storiesCount: number;
  durationSeconds: number;
  stepsCount: number;
  minTtcSeconds: number;
  minDistanceMeters: number;
  hasCollision: boolean;
  daeVarCount: number;
  daeEqCount: number;
  modelicaLines: number;
}

export function runOpenScenarioBenchmark(
  xmlContent = OPENSCENARIO_HIGHWAY_BENCHMARK,
): OpenScenarioBenchmarkMetrics {
  const doc: OpenScenarioDocument = parseOpenScenario(xmlContent, "benchmark_cutin.xosc");

  assert.ok(doc, "OpenSCENARIO document must parse successfully");
  assert.equal(doc.entities.size, 3, "Must declare 3 scenario vehicles (Ego, NPC, Truck)");
  assert.equal(doc.stories.length, 1, "Must declare 1 story");

  const ego = doc.entities.get("Ego");
  const cutInCar = doc.entities.get("AggressiveCutInCar");
  const truck = doc.entities.get("LeadTruck");

  assert.ok(ego?.isEgo, "Ego vehicle must be recognized");
  assert.equal(ego.initialSpeed, 30.0, "Ego initial speed must match parameter $EgoSpeed");
  assert.equal(cutInCar?.initialSpeed, 28.0, "CutIn car initial speed must match $AggressiveCutInSpeed");
  assert.equal(truck?.initialSpeed, 22.0, "Lead truck initial speed must match $LeadTruckSpeed");

  // 1. Simulate scenario kinematics & safety metrics
  const sim = simulateScenario(doc, {
    duration: 8.0,
    stepSize: 0.05,
    reactionTime: 0.6,
    maxBrakingDecel: 6.5,
  });

  assert.equal(sim.totalDuration, 8.0);
  assert.ok(sim.stepsCount >= 160, "Expected >= 160 simulation steps at dt=0.05s");
  assert.equal(sim.hasCollision, false, "Well-designed benchmark scenario must avoid collision");
  assert.ok(sim.minDistance > 0 && sim.minDistance < 100, "Valid minimum distance range");
  assert.ok(sim.minTtc > 0 && sim.minTtc < 20, "Valid minimum TTC detected");

  // Verify lateral transition of cut-in vehicle to lane 1 (y ≈ 3.5 m)
  const cutInFinal = sim.finalStates["AggressiveCutInCar"];
  assert.ok(cutInFinal, "Cut-in car final state must be tracked");
  assert.ok(Math.abs(cutInFinal.y - 3.5) < 0.1, "Cut-in car must complete lane change to lane 1");

  // 2. Lower to DAEBuilder linear memory arena
  const dae = lowerOpenScenarioToDae(doc);
  assert.ok(dae.variables().length >= 18, "Expected >= 18 variables for 3 entities + safety states");
  assert.ok(dae.equations().length >= 18, "Expected >= 18 equations for 3 entities");

  // 3. Project to Modelica
  const mo = openScenarioToModelica(doc, "HighwayCutInBenchmark");
  assert.ok(mo.includes("model HighwayCutInBenchmark"));
  assert.ok(mo.includes("time_to_collision"));
  const moLines = mo.split("\n").length;

  return {
    entitiesCount: doc.entities.size,
    storiesCount: doc.stories.length,
    durationSeconds: sim.totalDuration,
    stepsCount: sim.stepsCount,
    minTtcSeconds: sim.minTtc,
    minDistanceMeters: sim.minDistance,
    hasCollision: sim.hasCollision,
    daeVarCount: dae.variables().length,
    daeEqCount: dae.equations().length,
    modelicaLines: moLines,
  };
}
