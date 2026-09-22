// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkGuardsMutuallyExclusive,
  checkSingleVarExhaustive,
  parseGuardConstraints,
  verifyStateTransitions,
} from "../src/state-machine-verifier.js";

describe("SysML v2 State-Machine Determinism & Completeness Verifier", () => {
  it("should parse guard comparison constraints", () => {
    const c1 = parseGuardConstraints("fuelLevel > 0");
    assert.strictEqual(c1.length, 1);
    assert.strictEqual(c1[0]?.variable, "fuelLevel");
    assert.strictEqual(c1[0]?.operator, ">");
    assert.strictEqual(c1[0]?.value, 0);

    const c2 = parseGuardConstraints("[x >= 10 && x <= 50]");
    assert.strictEqual(c2.length, 2);
    assert.strictEqual(c2[0]?.variable, "x");
    assert.strictEqual(c2[0]?.operator, ">=");
    assert.strictEqual(c2[0]?.value, 10);
    assert.strictEqual(c2[1]?.variable, "x");
    assert.strictEqual(c2[1]?.operator, "<=");
    assert.strictEqual(c2[1]?.value, 50);

    const c3 = parseGuardConstraints("100 >= speed");
    assert.strictEqual(c3.length, 1);
    assert.strictEqual(c3[0]?.variable, "speed");
    assert.strictEqual(c3[0]?.operator, "<=");
    assert.strictEqual(c3[0]?.value, 100);
  });

  it("should verify mutually exclusive guards as deterministic", () => {
    const res1 = checkGuardsMutuallyExclusive("x < 10", "x >= 10");
    assert.strictEqual(res1.mutuallyExclusive, true, "x < 10 and x >= 10 must be mutually exclusive");

    const res2 = checkGuardsMutuallyExclusive("x <= 5", "x >= 8");
    assert.strictEqual(res2.mutuallyExclusive, true, "x <= 5 and x >= 8 must be mutually exclusive");

    const res3 = checkGuardsMutuallyExclusive("x >= 0 && x <= 20", "x > 30");
    assert.strictEqual(res3.mutuallyExclusive, true, "Intervals [0, 20] and (30, inf) must be mutually exclusive");
  });

  it("should detect overlapping guards as non-deterministic", () => {
    const res = checkGuardsMutuallyExclusive("x >= 10", "x <= 20");
    assert.strictEqual(res.mutuallyExclusive, false, "x >= 10 and x <= 20 overlap in [10, 20]");
    assert(res.overlap?.includes("x ∈ [10, 20]"), `Overlap expected in [10, 20], got: ${res.overlap}`);

    const res2 = checkGuardsMutuallyExclusive("speed >= 50 && speed <= 100", "speed >= 80 && speed <= 120");
    assert.strictEqual(res2.mutuallyExclusive, false);
    assert(res2.overlap?.includes("speed ∈ [80, 100]"), `Overlap expected in [80, 100], got: ${res2.overlap}`);
  });

  it("should detect gaps in transition guards causing deadlocks", () => {
    const cList1 = [parseGuardConstraints("x < 5"), parseGuardConstraints("x > 10")];
    const exhaust1 = checkSingleVarExhaustive("x", cList1);
    assert.strictEqual(exhaust1.exhaustive, false);
    assert(exhaust1.unhandledRange?.includes("(5, 10)"));

    const cList2 = [parseGuardConstraints("x <= 100")];
    const exhaust2 = checkSingleVarExhaustive("x", cList2);
    assert.strictEqual(exhaust2.exhaustive, false);
    assert(exhaust2.unhandledRange?.includes("(100, ∞)"));

    const cList3 = [parseGuardConstraints("x <= 10"), parseGuardConstraints("x >= 10")];
    const exhaust3 = checkSingleVarExhaustive("x", cList3);
    assert.strictEqual(exhaust3.exhaustive, true, "x <= 10 and x >= 10 cover (-inf, inf)");
  });

  it("should verify state transitions end-to-end and report diagnostics", () => {
    // State with overlapping transitions
    const nonDetResult = verifyStateTransitions("Active", [
      { id: 1, name: "t1", source: "Active", target: "StateA", guardText: "temp >= 50" },
      { id: 2, name: "t2", source: "Active", target: "StateB", guardText: "temp <= 70" },
    ]);
    assert.strictEqual(nonDetResult.isDeterministic, false);
    assert.strictEqual(nonDetResult.diagnostics.length, 1);
    assert.strictEqual(nonDetResult.diagnostics[0]?.type, "nondeterminism");

    // State with deterministic but incomplete transitions
    const incompleteResult = verifyStateTransitions("Idle", [
      { id: 3, name: "t3", source: "Idle", target: "Run", guardText: "rpm > 1000" },
      { id: 4, name: "t4", source: "Idle", target: "Stop", guardText: "rpm < 500" },
    ]);
    assert.strictEqual(incompleteResult.isDeterministic, true);
    assert.strictEqual(incompleteResult.isComplete, false);
    assert.strictEqual(incompleteResult.diagnostics.length, 1);
    assert.strictEqual(incompleteResult.diagnostics[0]?.type, "deadlock");

    // State with fallback default transition is complete
    const fallbackResult = verifyStateTransitions("Idle", [
      { id: 5, name: "t5", source: "Idle", target: "Run", guardText: "rpm > 1000" },
      { id: 6, name: "t6", source: "Idle", target: "Stop" }, // unguarded fallback
    ]);
    assert.strictEqual(fallbackResult.isDeterministic, true);
    assert.strictEqual(fallbackResult.isComplete, true);
    assert.strictEqual(fallbackResult.diagnostics.length, 0);
  });
});
