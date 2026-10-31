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
    assert.strictEqual(arena.getVarCount(), arena.getEqCount(), "Lowered timer DAE must be structurally square");
  });

  it("merges IF/ELSIF/ELSE and CASE branches into single addIfElse equations per variable (N_vars === N_eqs)", () => {
    const st = `
      PROGRAM ConditionalControl
        VAR_INPUT
          Mode : INT := 1;
          Err : REAL := 2.0;
        END_VAR
        VAR_OUTPUT
          OutVal : REAL := 0.0;
          Gain : REAL := 1.0;
        END_VAR

        IF Err > 5.0 THEN
          OutVal := 10.0;
        ELSIF Err > 0.0 THEN
          OutVal := Err * 2.0;
        ELSE
          OutVal := 0.0;
        END_IF;

        CASE Mode OF
          1: Gain := 1.5;
          2: Gain := 3.0;
        ELSE
          Gain := 1.0;
        END_CASE;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const arena = lowerPlcopenToDae(project);

    assert.strictEqual(arena.getVarCount(), 4);
    assert.strictEqual(
      arena.getVarCount(),
      arena.getEqCount(),
      `Expected square DAE (N_vars=${arena.getVarCount()} === N_eqs=${arena.getEqCount()})`,
    );
  });
});
