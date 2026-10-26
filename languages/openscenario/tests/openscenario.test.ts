// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  lintOpenScenario,
  lowerOpenScenarioToDae,
  openScenarioToModelica,
  OpenScenarioWorkspaceIndex,
  parseOpenScenario,
  serializeOpenScenario,
  simulateScenario,
} from "../src/index.js";

const VALID_CUT_IN_SCENARIO = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="2026-10-26T12:00:00" description="Highway Cut-In Verification Scenario" author="ModelScript"/>
  <ParameterDeclarations>
    <ParameterDeclaration name="EgoSpeed" parameterType="double" value="30.0"/>
    <ParameterDeclaration name="LeadSpeed" parameterType="double" value="25.0"/>
  </ParameterDeclarations>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car">
        <Performance maxSpeed="55.0" maxAcceleration="4.0" maxDeceleration="8.0"/>
        <BoundingBox>
          <Center x="0.0" y="0.0" z="0.0"/>
          <Dimensions width="1.9" length="4.8" height="1.4"/>
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="NpcLead">
      <Vehicle name="NpcLead" vehicleCategory="car">
        <Performance maxSpeed="45.0" maxAcceleration="3.0" maxDeceleration="7.0"/>
        <BoundingBox>
          <Center x="0.0" y="0.0" z="0.0"/>
          <Dimensions width="1.8" length="4.5" height="1.5"/>
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
                <WorldPosition x="0.0" y="0.0" z="0.0" h="0.0"/>
              </Position>
            </TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="30.0"/>
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
        <Private entityRef="NpcLead">
          <PrivateAction>
            <TeleportAction>
              <Position>
                <WorldPosition x="50.0" y="0.0" z="0.0" h="0.0"/>
              </Position>
            </TeleportAction>
          </PrivateAction>
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="25.0"/>
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
    <Story name="CutInStory">
      <Act name="CutInAct">
        <ManeuverGroup maximumExecutionCount="1" name="BrakingManeuverGroup">
          <Actors selectTriggeringEntities="false">
            <EntityRef entityRef="NpcLead"/>
          </Actors>
          <Maneuver name="DecelManeuver">
            <Event name="BrakingEvent" priority="overwrite" maximumExecutionCount="1">
              <Action name="BrakeAction">
                <PrivateAction>
                  <LongitudinalAction>
                    <SpeedAction>
                      <SpeedActionDynamics dynamicsShape="linear" value="3.0" dynamicsDimension="rate"/>
                      <SpeedActionTarget>
                        <AbsoluteTargetSpeed value="15.0"/>
                      </SpeedActionTarget>
                    </SpeedAction>
                  </LongitudinalAction>
                </PrivateAction>
              </Action>
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="TimeTrigger" delay="0.0" conditionEdge="rising">
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

test("OpenSCENARIO Parser: parses valid ASAM OpenSCENARIO XML into structured AST", () => {
  const doc = parseOpenScenario(VALID_CUT_IN_SCENARIO, "cut_in.xosc");
  assert.equal(doc.header.revMajor, 1);
  assert.equal(doc.header.revMinor, 2);
  assert.equal(doc.header.description, "Highway Cut-In Verification Scenario");
  assert.equal(doc.parameters.length, 2);
  assert.equal(doc.entities.size, 2);

  const ego = doc.entities.get("Ego");
  assert.ok(ego);
  assert.equal(ego.isEgo, true);
  assert.equal(ego.performance?.maxSpeed, 55.0);
  assert.equal(ego.initialPosition?.kind, "world");
  assert.equal(ego.initialPosition?.world?.x, 0.0);
  assert.equal(ego.initialSpeed, 30.0);

  const lead = doc.entities.get("NpcLead");
  assert.ok(lead);
  assert.equal(lead.initialPosition?.world?.x, 50.0);
  assert.equal(lead.initialSpeed, 25.0);

  assert.equal(doc.stories.length, 1);
  const story = doc.stories[0]!;
  assert.equal(story.name, "CutInStory");
  assert.equal(story.acts.length, 1);
  const act = story.acts[0]!;
  assert.equal(act.maneuverGroups.length, 1);
  const mg = act.maneuverGroups[0]!;
  assert.deepEqual(mg.actors, ["NpcLead"]);
  assert.equal(mg.maneuvers.length, 1);
  const ev = mg.maneuvers[0]!.events[0]!;
  assert.equal(ev.name, "BrakingEvent");
  assert.equal(ev.triggerConditions.length, 1);
  assert.equal(ev.triggerConditions[0]!.kind, "simulationTime");
  assert.equal(ev.actions.length, 1);
  assert.equal(ev.actions[0]!.targetSpeed, 15.0);
});

