// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DIMENSION_ACCELERATION,
  DIMENSION_POWER,
  DimensionalTheoryOracle,
  areDimensionsEqual,
} from "../src/formal/oracles/dimensional_oracle.js";

describe("DimensionalTheoryOracle — Reactive Order-Independent Evaluation", () => {
  it("should derive product dimension when dimensionMult is asserted before operands", () => {
    const oracle = new DimensionalTheoryOracle();

    // 1. Assert multiplication before operand dimensions are known: P = F * v
    oracle.assertLiteral({
      id: 1,
      predicate: "dimensionMult",
      args: ["P", "F", "v"],
      isNegated: false,
    });

    assert.strictEqual(oracle.getDimension("P"), undefined, "P should not have a dimension before operands are known");

    // 2. Assert operand dimensions later
    oracle.assertLiteral({
      id: 2,
      predicate: "dimension",
      args: ["F", "N"],
      isNegated: false,
    });
    assert.strictEqual(oracle.getDimension("P"), undefined, "P should not have a dimension when only F is known");

    oracle.assertLiteral({
      id: 3,
      predicate: "dimension",
      args: ["v", "m/s"],
      isNegated: false,
    });

    // 3. P must now be reactively derived as Power (W = J/s = N*m/s)
    const dimP = oracle.getDimension("P");
    assert.ok(dimP, "P should have derived dimension");
    assert.ok(
      areDimensionsEqual(dimP, DIMENSION_POWER),
      `Expected Power [2, 1, -3, 0, 0, 0, 0], got [${dimP.join(", ")}]`,
    );

    // 4. Verify SAT passes
    const satRes = oracle.checkSat();
    assert.strictEqual(satRes.isSat, true);

    // 5. Assert conflicting dimension on P and verify UNSAT is caught
    oracle.assertLiteral({
      id: 4,
      predicate: "dimension",
      args: ["P_target", "kg"],
      isNegated: false,
    });
    oracle.assertLiteral({
      id: 5,
      predicate: "equal",
      args: ["P", "P_target"],
      isNegated: false,
    });

    const conflictRes = oracle.checkSat();
    assert.strictEqual(conflictRes.isSat, false);
    assert.ok(conflictRes.conflict?.explanation.includes("Dimensional Inconsistency"));
  });

  it("should derive quotient dimension when dimensionDiv is asserted out-of-order", () => {
    const oracle = new DimensionalTheoryOracle();

    // a = F / m
    oracle.assertLiteral({
      id: 10,
      predicate: "dimensionDiv",
      args: ["a", "F", "m"],
      isNegated: false,
    });

    assert.strictEqual(oracle.getDimension("a"), undefined);

    oracle.assertLiteral({
      id: 11,
      predicate: "dimension",
      args: ["m", "kg"],
      isNegated: false,
    });

    oracle.assertLiteral({
      id: 12,
      predicate: "dimension",
      args: ["F", "N"],
      isNegated: false,
    });

    const dimA = oracle.getDimension("a");
    assert.ok(dimA, "a should have derived dimension");
    assert.ok(
      areDimensionsEqual(dimA, DIMENSION_ACCELERATION),
      `Expected Acceleration [1, 0, -2, 0, 0, 0, 0], got [${dimA.join(", ")}]`,
    );
  });
});
