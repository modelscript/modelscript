// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parsePlcopen } from "../src/parser/index.js";
import { plcopenToModelica, plcopenToSysML } from "../src/projections/index.js";

describe("PLCopen Projections", () => {
  it("projects PLC POU to Modelica 3.x block with standard connectors and algorithm section", () => {
    const st = `
      PROGRAM SafetyInterlock
        VAR_INPUT
          EStop : BOOL;
          DoorClosed : BOOL;
        END_VAR
        VAR_OUTPUT
          ReadyToOperate : BOOL;
        END_VAR

        ReadyToOperate := EStop AND DoorClosed;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const mo = plcopenToModelica(project);

    assert(mo.includes("block SafetyInterlock"));
    assert(mo.includes("Modelica.Blocks.Interfaces.BooleanInput EStop"));
    assert(mo.includes("Modelica.Blocks.Interfaces.BooleanInput DoorClosed"));
    assert(mo.includes("Modelica.Blocks.Interfaces.BooleanOutput ReadyToOperate"));
    assert(mo.includes("algorithm"));
    assert(mo.includes("ReadyToOperate :="));
    assert(mo.includes("end SafetyInterlock;"));
  });

  it("projects PLC POU to SysML v2 action definition", () => {
    const st = `
      PROGRAM Dispenser
        VAR_INPUT Trigger : BOOL; END_VAR
        VAR_OUTPUT ValveOpen : BOOL; END_VAR
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const sysml = plcopenToSysML(project);

    assert(sysml.includes("action def Dispenser"));
    assert(sysml.includes("in item Trigger;"));
    assert(sysml.includes("out item ValveOpen;"));
  });
});
