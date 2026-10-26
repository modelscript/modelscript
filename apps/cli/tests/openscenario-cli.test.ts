// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { OpenScenarioCommand } from "../src/commands/openscenario.js";

const CLI_SCENARIO_XOSC = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="2026-10-26" description="CliTestScenario" author="ModelScript"/>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="Ego" vehicleCategory="car">
        <Performance maxSpeed="50.0" maxAcceleration="4.0" maxDeceleration="8.0"/>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="LeadNpc">
      <Vehicle name="LeadNpc" vehicleCategory="car">
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
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>
                <SpeedActionTarget><AbsoluteTargetSpeed value="25.0"/></SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
        <Private entityRef="LeadNpc">
          <PrivateAction>
            <TeleportAction>
              <Position><WorldPosition x="40.0" y="0.0" z="0.0"/></Position>
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
      </Actions>
    </Init>
    <Story name="Story1">
      <Act name="Act1">
        <ManeuverGroup maximumExecutionCount="1" name="MG1">
          <Actors selectTriggeringEntities="false"><EntityRef entityRef="LeadNpc"/></Actors>
          <Maneuver name="M1">
            <Event name="Ev1" priority="overwrite" maximumExecutionCount="1">
              <Action name="Brake">
                <PrivateAction>
                  <LongitudinalAction>
                    <SpeedAction>
                      <SpeedActionDynamics dynamicsShape="linear" value="2.0" dynamicsDimension="rate"/>
                      <SpeedActionTarget><AbsoluteTargetSpeed value="10.0"/></SpeedActionTarget>
                    </SpeedAction>
                  </LongitudinalAction>
                </PrivateAction>
              </Action>
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="TimeTrig" delay="0.0" conditionEdge="rising">
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

test("OpenSCENARIO CLI Commands (msx openscenario inspect, lint, simulate, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_openscenario_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const xoscFile = path.join(tmpDir, "scenario.xosc");
  fs.writeFileSync(xoscFile, CLI_SCENARIO_XOSC, "utf-8");

  await t.test("msx openscenario inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenScenarioCommand.handler as any)({
        action: "inspect",
        files: [xoscFile],
      });
      assert.ok(logs.some((l) => l.includes("OpenSCENARIO Summary")));
      assert.ok(logs.some((l) => l.includes("CliTestScenario")));
      assert.ok(logs.some((l) => l.includes("Ego (Ego vehicle)")));
      assert.ok(logs.some((l) => l.includes("LeadNpc")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx openscenario lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenScenarioCommand.handler as any)({
        action: "lint",
        files: [xoscFile],
      });
      assert.ok(logs.some((l) => l.includes("Clean scenario: 0 diagnostics")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx openscenario simulate", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenScenarioCommand.handler as any)({
        action: "simulate",
        files: [xoscFile],
        duration: 3.0,
      });
      assert.ok(logs.some((l) => l.includes("OpenSCENARIO Simulation")));
      assert.ok(logs.some((l) => l.includes("Minimum TTC:")));
      assert.ok(logs.some((l) => l.includes("Final Actor Positions:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx openscenario to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenScenarioCommand.handler as any)({
        action: "to-dae",
        files: [xoscFile],
      });
      assert.ok(logs.some((l) => l.includes("OpenSCENARIO DAE Lowering")));
      assert.ok(logs.some((l) => l.includes("Arena Variables:")));
      assert.ok(logs.some((l) => l.includes("Arena Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx openscenario to-modelica", async () => {
    const moFile = path.join(tmpDir, "scenario.mo");
    await (OpenScenarioCommand.handler as any)({
      action: "to-modelica",
      files: [xoscFile],
      out: moFile,
    });
    assert.ok(fs.existsSync(moFile));
    const moContent = fs.readFileSync(moFile, "utf-8");
    assert.ok(moContent.includes("model scenario"));
    assert.ok(moContent.includes("Ego_x"));
    assert.ok(moContent.includes("der(Ego_x)"));
  });
});
