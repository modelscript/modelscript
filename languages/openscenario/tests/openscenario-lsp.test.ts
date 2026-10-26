// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  executeOpenScenarioAction,
  getOpenScenarioDocumentSymbols,
  getOpenScenarioHover,
  validateOpenScenario,
} from "../src/index.js";

const VALID_SCENARIO = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="2026-10-26" description="Highway Verification" author="ModelScript"/>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car">
        <Performance maxSpeed="50.0" maxAcceleration="4.0" maxDeceleration="8.0"/>
        <BoundingBox>
          <Center x="0.0" y="0.0" z="0.0"/>
          <Dimensions width="1.9" length="4.8" height="1.4"/>
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="LeadCar">
      <Vehicle name="LeadCar" vehicleCategory="car">
        <Performance maxSpeed="45.0" maxAcceleration="3.0" maxDeceleration="7.0"/>
      </Vehicle>
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
        </Private>
        <Private entityRef="LeadCar">
          <PrivateAction>
            <TeleportAction>
              <Position><WorldPosition x="60.0" y="0.0" z="0.0"/></Position>
            </TeleportAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
    <Story name="MainStory">
      <Act name="MainAct">
        <ManeuverGroup maximumExecutionCount="1" name="Group1">
          <Actors selectTriggeringEntities="false"><EntityRef entityRef="LeadCar"/></Actors>
          <Maneuver name="Maneuver1">
            <Event name="SlowDownEvent" priority="overwrite" maximumExecutionCount="1">
              <Action name="SpeedDown">
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
                  <Condition name="StartCondition" delay="0.0" conditionEdge="rising">
                    <ByValueCondition><SimulationTimeCondition value="1.0" rule="greaterOrEqual"/></ByValueCondition>
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

test("OpenSCENARIO LSP: validateOpenScenario returns 0 diagnostics on clean scenario", () => {
  const diags = validateOpenScenario(VALID_SCENARIO);
  assert.equal(diags.length, 0);
});

test("OpenSCENARIO LSP: validateOpenScenario returns diagnostics on flawed scenario", () => {
  const flawed = `<?xml version="1.0" encoding="UTF-8"?>
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
        <Private entityRef="UnknownVehicle">
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget><AbsoluteTargetSpeed value="-5.0"/></SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
  </Storyboard>
</OpenSCENARIO>`;

  const diags = validateOpenScenario(flawed);
  assert.ok(diags.length >= 2);
  assert.ok(diags.some((d) => d.code === "M8501"));
  assert.ok(diags.some((d) => d.code === "M8506"));
});

test("OpenSCENARIO LSP: getOpenScenarioDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getOpenScenarioDocumentSymbols(VALID_SCENARIO);
  assert.equal(symbols.length, 1);
  const root = symbols[0]!;
  assert.equal(root.name, "Highway Verification");
  assert.ok(root.children && root.children.length >= 3); // 2 entities + 1 story

  const egoSym = root.children?.find((c) => c.name === "Ego");
  assert.ok(egoSym);
  assert.ok(egoSym.detail?.includes("Ego"));

  const storySym = root.children?.find((c) => c.name === "MainStory");
  assert.ok(storySym);
});

test("OpenSCENARIO LSP: getOpenScenarioHover returns markdown hover info", () => {
  const lines = VALID_SCENARIO.split("\n");
  const egoLineIdx = lines.findIndex((l) => l.includes('<ScenarioObject name="Ego">'));
  assert.ok(egoLineIdx !== -1);

  const hover = getOpenScenarioHover(VALID_SCENARIO, { line: egoLineIdx, character: 25 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("OpenSCENARIO Entity: **Ego**"));
  assert.ok(hover.contents.value.includes("Autonomous Vehicle Under Test"));
  assert.ok(hover.contents.value.includes("Max Speed = 50 m/s"));
});

test("OpenSCENARIO LSP: executeOpenScenarioAction executes registered actions", async () => {
  // 1. lint
  const lints = await executeOpenScenarioAction("lint_openscenario", VALID_SCENARIO);
  assert.equal(lints.length, 0);

  // 2. simulate
  const sim = await executeOpenScenarioAction("openscenario_simulate", VALID_SCENARIO, { duration: 4.0 });
  assert.ok(sim);
  assert.equal(sim.totalDuration, 4.0);
  assert.ok(sim.finalStates["Ego"]);

  // 3. to-dae
  const daeSummary = await executeOpenScenarioAction("openscenario_to_dae", VALID_SCENARIO);
  assert.ok(daeSummary.variableCount >= 14);
  assert.ok(daeSummary.equationCount >= 14);

  // 4. to-modelica
  const mo = await executeOpenScenarioAction("openscenario_to_modelica", VALID_SCENARIO, {
    modelName: "LspTestScenario",
  });
  assert.ok(mo.includes("model LspTestScenario"));
  assert.ok(mo.includes("der(Ego_x) = Ego_vx;"));
});