test("OpenSCENARIO Serializer: round-trips parsed AST back to valid ASAM XML", () => {
  const doc = parseOpenScenario(VALID_CUT_IN_SCENARIO);
  const xml = serializeOpenScenario(doc);
  assert.ok(xml.includes("<OpenSCENARIO>"));
  assert.ok(xml.includes('name="Ego"'));
  assert.ok(xml.includes('name="NpcLead"'));
  assert.ok(xml.includes("<Storyboard>"));
  assert.ok(xml.includes("CutInStory"));
  assert.ok(xml.includes("BrakingEvent"));

  // Verify re-parsing
  const doc2 = parseOpenScenario(xml);
  assert.equal(doc2.entities.size, 2);
  assert.equal(doc2.stories.length, 1);
});

test("OpenSCENARIO Linter: detects dangling entity reference and negative speed (M8501, M8506)", () => {
  const flawedXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="0" date="" description="" author=""/>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car"/>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="GhostCar">
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="-10.0"/>
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
  </Storyboard>
</OpenSCENARIO>`;

  const doc = parseOpenScenario(flawedXml);
  const diags = lintOpenScenario(doc);

  const m8501 = diags.find((d) => d.code === 8501);
  assert.ok(m8501, "Expected M8501 dangling entity reference");
  assert.ok(m8501.message.includes("'GhostCar'"));

  const m8506 = diags.find((d) => d.code === 8506);
  assert.ok(m8506, "Expected M8506 negative speed target");
  assert.ok(m8506.message.includes("-10"));
});

test("OpenSCENARIO Linter: detects unreachable road position and invalid condition delay (M8503, M8510)", () => {
  const flawedXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="0" date="" description="" author=""/>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car"/>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="Ego">
          <PrivateAction>
            <TeleportAction>
              <Position>
                <LanePosition roadId="0" laneId="0" s="10.0"/>
              </Position>
            </TeleportAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
    <Story name="S1">
      <Act name="A1">
        <ManeuverGroup maximumExecutionCount="1" name="MG1">
          <Actors selectTriggeringEntities="false"><EntityRef entityRef="Ego"/></Actors>
          <Maneuver name="M1">
            <Event name="E1" priority="overwrite" maximumExecutionCount="1">
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="BadDelay" delay="-2.5" conditionEdge="rising">
                    <ByValueCondition>
                      <SimulationTimeCondition value="1.0" rule="greaterOrEqual"/>
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

  const doc = parseOpenScenario(flawedXml);
  const diags = lintOpenScenario(doc);

  const m8503 = diags.find((d) => d.code === 8503);
  assert.ok(m8503, "Expected M8503 unreachable road position");

  const m8510 = diags.find((d) => d.code === 8510);
  assert.ok(m8510, "Expected M8510 invalid negative condition delay");
});

test("OpenSCENARIO Linter: detects missing ego vehicle and empty maneuver group (M8505, M8509)", () => {
  const flawedXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="0" date="" description="" author=""/>
  <Entities>
    <ScenarioObject name="Npc1">
      <Vehicle name="Npc1" vehicleCategory="car"/>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Story name="S">
      <Act name="A">
        <ManeuverGroup maximumExecutionCount="1" name="EmptyGroup">
          <Actors selectTriggeringEntities="false"/>
        </ManeuverGroup>
      </Act>
    </Story>
  </Storyboard>
</OpenSCENARIO>`;

  const doc = parseOpenScenario(flawedXml);
  const diags = lintOpenScenario(doc);

  const m8505 = diags.find((d) => d.code === 8505);
  assert.ok(m8505, "Expected M8505 missing ego vehicle");

  const m8509 = diags.find((d) => d.code === 8509);
  assert.ok(m8509, "Expected M8509 empty maneuver group");
});

