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
});
