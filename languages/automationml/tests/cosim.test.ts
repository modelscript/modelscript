// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { runAmlVirtualCommissioning } from "../src/cosim/index.js";
import { lowerAutomationMLToDae } from "../src/dae/index.js";
import { parseAutomationML } from "../src/parser/index.js";

describe("AutomationML DAE Lowering & Virtual Commissioning Co-Simulation", () => {
  const cellAml = `
    aml "ConveyorStation.aml" version "2.15"
    instanceHierarchy "SortingCell" {
      element PlcController [id="plc-1", ppr=Resource] {
        interface partAtEnd: In BOOL
        interface motorRun: Out BOOL
        interface logicRef: InOut PLCopenXML uri="file://plc/conveyor_ctrl.st"
      }
      element BeltConveyor [id="conv-1", ppr=Resource] {
        frame (x=0.0, y=0.0, z=0.0, rx=0, ry=0, rz=0)
        attribute maxSpeed: REAL = 2.0 [m/s]
        attribute timeConstant: REAL = 0.02 [s]
        attribute threshold: REAL = 0.05 [m]
        interface runCmd: In BOOL
        interface speedOut: Out REAL
        interface endSensor: Out BOOL
      }
      link "CmdLink" plc-1:motorRun -> conv-1:runCmd
      link "SensorLink" conv-1:endSensor -> plc-1:partAtEnd
    }
  `;

  const plcSt = `
    PROGRAM ConveyorCtrl
      VAR_INPUT
        partAtEnd : BOOL := FALSE;
      END_VAR
      VAR_OUTPUT
        motorRun : BOOL := FALSE;
      END_VAR
      motorRun := NOT partAtEnd;
    END_PROGRAM
  `;

  it("lowers AutomationML plant elements, attributes, frames, and InternalLinks to DAEBuilder arena", () => {
    const doc = parseAutomationML(cellAml);
    const arena = lowerAutomationMLToDae(doc);
    assert(arena.getVarCount() >= 8);
    assert(arena.getEqCount() >= 6);
  });

  it("runs closed-loop Virtual Commissioning coupling VirtualPlc scan cycles with continuous plant kinematics", () => {
    const doc = parseAutomationML(cellAml);
    const result = runAmlVirtualCommissioning(doc, {
      cycles: 10,
      dtMs: 20,
      plcSources: {
        "file://plc/conveyor_ctrl.st": plcSt,
      },
    });

    assert.strictEqual(result.cycles, 10);
    assert.strictEqual(result.dtMs, 20);
    assert.strictEqual(result.totalTimeMs, 200);
    assert.strictEqual(result.interlockHealthy, true);
    assert.strictEqual(result.interlockStatus, "OK");
    assert.strictEqual(result.telemetry.length, 10);

    // Cycle 1: partAtEnd is FALSE -> PLC sets motorRun = TRUE -> Conveyor accelerates and frame.x advances
    const firstCycle = result.telemetry[0]!;
    assert.strictEqual(firstCycle.signals["plc-1:motorRun"], true);
    assert.strictEqual(firstCycle.signals["conv-1:runCmd"], true);

    // By cycle 10, conveyor frame.x has advanced past threshold (0.05m), triggering endSensor -> stopping motorRun
    const finalConvFrame = result.finalFrames["conv-1"]!;
    assert(finalConvFrame.x >= 0.05);
    assert.strictEqual(result.finalSignals["conv-1:endSensor"], true);
    assert.strictEqual(result.finalSignals["plc-1:partAtEnd"], true);
  });

  it("trips safety interlock and halts actuator motion when eStop input is active", () => {
    const estopAml = `
      aml "SafetyCell.aml"
      instanceHierarchy "PressStation" {
        element SafetyPress [id="press-1", ppr=Resource] {
          frame (x=0.0, y=0.0, z=0.0, rx=0, ry=0, rz=0)
          attribute maxSpeed: REAL = 5.0
          interface eStop: In BOOL
          interface strokeCmd: In BOOL
          interface speedOut: Out REAL
        }
      }
    `;
    const doc = parseAutomationML(estopAml);
    const result = runAmlVirtualCommissioning(doc, {
      cycles: 5,
      dtMs: 10,
      initialSignals: {
        "press-1:eStop": true,
        "press-1:strokeCmd": true,
      },
    });

    assert.strictEqual(result.interlockHealthy, false);
    assert.strictEqual(result.interlockStatus, "TRIPPED");
    assert.strictEqual(result.finalFrames["press-1"]?.x, 0);
    assert.strictEqual(result.finalSignals["press-1:speedOut"], 0);
  });
});