test("OpenSCENARIO Linter: detects imminent collision initial state (M8508)", () => {
  const collisionXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="0" date="" description="" author=""/>
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
            <TeleportAction>
              <Position><WorldPosition x="10.0" y="0.0" z="0.0"/></Position>
            </TeleportAction>
          </PrivateAction>
        </Private>
        <Private entityRef="Npc1">
          <PrivateAction>
            <TeleportAction>
              <Position><WorldPosition x="10.4" y="0.0" z="0.0"/></Position>
            </TeleportAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
  </Storyboard>
</OpenSCENARIO>`;

  const doc = parseOpenScenario(collisionXml);
  const diags = lintOpenScenario(doc);
  const m8508 = diags.find((d) => d.code === 8508);
  assert.ok(m8508, "Expected M8508 imminent collision initial state");
  assert.ok(m8508.message.includes("0.40 m"));
});

test("OpenSCENARIO Solver: executes scenario orchestrator and evaluates kinematics & triggers", () => {
  const doc = parseOpenScenario(VALID_CUT_IN_SCENARIO);
  const res = simulateScenario(doc, { duration: 6.0, stepSize: 0.1 });

  assert.equal(res.totalDuration, 6.0);
  assert.ok(res.stepsCount > 50);

  // Ego started at x=0 with v=30; Lead started at x=50 with v=25
  const egoFinal = res.finalStates["Ego"];
  const leadFinal = res.finalStates["NpcLead"];
  assert.ok(egoFinal);
  assert.ok(leadFinal);

  assert.ok(egoFinal.x > 100);
  assert.ok(leadFinal.x > 100);
  // Lead should have decelerated from 25 to 15 after t=2s
  assert.equal(leadFinal.speed, 15.0);
});

test("OpenSCENARIO Solver: evaluates Time-To-Collision (TTC) and RSS safety margins", () => {
  const doc = parseOpenScenario(VALID_CUT_IN_SCENARIO);
  const res = simulateScenario(doc, { duration: 5.0, stepSize: 0.1 });

  assert.ok(res.minTtc < 15.0, "Expected valid TTC evaluation");
  assert.ok(res.minDistance > 0, "Expected non-zero minimum distance");

  // Lead decelerates so closing velocity increases, triggering RSS safety violation or TTC warning
  assert.ok(res.trajectory.some((s) => s.ttc !== undefined));
  assert.ok(res.trajectory.some((s) => s.rssMinDistance !== undefined));
});

test("OpenSCENARIO DAE Lowering: compiles scenario into DAEBuilder linear memory arena", () => {
  const doc = parseOpenScenario(VALID_CUT_IN_SCENARIO);
  const dae = lowerOpenScenarioToDae(doc);

  assert.ok(dae.variables().length >= 14, "Expected at least 14 variables (6 per entity + safety metrics)");
  assert.ok(dae.equations().length >= 14, "Expected at least 14 equations");

  assert.notEqual(dae.lookupVariable("Ego_x"), -1);
  assert.notEqual(dae.lookupVariable("Ego_vx"), -1);
  assert.notEqual(dae.lookupVariable("NpcLead_x"), -1);
  assert.notEqual(dae.lookupVariable("rel_distance"), -1);
  assert.notEqual(dae.lookupVariable("rel_speed"), -1);
});

test("OpenSCENARIO Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const doc = parseOpenScenario(VALID_CUT_IN_SCENARIO);
  const mo = openScenarioToModelica(doc, "HighwayCutIn");

  assert.ok(mo.includes("model HighwayCutIn"));
  assert.ok(mo.includes("Real Ego_x(start = 0.0)"));
  assert.ok(mo.includes("Real Ego_vx(start = 30.0)"));
  assert.ok(mo.includes("der(Ego_x) = Ego_vx;"));
  assert.ok(mo.includes("der(Ego_vx) = Ego_ax;"));
  assert.ok(mo.includes("rel_distance = NpcLead_x - Ego_x;"));
  assert.ok(mo.includes("time_to_collision = if rel_speed > 0.001"));
  assert.ok(mo.includes("end HighwayCutIn;"));
});

test("OpenSCENARIO Workspace Index: indexes multi-file symbols accurately", () => {
  const index = new OpenScenarioWorkspaceIndex();
  index.indexFile("file:///scenarios/cut_in.xosc", VALID_CUT_IN_SCENARIO);

  assert.equal(index.fileCount, 1);
  const symbols = index.getSymbols("file:///scenarios/cut_in.xosc");
  assert.ok(symbols.length >= 6);

  const egoSym = index.findDefinition("Ego");
  assert.ok(egoSym);
  assert.equal(egoSym.name, "Ego");
  assert.equal(egoSym.metadata["isEgo"], true);

  const leadSym = index.findDefinition("NpcLead");
  assert.ok(leadSym);
  assert.equal(leadSym.name, "NpcLead");

  const storySym = index.findDefinition("CutInStory");
  assert.ok(storySym);
});
