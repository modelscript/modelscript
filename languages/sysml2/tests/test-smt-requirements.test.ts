// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import type { ExtractedConstraint } from "../src/constraint-extractor.js";
import { SmtOctagonDBM, verifyConstraintSet } from "../src/smt-bridge.js";

test("SysML v2 SMT & Octagon Requirement Verification", async (t) => {
  await t.test("SmtOctagonDBM maintains interval bounds and detects direct contradictions", () => {
    const dbm = new SmtOctagonDBM(2);

    // Variable 0 in [2, 10]
    dbm.assumeInterval(0, 2, 10);
    assert.strictEqual(dbm.hasNegativeCycle(), false);
    assert.strictEqual(dbm.getLowerBound(0), 2);
    assert.strictEqual(dbm.getUpperBound(0), 10);

    // Tighten upper bound to 8
    dbm.assumeInterval(0, 2, 8);
    assert.strictEqual(dbm.hasNegativeCycle(), false);
    assert.strictEqual(dbm.getUpperBound(0), 8);

    // Assert contradiction: lower bound 15 > upper bound 8
    dbm.assumeInterval(0, 15, dbm.getUpperBound(0));
    assert.strictEqual(dbm.hasNegativeCycle(), true);
  });

  await t.test("SmtOctagonDBM propagates difference logic and detects cycle contradictions", () => {
    // x (var 0), y (var 1), z (var 2)
    const dbm = new SmtOctagonDBM(3);

    // x - y <= 5
    dbm.assumeDiff(0, 1, 5);
    // y - z <= 3
    dbm.assumeDiff(1, 2, 3);

    assert.strictEqual(dbm.hasNegativeCycle(), false);
    // Floyd-Warshall closure: x - z <= 8
    assert.strictEqual(dbm.checkDiff(0, 2, 8), true);
    assert.strictEqual(dbm.checkDiff(0, 2, 7), false);

    // Add contradictory constraint: x - z >= 10  ==>  z - x <= -10
    dbm.assumeDiff(2, 0, -10);
    assert.strictEqual(dbm.hasNegativeCycle(), true);
  });

  await t.test("verifyConstraintSet validates consistent multi-requirement sets", () => {
    const constraints: ExtractedConstraint[] = [
      {
        requirementName: "MaxSpeedReq",
        expression: "sled.v <= 10.0",
        lhs: "sled.v",
        operator: "<=",
        rhs: 10.0,
      },
      {
        requirementName: "MinSpeedReq",
        expression: "sled.v >= 2.0",
        lhs: "sled.v",
        operator: ">=",
        rhs: 2.0,
      },
      {
        requirementName: "PayloadMassReq",
        expression: "payload.mass <= 50.0",
        lhs: "payload.mass",
        operator: "<=",
        rhs: 50.0,
      },
    ];

    const result = verifyConstraintSet(constraints);
    assert.strictEqual(result.isConsistent, true);
    assert.strictEqual(result.conflictingRequirements.length, 0);
    assert.strictEqual(result.violatedConstraints.length, 0);
  });

  await t.test("verifyConstraintSet detects contradictory bounds and isolates conflicting requirements", () => {
    const constraints: ExtractedConstraint[] = [
      {
        requirementName: "NominalVelocityLimit",
        expression: "sled.v <= 10.0",
        lhs: "sled.v",
        operator: "<=",
        rhs: 10.0,
      },
      {
        requirementName: "EmergencyCruiseDemand",
        expression: "sled.v >= 15.0",
        lhs: "sled.v",
        operator: ">=",
        rhs: 15.0,
      },
    ];

    const result = verifyConstraintSet(constraints);
    assert.strictEqual(result.isConsistent, false);
    assert.ok(result.conflictingRequirements.includes("NominalVelocityLimit"));
    assert.ok(result.conflictingRequirements.includes("EmergencyCruiseDemand"));
    assert.strictEqual(result.violatedConstraints.length, 1);
    assert.ok(result.violatedConstraints[0].reason.includes("Contradiction with prior bound"));
  });

  await t.test("verifyConstraintSet checks difference logic budget allocations", () => {
    const constraints: ExtractedConstraint[] = [
      {
        requirementName: "Subsystem1Timing",
        expression: "t_sub1 - t_start <= 4",
        lhs: "t_sub1 - t_start",
        operator: "<=",
        rhs: 4,
      },
      {
        requirementName: "Subsystem2Timing",
        expression: "t_sub2 - t_sub1 <= 5",
        lhs: "t_sub2 - t_sub1",
        operator: "<=",
        rhs: 5,
      },
      {
        requirementName: "GlobalDelayConstraint",
        expression: "t_sub2 - t_start >= 12",
        lhs: "t_sub2 - t_start",
        operator: ">=",
        rhs: 12,
      },
    ];

    const result = verifyConstraintSet(constraints);
    assert.strictEqual(result.isConsistent, false);
    assert.ok(result.conflictingRequirements.includes("GlobalDelayConstraint"));
    assert.strictEqual(result.violatedConstraints.length, 1);
  });

  await t.test("verifyConstraintSet handles empty or non-numeric constraints gracefully", () => {
    const emptyResult = verifyConstraintSet([]);
    assert.strictEqual(emptyResult.isConsistent, true);

    const nonNumericResult = verifyConstraintSet([
      {
        requirementName: "ModeReq",
        expression: "mode == ACTIVE",
        lhs: "mode",
        operator: "==",
        rhs: "ACTIVE" as any,
      },
    ]);
    assert.strictEqual(nonNumericResult.isConsistent, true);
  });
});
