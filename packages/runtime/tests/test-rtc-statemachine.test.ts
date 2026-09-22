// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import { StateKind, WasmRtcStateMachine } from "../src/index.js";

test("WasmRtcStateMachine - Run-to-Completion (RTC) Stepper", async (t) => {
  await t.test("executes state entry, do, and exit lifecycle actions", () => {
    const sm = new WasmRtcStateMachine();
    const actionLog: string[] = [];

    const sInit = sm.addState("initial", StateKind.Initial);
    const sOff = sm.addState("Off", StateKind.Simple, {
      entryAction: () => actionLog.push("enter:Off"),
      exitAction: () => actionLog.push("exit:Off"),
    });
    const sOn = sm.addState("On", StateKind.Simple, {
      entryAction: () => actionLog.push("enter:On"),
      doAction: (ctx) => {
        actionLog.push("do:On");
        ctx.power = 100;
      },
      exitAction: () => actionLog.push("exit:On"),
    });

    sm.addTransition(sInit, sOff);
    sm.addTransition(sOff, sOn, { trigger: "powerButton" });

    sm.init();
    assert.deepStrictEqual(sm.getActiveStateNames(), ["Off"]);
    assert.deepStrictEqual(actionLog, ["enter:Off"]);

    // Post event and step
    sm.postEvent("powerButton");
    const res = sm.step();

    assert.ok(res.firedTransitionId);
    assert.deepStrictEqual(sm.getActiveStateNames(), ["On"]);
    assert.deepStrictEqual(actionLog, ["enter:Off", "exit:Off", "enter:On", "do:On"]);
    assert.strictEqual(sm.getContext().power, 100);
  });

  await t.test("evaluates transition guards and executes effects", () => {
    const sm = new WasmRtcStateMachine();

    const sInit = sm.addState("initial", StateKind.Initial);
    const sStandby = sm.addState("Standby");
    const sArmed = sm.addState("Armed");
    const sLowBattery = sm.addState("LowBattery");

    sm.addTransition(sInit, sStandby);

    // Guarded transitions
    sm.addTransition(sStandby, sArmed, {
      trigger: "arm",
      guard: (ctx) => ctx.batteryPercent >= 20,
      effect: (ctx) => {
        ctx.armedAt = Date.now();
      },
    });
    sm.addTransition(sStandby, sLowBattery, {
      trigger: "arm",
      guard: (ctx) => ctx.batteryPercent < 20,
    });

    // Test low battery path
    sm.init({ batteryPercent: 10 });
    sm.postEvent("arm");
    sm.step();
    assert.deepStrictEqual(sm.getActiveStateNames(), ["LowBattery"]);

    // Test armed path
    sm.init({ batteryPercent: 85 });
    sm.postEvent("arm");
    sm.step();
    assert.deepStrictEqual(sm.getActiveStateNames(), ["Armed"]);
    assert.ok(sm.getContext().armedAt);
  });

  await t.test("navigates hierarchical composite states and LCA transitions", () => {
    const sm = new WasmRtcStateMachine();
    const trace: string[] = [];

    const sInit = sm.addState("initial", StateKind.Initial);
    const sInactive = sm.addState("Inactive", StateKind.Simple, {
      entryAction: () => trace.push("enter:Inactive"),
      exitAction: () => trace.push("exit:Inactive"),
    });

    // Composite state "Active"
    const sActive = sm.addState("Active", StateKind.Composite, {
      entryAction: () => trace.push("enter:Active"),
      exitAction: () => trace.push("exit:Active"),
    });

    const sActiveInit = sm.addState("activeInit", StateKind.Initial, {
      parentId: sActive,
    });
    const sRunning = sm.addState("Running", StateKind.Simple, {
      parentId: sActive,
      entryAction: () => trace.push("enter:Running"),
      exitAction: () => trace.push("exit:Running"),
    });
    const sPaused = sm.addState("Paused", StateKind.Simple, {
      parentId: sActive,
      entryAction: () => trace.push("enter:Paused"),
      exitAction: () => trace.push("exit:Paused"),
    });

    // Transitions
    sm.addTransition(sInit, sInactive);
    sm.addTransition(sInactive, sActive, { trigger: "activate" });
    sm.addTransition(sActiveInit, sRunning);
    sm.addTransition(sRunning, sPaused, { trigger: "pause" });
    sm.addTransition(sPaused, sInactive, { trigger: "stop" });

    sm.init();
    assert.deepStrictEqual(sm.getActiveStateNames(), ["Inactive"]);

    // Event "activate": should enter Active, then auto-enter child initial -> Running
    trace.length = 0;
    sm.postEvent("activate");
    sm.step();

    assert.ok(sm.getActiveStateNames().includes("Active"));
    assert.ok(sm.getActiveStateNames().includes("Running"));
    assert.deepStrictEqual(trace, ["exit:Inactive", "enter:Active", "enter:Running"]);

    // Internal transition inside Active: Running -> Paused
    trace.length = 0;
    sm.postEvent("pause");
    sm.step();

    assert.ok(sm.getActiveStateNames().includes("Active"));
    assert.ok(sm.getActiveStateNames().includes("Paused"));
    // Active itself was not exited because LCA is Active
    assert.deepStrictEqual(trace, ["exit:Running", "enter:Paused"]);

    // Outward transition: Paused -> Inactive (LCA is Root)
    trace.length = 0;
    sm.postEvent("stop");
    sm.step();

    assert.deepStrictEqual(sm.getActiveStateNames(), ["Inactive"]);
    // Both Paused and Active should be exited
    assert.deepStrictEqual(trace, ["exit:Paused", "exit:Active", "enter:Inactive"]);
  });

  await t.test("supports time-travel reversible debugging via stepBack()", () => {
    const sm = new WasmRtcStateMachine();

    const sInit = sm.addState("init", StateKind.Initial);
    const sA = sm.addState("StateA");
    const sB = sm.addState("StateB");
    const sC = sm.addState("StateC");

    sm.addTransition(sInit, sA);
    sm.addTransition(sA, sB, {
      trigger: "toB",
      effect: (ctx) => {
        ctx.stepCount = 1;
      },
    });
    sm.addTransition(sB, sC, {
      trigger: "toC",
      effect: (ctx) => {
        ctx.stepCount = 2;
      },
    });

    sm.init({ stepCount: 0 });
    assert.deepStrictEqual(sm.getActiveStateNames(), ["StateA"]);

    sm.postEvent("toB");
    sm.step();
    assert.deepStrictEqual(sm.getActiveStateNames(), ["StateB"]);
    assert.strictEqual(sm.getContext().stepCount, 1);

    sm.postEvent("toC");
    sm.step();
    assert.deepStrictEqual(sm.getActiveStateNames(), ["StateC"]);
    assert.strictEqual(sm.getContext().stepCount, 2);

    // Step back
    assert.strictEqual(sm.stepBack(), true);
    assert.deepStrictEqual(sm.getActiveStateNames(), ["StateB"]);
    assert.strictEqual(sm.getContext().stepCount, 1);

    // Step back again
    assert.strictEqual(sm.stepBack(), true);
    assert.deepStrictEqual(sm.getActiveStateNames(), ["StateA"]);
    assert.strictEqual(sm.getContext().stepCount, 0);

    // Step forward again
    sm.step();
    assert.deepStrictEqual(sm.getActiveStateNames(), ["StateB"]);
  });
});
