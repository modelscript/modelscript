// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePlcopen } from "../../../languages/plcopen/src/index.js";
import {
  buildPlcopenDiagram,
  parsePlcopenTextToProject,
  renderPlcopenSvg,
  synthesizeFbdBlocksFromPou,
} from "../src/plcopen-diagram-builder.js";

describe("PLCopen IEC 61131-3 FBD Diagram Builder", () => {
  it("synthesizes FBD logic & selector blocks from PLCopen TC6 XML laser-weld safety controller", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0201">
  <fileHeader companyName="ModelScript Industrial Automation" productName="IEC 61131-3 Compiler" productVersion="2026.1" />
  <contentHeader name="BatteryModule_LaserWeld_SIL3_CellController" />
  <types>
    <dataTypes />
    <pous>
      <pou name="PRG_LaserBusbarWeldCell" pouType="program">
        <interface>
          <inputVars>
            <variable name="bLightCurtainChA"><type><BOOL /></type></variable>
            <variable name="bLightCurtainChB"><type><BOOL /></type></variable>
            <variable name="bEStopResetPulse"><type><BOOL /></type></variable>
            <variable name="rArgonFlowLpm"><type><REAL /></type></variable>
            <variable name="rCellTempDegC"><type><REAL /></type></variable>
            <variable name="bPartClamped"><type><BOOL /></type></variable>
          </inputVars>
          <outputVars>
            <variable name="bSafetyRelayEnable"><type><BOOL /></type></variable>
            <variable name="bLaserEmissionGate"><type><BOOL /></type></variable>
            <variable name="rLaserPowerCmdWatts"><type><REAL /></type></variable>
            <variable name="iWeldStateCode"><type><INT /></type></variable>
          </outputVars>
        </interface>
        <body>
          <ST>
            <xhtml xmlns="http://www.w3.org/1999/xhtml">
bSafetyRelayEnable := bLightCurtainChA AND bLightCurtainChB AND NOT bEStopResetPulse AND (rCellTempDegC &lt; 55.0);
IF NOT bSafetyRelayEnable THEN
  bLaserEmissionGate  := FALSE;
  rLaserPowerCmdWatts := 0.0;
  iWeldStateCode      := -1;
ELSIF bPartClamped AND (rArgonFlowLpm &gt;= 18.5) THEN
  bLaserEmissionGate  := TRUE;
  rLaserPowerCmdWatts := 3650.0;
  iWeldStateCode      := 20;
ELSE
  bLaserEmissionGate  := FALSE;
  rLaserPowerCmdWatts := 0.0;
  iWeldStateCode      := 10;
END_IF;
            </xhtml>
          </ST>
        </body>
      </pou>
    </pous>
  </types>
  <instances>
    <configurations>
      <configuration name="SafetyPLC_Cfg">
        <resource name="Core0_SIL3">
          <task name="SafetyScan_1ms" interval="T#1ms" priority="1" />
        </resource>
      </configuration>
    </configurations>
  </instances>
</project>`;

    const project = parsePlcopen(xml, "BatteryModule_LaserWeld_SafetyController.plcopen");
    const res = buildPlcopenDiagram(project);

    assert.equal(res.pouName, "PRG_LaserBusbarWeldCell");
    assert.equal(res.metadata.inputCount, 6);
    assert.equal(res.metadata.outputCount, 4);
    assert.equal(res.metadata.networkCount, 2);
    assert.ok(res.diagram.nodes.length >= 12);
    assert.ok(res.diagram.edges.length >= 9);

    // Verify every edge has X6-compatible source/target IDs and attrs
    for (const edge of res.diagram.edges) {
      assert.ok(edge.source, `Edge ${edge.id} missing source`);
      assert.ok(edge.target, `Edge ${edge.id} missing target`);
      assert.ok(edge.attrs?.line?.stroke, `Edge ${edge.id} missing line stroke`);
    }

    const svg = renderPlcopenSvg(project);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("PRG_LaserBusbarWeldCell"));
    // Both bLightCurtainChA and bLightCurtainChB must be preserved without colliding truncation
    assert.ok(svg.includes("bLightCurtainChA"));
    assert.ok(svg.includes("bLightCurtainChB"));
    assert.ok(svg.includes("bEStopResetPulse"));
    assert.ok(svg.includes("bSafetyRelayEnable"));
    assert.ok(svg.includes("bLaserEmissionGate"));
    assert.ok(svg.includes("Task: SafetyScan_1ms (T#1ms, Prio 1)"));
    assert.ok(svg.includes("FBD LOGIC &amp; FUNCTION BLOCKS"));

    // Verify client-side parsePlcopenTextToProject produces identical POU & task structure
    const clientParsed = parsePlcopenTextToProject(xml, "BatteryModule_LaserWeld_SafetyController.plcopen");
    assert.equal(clientParsed.pous.length, 1);
    assert.equal(clientParsed.pous[0]?.variables.filter((v) => v.scope === "input").length, 6);
    assert.equal(clientParsed.pous[0]?.variables.filter((v) => v.scope === "output").length, 4);
    assert.equal(clientParsed.configurations?.[0]?.resources?.[0]?.tasks?.[0]?.interval, "T#1ms");
  });

  it("synthesizes TON timer function-block calls and task badges from Structured Text and XML configurations", () => {
    const st = `
      PROGRAM DrillStation
        VAR_INPUT
          PartPresent : BOOL;
          SafetyGuard : BOOL;
        END_VAR
        VAR_OUTPUT
          DrillMotor : BOOL;
          CycleDone  : BOOL;
        END_VAR
        VAR
          CycleTimer : TON;
        END_VAR

        DrillMotor := PartPresent AND SafetyGuard;
        CycleTimer(IN := DrillMotor, PT := T#5s, Q => CycleDone);
      END_PROGRAM
    `;

    const project = parsePlcopen(st, "DrillStation.st");
    const fbdBlocks = synthesizeFbdBlocksFromPou(project.pous[0]!);
    assert.equal(fbdBlocks.length, 2);
    assert.equal(fbdBlocks[0]?.blockType, "logic");
    assert.equal(fbdBlocks[1]?.blockType, "functionBlock");
    assert.ok(fbdBlocks[1]?.stereotype.includes("TON"));

    const svg = renderPlcopenSvg(project);
    assert.ok(svg.includes("CycleTimer : TON"));
    assert.ok(svg.includes("DrillMotor"));
    assert.ok(svg.includes("CycleDone"));
  });

  it("populates left and right rails for compact ST snippets that only declare local VAR blocks", () => {
    const st = `
      PROGRAM PumpControl
      VAR
        TankLevel : REAL := 45.0;
        SetPoint : REAL := 60.0;
        PumpActive : BOOL := FALSE;
      END_VAR

      IF TankLevel < SetPoint - 5.0 THEN
        PumpActive := TRUE;
      ELSIF TankLevel > SetPoint + 5.0 THEN
        PumpActive := FALSE;
      END_IF;
      END_PROGRAM
    `;

    const project = parsePlcopenTextToProject(st, "PumpControl.st");
    const res = buildPlcopenDiagram(project);
    assert.equal(res.metadata.inputCount, 2);
    assert.equal(res.metadata.outputCount, 1);
    assert.equal(res.metadata.networkCount, 1);
    assert.ok(res.diagram.edges.length >= 3);
  });
});
