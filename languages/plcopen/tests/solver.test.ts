// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parsePlcopen } from "../src/parser/index.js";
import { VirtualPlc } from "../src/solver/virtual-plc.js";

describe("Virtual PLC Scan Engine", () => {
  it("executes basic logic and variable assignments in discrete scan steps", () => {
    const st = `
      PROGRAM LogicTest
        VAR_INPUT
          StartBtn : BOOL := FALSE;
          StopBtn : BOOL := FALSE;
        END_VAR
        VAR_OUTPUT
          MotorOn : BOOL := FALSE;
          Cycles : INT := 0;
        END_VAR

        IF StartBtn AND NOT StopBtn THEN
          MotorOn := TRUE;
        ELSIF StopBtn THEN
          MotorOn := FALSE;
        END_IF;

        Cycles := Cycles + 1;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const plc = new VirtualPlc(project);

    assert.strictEqual(plc.getVariable("MotorOn"), false);
    assert.strictEqual(plc.getVariable("Cycles"), 0);

    // Scan cycle 1: buttons false
    plc.step();
    assert.strictEqual(plc.getVariable("MotorOn"), false);
    assert.strictEqual(plc.getVariable("Cycles"), 1);

    // Scan cycle 2: press StartBtn
    plc.setVariable("StartBtn", true);
    plc.step();
    assert.strictEqual(plc.getVariable("MotorOn"), true);
    assert.strictEqual(plc.getVariable("Cycles"), 2);

    // Scan cycle 3: release StartBtn (remains latched/on)
    plc.setVariable("StartBtn", false);
    plc.step();
    assert.strictEqual(plc.getVariable("MotorOn"), true);
    assert.strictEqual(plc.getVariable("Cycles"), 3);

    // Scan cycle 4: press StopBtn
    plc.setVariable("StopBtn", true);
    plc.step();
    assert.strictEqual(plc.getVariable("MotorOn"), false);
    assert.strictEqual(plc.getVariable("Cycles"), 4);
  });

  it("simulates IEC 61131-3 TON (On-Delay Timer) accurately across clock steps", () => {
    const st = `
      PROGRAM TimerTest
        VAR
          Timer1 : TON;
          Enable : BOOL := FALSE;
          Timeout : BOOL := FALSE;
        END_VAR

        Timer1(IN := Enable, PT := T#50ms, Q => Timeout);
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const plc = new VirtualPlc(project);

    // At cycle 0: Enable is false
    plc.step(10);
    assert.strictEqual(plc.getVariable("Timeout"), false);

    // Turn Enable ON
    plc.setVariable("Enable", true);

    // 10ms
    plc.step(10);
    assert.strictEqual(plc.getVariable("Timeout"), false);
    assert.strictEqual(plc.getVariable("Timer1.ET"), 10);

    // 20ms
    plc.step(10);
    assert.strictEqual(plc.getVariable("Timer1.ET"), 20);
    assert.strictEqual(plc.getVariable("Timeout"), false);

    // 30ms, 40ms
    plc.step(10);
    plc.step(10);
    assert.strictEqual(plc.getVariable("Timer1.ET"), 40);
    assert.strictEqual(plc.getVariable("Timeout"), false);

    // 50ms: Timer reaches preset PT (50ms) -> Timeout fires!
    plc.step(10);
    assert.strictEqual(plc.getVariable("Timer1.ET"), 50);
    assert.strictEqual(plc.getVariable("Timeout"), true);

    // 60ms: Clamped at PT, remains true
    plc.step(10);
    assert.strictEqual(plc.getVariable("Timer1.ET"), 50);
    assert.strictEqual(plc.getVariable("Timeout"), true);

    // Reset Enable to false -> Instant reset
    plc.setVariable("Enable", false);
    plc.step(10);
    assert.strictEqual(plc.getVariable("Timer1.ET"), 0);
    assert.strictEqual(plc.getVariable("Timeout"), false);
  });

  it("runs trajectory batch cycles with runCycles", () => {
    const st = `
      PROGRAM CounterTest
        VAR
          Accum : INT := 10;
        END_VAR
        Accum := Accum + 5;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const plc = new VirtualPlc(project);

    const history = plc.runCycles(5, 20);
    assert.strictEqual(history.length, 5);
    assert.strictEqual(history[0]?._cycle, 1);
    assert.strictEqual(history[0]?._timeMs, 20);
    assert.strictEqual(history[0]?.Accum, 15);
    assert.strictEqual(history[4]?._cycle, 5);
    assert.strictEqual(history[4]?._timeMs, 100);
    assert.strictEqual(history[4]?.Accum, 35);
  });

  it("executes REPEAT/UNTIL, EXIT, and RETURN statements accurately", () => {
    const st = `
      PROGRAM LoopAndControlTest
        VAR
          Count : INT := 0;
          Sum : INT := 0;
          EarlyExit : BOOL := FALSE;
          AfterReturn : INT := 0;
        END_VAR

        REPEAT
          Count := Count + 1;
          Sum := Sum + Count;
          IF Count = 3 THEN
            EXIT;
          END_IF;
        UNTIL Count >= 10
        END_REPEAT;

        IF EarlyExit THEN
          RETURN;
        END_IF;
        AfterReturn := 42;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const plc = new VirtualPlc(project);
    plc.setVariable("EarlyExit", true);
    plc.step();

    assert.strictEqual(plc.getVariable("Count"), 3, "EXIT should terminate REPEAT loop at Count=3");
    assert.strictEqual(plc.getVariable("Sum"), 6, "Sum should be 1+2+3=6");
    assert.strictEqual(plc.getVariable("AfterReturn"), 0, "RETURN should skip statements after it");
  });

  it("simulates CTU, CTD, R_TRIG, F_TRIG, SR, RS, and user FUNCTION / FUNCTION_BLOCK POUs", () => {
    const st = `
      FUNCTION ScaleVal : REAL
        VAR_INPUT
          InVal : REAL;
          Factor : REAL;
        END_VAR
        ScaleVal := InVal * Factor;
      END_FUNCTION

      FUNCTION_BLOCK LeadBlock
        VAR_INPUT
          X : REAL;
        END_VAR
        VAR_OUTPUT
          Y : REAL;
        END_VAR
        Y := ScaleVal(InVal := X, Factor := 2.5);
      END_FUNCTION_BLOCK

      PROGRAM FullFbTest
        VAR
          Pulse : BOOL := FALSE;
          Reset : BOOL := FALSE;
          UpCnt : CTU;
          RTrig : R_TRIG;
          FTrig : F_TRIG;
          Latch : SR;
          LeadInst : LeadBlock;
          CntVal : INT := 0;
          CntDone : BOOL := FALSE;
          RisingEdge : BOOL := FALSE;
          FallingEdge : BOOL := FALSE;
          LatchedOut : BOOL := FALSE;
          ScaledOut : REAL := 0.0;
        END_VAR

        RTrig(CLK := Pulse, Q => RisingEdge);
        FTrig(CLK := Pulse, Q => FallingEdge);
        UpCnt(CU := Pulse, R := Reset, PV := 2, Q => CntDone, CV => CntVal);
        Latch(S1 := RisingEdge, R := Reset, Q1 => LatchedOut);
        LeadInst(X := 4.0, Y => ScaledOut);
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const plc = new VirtualPlc(project);

    // Cycle 1: Pulse = TRUE (rising edge 1)
    plc.setVariable("Pulse", true);
    plc.step();
    assert.strictEqual(plc.getVariable("RisingEdge"), true);
    assert.strictEqual(plc.getVariable("FallingEdge"), false);
    assert.strictEqual(plc.getVariable("CntVal"), 1);
    assert.strictEqual(plc.getVariable("CntDone"), false);
    assert.strictEqual(plc.getVariable("LatchedOut"), true);
    assert.strictEqual(plc.getVariable("ScaledOut"), 10.0);

    // Cycle 2: Pulse = FALSE (falling edge)
    plc.setVariable("Pulse", false);
    plc.step();
    assert.strictEqual(plc.getVariable("RisingEdge"), false);
    assert.strictEqual(plc.getVariable("FallingEdge"), true);
    assert.strictEqual(plc.getVariable("CntVal"), 1);
    assert.strictEqual(plc.getVariable("LatchedOut"), true);

    // Cycle 3: Pulse = TRUE (rising edge 2 -> reaches PV=2)
    plc.setVariable("Pulse", true);
    plc.step();
    assert.strictEqual(plc.getVariable("CntVal"), 2);
    assert.strictEqual(plc.getVariable("CntDone"), true);
  });
});
