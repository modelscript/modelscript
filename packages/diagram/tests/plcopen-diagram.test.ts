// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePlcopen } from "../../../languages/plcopen/src/index.js";
import { buildPlcopenDiagram, renderPlcopenSvg, synthesizeFbdBlocksFromPou } from "../src/plcopen-diagram-builder.js";

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
bSafetyRelayEnable := bLightCurtainChA AND bLightCurtainChB AND (rCellTempDegC &lt; 55.0);
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
</project>`;

    const project = parsePlcopen(xml, "BatteryModule_LaserWeld_SafetyController.plcopen");
    const res = buildPlcopenDiagram(project);

    assert.equal(res.pouName, "PRG_LaserBusbarWeldCell");
    assert.equal(res.metadata.inputCount, 5);
    assert.equal(res.metadata.outputCount, 4);
    assert.equal(res.metadata.networkCount, 2);
    assert.ok(res.diagram.nodes.length >= 11);
    assert.ok(res.diagram.edges.length >= 8);

    const svg = renderPlcopenSvg(project);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("PRG_LaserBusbarWeldCell"));
    assert.ok(svg.includes("bLightCurtainChA"));
    assert.ok(svg.includes("bSafetyRelayEnable"));
    assert.ok(svg.includes("bLaserEmissionGate"));
    assert.ok(svg.includes("FBD LOGIC &amp; FUNCTION BLOCKS"));
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
});
