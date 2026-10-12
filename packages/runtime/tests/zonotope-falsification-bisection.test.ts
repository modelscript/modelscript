// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import type { DaeSystem } from "../src/analysis/wasm_dae_flowpipe.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { Zonotope } from "../src/analysis/wasm_zonotope.js";
import {
  ConservativeLinearizationSolver,
  getZonotopeExtremeSupportPoint,
  ZonotopeReachabilitySolver,
} from "../src/analysis/wasm_zonotope_reach.js";

describe("Phase 2: Zonotope Falsification & Automatic Bisection", () => {
  it("1. getZonotopeExtremeSupportPoint computes exact support vectors in coordinate directions", () => {
    // 2D Zonotope: c = [10, 20], g1 = [2, -3], g2 = [-1, 4]
    const z = new Zonotope(
      [10, 20],
      [
        [2, -3],
        [-1, 4],
      ],
    );

    // Coordinate 0 intervals: [10 - (2 + 1), 10 + (2 + 1)] = [7, 13]
    const ptMax0 = getZonotopeExtremeSupportPoint(z, 0, true, 2);
    assert.strictEqual(ptMax0[0], 13);
    // Corresponding y coordinate: 20 + 1*(-3) + (-1)*4 = 13
    assert.strictEqual(ptMax0[1], 13);

    const ptMin0 = getZonotopeExtremeSupportPoint(z, 0, false, 2);
    assert.strictEqual(ptMin0[0], 7);
    // Corresponding y coordinate: 20 - 1*(-3) - (-1)*4 = 27
    assert.strictEqual(ptMin0[1], 27);

    // Coordinate 1 intervals: [20 - (3 + 4), 20 + (3 + 4)] = [13, 27]
    const ptMax1 = getZonotopeExtremeSupportPoint(z, 1, true, 2);
    assert.strictEqual(ptMax1[1], 27);
    assert.strictEqual(ptMax1[0], 7);

    const ptMin1 = getZonotopeExtremeSupportPoint(z, 1, false, 2);
    assert.strictEqual(ptMin1[1], 13);
    assert.strictEqual(ptMin1[0], 13);
  });

  it("2. ZonotopeReachabilitySolver falsification identifies concrete boundary witness", () => {
    // 1D decay: dx/dt = -0.2 x, initial interval [10, 12], nominal = 11.
    // Requirement: x <= 11.4.
    // Nominal trajectory at t=0 is 11.0 <= 11.4 (safe), but corner x0=12.0 violates immediately.
    const A = [[-0.2]];
    const initialSet = [new Interval(10.0, 12.0)];

    // With falsification enabled (default):
    const resViolated = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      nominalInitial: [11.0],
      tSpan: [0, 1.0],
      dt: 0.1,
      enableFalsification: true,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 11.4 }],
    });

    assert.strictEqual(resViolated.verdict.kind, "violated");
    assert.strictEqual(resViolated.isCertifiedSafe, false);
    const witness = resViolated.violations.find((v) => v.isConcreteWitness);
    assert.ok(witness, "Should have a concrete witness");
    assert.strictEqual(witness.isConcreteWitness, true);
    assert.ok(witness.worstCaseValue > 11.4);

    // With falsification disabled:
    const resUnknown = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      nominalInitial: [11.0],
      tSpan: [0, 1.0],
      dt: 0.1,
      enableFalsification: false,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 11.4 }],
    });

    assert.strictEqual(resUnknown.verdict.kind, "unknown");
    if (resUnknown.verdict.kind === "unknown") {
      assert.strictEqual(resUnknown.verdict.reason, "inconclusive-enclosure");
    }
  });

  it("3. ZonotopeReachabilitySolver automatic bisection upgrades inconclusive enclosure to proven", () => {
    // 1D decay: dx/dt = -x, initial interval [0.5, 1.5], nominal = 1.0.
    // Over step [0, 0.2], true minimum is x(0.2) = 0.5 * exp(-0.2) = 0.409365.
    // All trajectories stay strictly >= 0.402.
    // For single box [0.5, 1.5], rTube = 1.5, curvature tube expands lower bound to 0.4002 < 0.402,
    // yielding an inconclusive crossing (verdict: unknown).
    // Bisection depth 1 splits into [0.5, 1.0] (rTube = 1.0) and [1.0, 1.5].
    // Lower bound for [0.5, 1.0] tightens to 0.4032 >= 0.402, proving safety!
    const A = [[-1.0]];
    const initialSet = [new Interval(0.5, 1.5)];
    const req = [{ stateIndex: 0, operator: ">=" as const, limitValue: 0.402 }];

    const resNoBisect = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      nominalInitial: [1.0],
      tSpan: [0, 0.2],
      dt: 0.2,
      maxBisectionDepth: 0,
      enableFalsification: true,
      requirements: req,
    });

    assert.strictEqual(resNoBisect.verdict.kind, "unknown");
    assert.strictEqual(resNoBisect.isCertifiedSafe, false);

    const resBisect = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      nominalInitial: [1.0],
      tSpan: [0, 0.2],
      dt: 0.2,
      maxBisectionDepth: 1,
      enableFalsification: true,
      requirements: req,
    });

    assert.strictEqual(resBisect.verdict.kind, "proven");
    assert.strictEqual(resBisect.isCertifiedSafe, true);
    assert.ok(resBisect.summary.includes("automatic bisection partition"));
  });

  it("4. ConservativeLinearizationSolver falsification finds nonlinear boundary witness", () => {
    // Nonlinear system: dx/dt = x^2, x(0) in [0.5, 1.2], nominal = 0.8
    // Analytic solution: x(t) = x0 / (1 - x0 * t).
    // For nominal x0 = 0.8, at t = 0.2: x(0.2) = 0.8 / (1 - 0.16) = 0.8 / 0.84 = 0.952 <= 1.2 (safe!).
    // For boundary x0 = 1.2, at t = 0.2: x(0.2) = 1.2 / (1 - 0.24) = 1.2 / 0.76 = 1.579 > 1.2 (violates!).
    const dae: DaeSystem = {
      numDiffStates: 1,
      numAlgStates: 0,
      f: (_t, x) => [x[0]! * x[0]!],
      g: () => [],
      jacobianGz: () => [],
      jacobianFx: (_t, x) => [[2.0 * x[0]!]],
      jacobianFxInterval: (_t, x) => [[new Interval(2.0 * x[0]!.lo, 2.0 * x[0]!.hi)]],
    };

    const res = ConservativeLinearizationSolver.solve({
      dae,
      initialSet: [new Interval(0.5, 1.2)],
      nominalInitial: [0.8],
      tSpan: [0, 0.2],
      dt: 0.1,
      budgetMs: 150,
      enableFalsification: true,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 1.2 }],
    });

    assert.strictEqual(res.verdict.kind, "violated");
    assert.strictEqual(res.isCertifiedSafe, false);
    const witness = res.violations.find((v) => v.isConcreteWitness);
    assert.ok(witness);
    assert.strictEqual(witness.isConcreteWitness, true);
    assert.ok(witness.reason.includes("witness") && witness.reason.includes("breached"));
  });

  it("5. ConservativeLinearizationSolver automatic bisection refines Lagrange remainder to prove safety", () => {
    // Damped nonlinear system: dx/dt = -x - 0.5 * x^2
    // Over interval [0.5, 1.5], nominal = 1.0.
    // Minimum true state over t in [0, 0.1] is x(0.1) ~ 0.452. All trajectories stay >= 0.43.
    // Without bisection (depth 0): radius r = 0.5 inflates remainder, causing lower tube to dip to 0.4205 < 0.43,
    // yielding an inconclusive crossing (verdict: unknown).
    // With bisection (depth 1): radius halved to 0.25, remainder reduces 4x.
    // Both [0.5, 1.0] and [1.0, 1.5] certify safe >= 0.43 -> overall verdict: proven!
    const dae: DaeSystem = {
      numDiffStates: 1,
      numAlgStates: 0,
      f: (_t, x) => [-x[0]! - 0.5 * x[0]! * x[0]!],
      g: () => [],
      jacobianGz: () => [],
      jacobianFx: (_t, x) => [[-1.0 - x[0]!]],
      jacobianFxInterval: (_t, x) => [[new Interval(-1.0 - x[0]!.hi, -1.0 - x[0]!.lo)]],
    };

    const req = [{ stateIndex: 0, operator: ">=" as const, limitValue: 0.43 }];

    const resNoBisect = ConservativeLinearizationSolver.solve({
      dae,
      initialSet: [new Interval(0.5, 1.5)],
      nominalInitial: [1.0],
      tSpan: [0, 0.1],
      dt: 0.1,
      budgetMs: 150,
      maxBisectionDepth: 0,
      requirements: req,
    });

    assert.strictEqual(resNoBisect.verdict.kind, "unknown");
    assert.strictEqual(resNoBisect.isCertifiedSafe, false);

    const resBisect = ConservativeLinearizationSolver.solve({
      dae,
      initialSet: [new Interval(0.5, 1.5)],
      nominalInitial: [1.0],
      tSpan: [0, 0.1],
      dt: 0.1,
      budgetMs: 150,
      maxBisectionDepth: 1,
      requirements: req,
    });

    assert.strictEqual(resBisect.verdict.kind, "proven");
    assert.strictEqual(resBisect.isCertifiedSafe, true);
    assert.ok(resBisect.summary.includes("automatic bisection partition"));
  });
});
