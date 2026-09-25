// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConstraintTheoryOracle, SemanticTheoryCoordinator } from "../src/index.js";

describe("Semantic Theory Coordinator — CEGAR Hyperplane & Non-Linear Integration", () => {
  it("should contract parameter box using linear hyperplanes via HC4 contractor", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Initial bounding box: x in [0, 10], y in [0, 10]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["x", 0, 10],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "interval",
      args: ["y", 0, 10],
      domain: "constraint",
    });

    assert.equal(coordinator.checkSat().isSat, true);

    // Assert supporting hyperplane: 2*x + 3*y <= 12
    coordinator.assertLiteral({
      predicate: "hyperplane",
      args: [{ x: 2, y: 3 }, "<=", 12],
      domain: "constraint",
    });

    const contractedRes = coordinator.checkSat();
    assert.equal(contractedRes.isSat, true);

    // When y = 0, max x is 12 / 2 = 6. So x upper bound must be contracted to <= 6!
    const intX = constraints.getInterval("x");
    assert.ok(intX);
    assert.ok(intX!.hi <= 6.0001, `x upper bound should be <= 6, got ${intX!.hi}`);

    // When x = 0, max y is 12 / 3 = 4. So y upper bound must be contracted to <= 4!
    const intY = constraints.getInterval("y");
    assert.ok(intY);
    assert.ok(intY!.hi <= 4.0001, `y upper bound should be <= 4, got ${intY!.hi}`);

    // Contradictory assertion: x >= 7 (impossible since 2*x + 3*y <= 12 and y >= 0 => 2*x <= 12 => x <= 6)
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["x", ">=", 7],
      domain: "constraint",
    });

    // Re-asserting the hyperplane constraint or checking SAT detects the contradiction
    coordinator.assertLiteral({
      predicate: "hyperplane",
      args: [{ x: 2, y: 3 }, "<=", 12],
      domain: "constraint",
    });

    const unsatRes = coordinator.checkSat();
    assert.equal(unsatRes.isSat, false, "Hyperplane 2*x + 3*y <= 12 with x >= 7 should be UNSAT");

    // Pop decision level restores SAT
    coordinator.popLevel();
    const restored = coordinator.checkSat();
    assert.equal(restored.isSat, true);
  });
});
