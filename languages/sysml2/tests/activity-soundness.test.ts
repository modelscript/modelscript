// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkActivitySoundness } from "../src/activity-soundness.js";

describe("SysML v2 Static Activity Soundness & Deadlock Analyzer", () => {
  it("should verify a well-structured activity with fork and join", () => {
    const sysml = `
      action StartProcess {
        out token: Boolean;
        assign token := true;
      }
      action TaskA;
      action TaskB;
      action EndProcess;
      fork f1;
      join j1;

      first StartProcess then f1;
      first f1 then TaskA;
      first f1 then TaskB;
      first TaskA then j1;
      first TaskB then j1;
      first j1 then EndProcess;
    `;

    const res = checkActivitySoundness(sysml);
    assert.strictEqual(res.isSound, true);
    assert.strictEqual(res.deadlockNodes.length, 0);
    assert.strictEqual(res.unreachableActions.length, 0);
  });

  it("should detect join-decide deadlock when join synchronizes mutually exclusive decision branches", () => {
    const sysml = `
      action CheckCondition;
      decide d1;
      action PathA;
      action PathB;
      join jDeadlock;
      action Next;

      first CheckCondition then d1;
      first d1 then PathA;
      first d1 then PathB;
      first PathA then jDeadlock;
      first PathB then jDeadlock;
      first jDeadlock then Next;
    `;

    const res = checkActivitySoundness(sysml);
    assert.strictEqual(res.isSound, false);
    assert.ok(res.deadlockNodes.includes("jDeadlock"), "jDeadlock must be detected as deadlock");
    assert.ok(res.diagnostics.some((d) => d.rule === "join-decide-deadlock"));
  });

  it("should detect unreachable actions disconnected from start", () => {
    const sysml = `
      action Start;
      action Step1;
      action DisconnectedAction;

      first Start then Step1;
    `;

    const res = checkActivitySoundness(sysml);
    assert.ok(res.unreachableActions.includes("DisconnectedAction"));
    assert.ok(res.diagnostics.some((d) => d.rule === "unreachable-action"));
  });

  it("should detect unassigned declared output variables", () => {
    const sysml = `
      action CalculateResult {
        in x : Real;
        out result : Real;
        out unassignedOut : Real;
        assign result := x * 2.0;
      }
    `;

    const res = checkActivitySoundness(sysml);
    assert.strictEqual(res.isSound, false);
    assert.ok(res.unassignedOutputs.includes("unassignedOut"));
    assert.ok(res.diagnostics.some((d) => d.rule === "definite-output-assignment"));
  });
});
