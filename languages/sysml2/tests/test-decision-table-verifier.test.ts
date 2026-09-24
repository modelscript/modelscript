// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionTableVerifier, type DecisionBranch } from "../src/decision-table-verifier.js";

describe("SysML v2 Decision Table Exhaustiveness & Disjointness Prover (Imandra Equivalent)", () => {
  it("proves an exhaustive and strictly deterministic decision partition", () => {
    const branches: DecisionBranch[] = [
      { id: "b_low", guardText: "x < 0" },
      { id: "b_mid", guardText: "x >= 0 && x <= 100" },
      { id: "b_high", guardText: "x > 100" },
    ];

    const result = DecisionTableVerifier.verifyDecisionTable(branches, {
      domainBounds: new Map([["x", [-500, 500]]]),
    });

    assert.strictEqual(result.isExhaustive, true, "Should be exhaustive");
    assert.strictEqual(result.isDeterministic, true, "Should be deterministic");
    assert.strictEqual(result.hasDeadBranches, false, "Should have no dead branches");
    assert.strictEqual(result.overlappingBranches.length, 0);
    assert.strictEqual(result.deadBranches.length, 0);
  });

  it("detects an unhandled input gap in an unexhaustive decision table", () => {
    // Gap between 50 and 60
    const branches: DecisionBranch[] = [
      { id: "b_low", guardText: "speed < 50" },
      { id: "b_high", guardText: "speed > 60" },
    ];

    const result = DecisionTableVerifier.verifyDecisionTable(branches, {
      domainBounds: new Map([["speed", [0, 100]]]),
    });

    assert.strictEqual(result.isExhaustive, false, "Should detect unhandled gap");
    assert.ok(result.unhandledScenarioBox, "Should extract counterexample unhandled box");
    const gap = result.unhandledScenarioBox["speed"];
    assert.ok(gap, "Should identify 'speed' as the unhandled variable");
    assert.ok(gap[0] >= 49.9 && gap[1] <= 60.1, `Gap bounds [${gap[0]}, ${gap[1]}] should fall in (50, 60)`);
  });

  it("detects non-deterministic overlapping guard collisions", () => {
    // Overlap between 50 and 80
    const branches: DecisionBranch[] = [
      { id: "b_eco", guardText: "power >= 20 && power <= 80" },
      { id: "b_sport", guardText: "power >= 50 && power <= 120" },
      { id: "b_off", guardText: "power < 20" },
      { id: "b_max", guardText: "power > 120" },
    ];

    const result = DecisionTableVerifier.verifyDecisionTable(branches, {
      domainBounds: new Map([["power", [0, 200]]]),
    });

    assert.strictEqual(result.isDeterministic, false, "Should detect non-deterministic overlap");
    assert.strictEqual(result.overlappingBranches.length, 1);
    const overlap = result.overlappingBranches[0]!;
    assert.strictEqual(overlap.branchA, "b_eco");
    assert.strictEqual(overlap.branchB, "b_sport");
    const w = overlap.witnessBox["power"]!;
    assert.ok(w[0] >= 49.9 && w[1] <= 80.1, "Collision witness should fall within [50, 80]");
  });

  it("detects mathematically unreachable dead branches", () => {
    const branches: DecisionBranch[] = [
      { id: "b_valid", guardText: "temp >= 0 && temp <= 100" },
      { id: "b_dead", guardText: "temp >= 200 && temp <= 50" }, // Contradiction: UNSAT
      { id: "b_else", guardText: "else" },
    ];

    const result = DecisionTableVerifier.verifyDecisionTable(branches);

    assert.strictEqual(result.hasDeadBranches, true, "Should flag dead branch");
    assert.strictEqual(result.deadBranches.length, 1);
    assert.strictEqual(result.deadBranches[0], "b_dead");
    assert.strictEqual(result.isExhaustive, true, "Catch-all else guarantees exhaustiveness");
  });

  it("verifies decide nodes extracted directly from SysML v2 activity source", () => {
    const sysmlActivity = `
      action def SpeedController {
        in speed : Real;
        decide d1;
        action lowSpeed;
        action midSpeed;
        action highSpeed;

        first d1 then lowSpeed if speed < 30;
        first d1 then midSpeed if speed >= 30 and speed <= 70;
        first d1 then highSpeed if speed > 70;
      }
    `;

    const decisionResults = DecisionTableVerifier.verifyAllDecisionsFromText(sysmlActivity, {
      domainBounds: new Map([["speed", [0, 150]]]),
    });

    assert.ok(decisionResults.has("d1"), "Should extract decide node 'd1'");
    const d1Result = decisionResults.get("d1")!;
    assert.strictEqual(d1Result.isExhaustive, true);
    assert.strictEqual(d1Result.isDeterministic, true);
    assert.strictEqual(d1Result.hasDeadBranches, false);
  });
});
