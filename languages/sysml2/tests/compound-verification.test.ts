// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkCompoundConstraintConsistency,
  evaluateSysML2Expression,
  extractAtomicComparisons,
  verifySysML2ConstraintBlock,
  verifySysML2Requirements,
  verifyTemporalContract,
} from "../src/index.js";

describe("SysML v2 Compound Boolean & Arithmetic Requirement/Constraint Verification", () => {
  it("evaluates arithmetic expressions with operator precedence, parentheses, and functions", () => {
    const val = evaluateSysML2Expression("0.5 * mass * velocity^2 + mass * 9.81 * height", {
      mass: 10,
      velocity: 4,
      height: 2,
    });
    assert.equal(val, 0.5 * 10 * 16 + 10 * 9.81 * 2);

    const fnVal = evaluateSysML2Expression("sqrt(dx^2 + dy^2) <= maxDist * (1 - margin)", {
      dx: 3,
      dy: 4,
      maxDist: 10,
      margin: 0.4,
    });
    assert.equal(fnVal, true); // 5 <= 6
  });

  it("verifies compound require/assert constraint blocks with and, or, implies, not", () => {
    const block = `
      require constraint ThermalAndPowerBudget {
        voltage * current <= maxPower * 0.9 and
        (coolingActive implies temp <= 85.0) and
        not (temp > 105.0 or current > 25.0)
      }
    `;

    const passOutcome = verifySysML2ConstraintBlock(block, {
      voltage: 24,
      current: 10,
      maxPower: 300,
      coolingActive: true,
      temp: 78,
    });
    assert.equal(passOutcome.satisfied, true);
    assert.ok(passOutcome.margin >= 7 - 1e-6); // min(270 - 240 = 30, 85 - 78 = 7, ...)
    assert.equal(passOutcome.violatedAtoms.length, 0);

    const failOutcome = verifySysML2ConstraintBlock(block, {
      voltage: 24,
      current: 12, // 288 > 270
      maxPower: 300,
      coolingActive: true,
      temp: 92, // 92 > 85
    });
    assert.equal(failOutcome.satisfied, false);
    assert.ok(failOutcome.margin < 0);
    assert.ok(failOutcome.violatedAtoms.length >= 2);
  });

  it("verifies multi-requirement specifications with assume/require blocks", () => {
    const report = verifySysML2Requirements(
      [
        {
          name: "BrakeStoppingDistance",
          assumption: "roadFriction >= 0.7 and initialSpeed <= 30",
          constraint: "assert constraint { (initialSpeed^2) / (2 * 9.81 * roadFriction) <= maxStopDist }",
        },
        {
          name: "IceModeFallback",
          assumption: "roadFriction < 0.3",
          constraint: "require constraint { initialSpeed <= 10 }",
        },
      ],
      {
        roadFriction: 0.8,
        initialSpeed: 25,
        maxStopDist: 45,
      },
    );

    assert.equal(report.allSatisfied, true);
    assert.equal(report.results[0]?.satisfied, true);
    assert.equal(report.results[0]?.vacuous, false);
    assert.equal(report.results[1]?.satisfied, true);
    assert.equal(report.results[1]?.vacuous, true);
  });

  it("extracts atomic comparisons from compound constraint blocks", () => {
    const atoms = extractAtomicComparisons(
      "require constraint { sled.mass <= maxMass * 0.85 and sled.v >= 2.0 and not (sled.temp > 90) }",
    );
    assert.equal(atoms.length, 3);
    assert.equal(atoms[0]?.lhs, "sled.mass");
    assert.equal(atoms[0]?.operator, "<=");
    assert.equal(atoms[2]?.negated, true);
  });

  it("checks compound constraint consistency with DNF + Simplex", () => {
    const satRes = checkCompoundConstraintConsistency(
      [
        { name: "PowerSum", expression: "2 * x + 3 * y <= maxBudget * 0.8" },
        { name: "MinBounds", expression: "x >= 4 and (y >= 10 or y >= 2)" },
      ],
      { maxBudget: 25 }, // 2x + 3y <= 20, x >= 4, (y >= 10 or y >= 2) -> branch y >= 2 is feasible (2*4 + 3*2 = 14 <= 20)
    );
    assert.equal(satRes.isConsistent, true);
    assert.ok(satRes.witnessAssignment);

    const unsatRes = checkCompoundConstraintConsistency([
      { name: "ReqA", expression: "x + y <= 10" },
      { name: "ReqB", expression: "x >= 6 and y >= 7" },
    ]);
    assert.equal(unsatRes.isConsistent, false);
    assert.ok(unsatRes.conflictingRequirements.includes("ReqA") || unsatRes.conflictingRequirements.includes("ReqB"));
  });

  it("verifies temporal contracts with compound boolean and arithmetic expressions", () => {
    const res = verifyTemporalContract(
      {
        name: "PowerThermalContract",
        assumption: "voltage >= 10 and current >= 0",
        guarantee: "voltage * current <= 120 and (current > 5 implies temp <= 80)",
      },
      [0, 1, 2],
      {
        voltage: [12, 12, 12],
        current: [4, 6, 8],
        temp: [50, 72, 78],
      },
    );
    assert.equal(res.isSatisfied, true);
    assert.ok(res.minRobustness >= 2 - 1e-6);
  });
});
