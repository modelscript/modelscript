// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOpenScenario,
  lintOpenScenario,
} from "../src/index.js";

test("OpenSCENARIO Linter: detects dangling entity references (M8501) and negative speeds (M8506)", () => {
  const badXml = `<?xml version="1.0" encoding="UTF-8"?>
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
        <Private entityRef="Ghost">
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="-5.0"/>
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
  </Storyboard>
</OpenSCENARIO>`;

  const doc = parseOpenScenario(badXml);
  const diags = lintOpenScenario(doc);

  const m8501 = diags.find((d) => d.code === 8501);
  assert.ok(m8501, "Expected M8501 dangling entity reference");
  assert.ok(m8501.message.includes("'Ghost'"));

  const m8506 = diags.find((d) => d.code === 8506);
  assert.ok(m8506, "Expected M8506 negative speed");
});

test("OpenSCENARIO Linter: detects missing ego vehicle (M8505) and empty maneuver groups (M8509)", () => {
  const badXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="0" date="" description="" author=""/>
  <Entities>
    <ScenarioObject name="Npc1">
      <Vehicle name="Npc1" vehicleCategory="car"/>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Story name="S1">
      <Act name="A1">
        <ManeuverGroup maximumExecutionCount="1" name="EmptyMG">
          <Actors selectTriggeringEntities="false"/>
        </ManeuverGroup>
      </Act>
    </Story>
  </Storyboard>
</OpenSCENARIO>`;

  const doc = parseOpenScenario(badXml);
  const diags = lintOpenScenario(doc);

  assert.ok(diags.some((d) => d.code === 8505), "Expected M8505 missing ego");
  assert.ok(diags.some((d) => d.code === 8509), "Expected M8509 empty maneuver group");
});

test("OpenSCENARIO Linter: detects imminent collision in initial state (M8508)", () => {
  const badXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="0" date="" description="" author=""/>
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
        </Private>
        <Private entityRef="Lead">
          <PrivateAction>
            <TeleportAction>
              <Position><WorldPosition x="0.5" y="0.0" z="0.0"/></Position>
            </TeleportAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
  </Storyboard>
</OpenSCENARIO>`;

  const doc = parseOpenScenario(badXml);
  const diags = lintOpenScenario(doc);
  assert.ok(diags.some((d) => d.code === 8508), "Expected M8508 initial state collision");
});
