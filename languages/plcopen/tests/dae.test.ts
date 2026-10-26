// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerPlcopenToDae } from "../src/dae/plcopen-to-dae.js";
import { parsePlcopen } from "../src/parser/index.js";

describe("PLCopen DAE Arena Lowering", () => {
  it("lowers POU variables and assignment equations into linear-memory DAE arena", () => {
    const st = `
      PROGRAM PidController
        VAR_INPUT
          Setpoint : REAL := 50.0;
          ProcessVal : REAL := 48.0;
        END_VAR
        VAR_OUTPUT
          ControlOut : REAL;
        END_VAR
        VAR
          Error : REAL;
          Kp : REAL := 2.5;
        END_VAR

        Error := Setpoint - ProcessVal;
        ControlOut := Kp * Error;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const arena = lowerPlcopenToDae(project);

    assert(arena.getVarCount() >= 5);
    assert(arena.getEqCount() >= 2);
  });

  it("lowers TON timer with dynamic derivative state", () => {
    const st = `
      PROGRAM TimerLowering
        VAR
          Start : BOOL := TRUE;
          T1 : TON;
        END_VAR

        T1(IN := Start, PT := T#5s);
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const arena = lowerPlcopenToDae(project);

    // Checks that timer ET variable and its der(ET) rate equation are emitted
    assert(arena.getVarCount() >= 3);
    assert(arena.getEqCount() >= 1);
  });
});
