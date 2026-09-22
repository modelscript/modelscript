// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval, TaylorModel, TaylorModelFlowpipeSolver } from "../src/analysis/wasm_taylor_model.js";

describe("Multivariate Taylor Model & Validated Flowpipe Reachability Suite", () => {
  it("should correctly perform Taylor model polynomial arithmetic and remainders", () => {
    // 1 variable domain x in [-1, 1]
    const domain = [new Interval(-1, 1)];

    // P1(x) = 2 + 3x
    const tm1 = TaylorModel.constant(2, 1, domain, 2);
    tm1.set([1], 3);

    // P2(x) = 1 - 2x
    const tm2 = TaylorModel.constant(1, 1, domain, 2);
    tm2.set([1], -2);

    // tmAdd = tm1 + tm2 = 3 + x
    const tmAdd = tm1.add(tm2);
    assert.strictEqual(tmAdd.get([0]), 3);
    assert.strictEqual(tmAdd.get([1]), 1);

    // Range of tmAdd over [-1, 1] is [3 - 1, 3 + 1] = [2, 4]
    const addRange = tmAdd.evaluateRange();
    assert.strictEqual(addRange.lo, 2);
    assert.strictEqual(addRange.hi, 4);

    // Multiplication: (2 + 3x)(1 - 2x) = 2 - x - 6x^2
    const tmProd = tm1.mul(tm2);
    assert.strictEqual(tmProd.get([0]), 2);
    assert.strictEqual(tmProd.get([1]), -1);
    assert.strictEqual(tmProd.get([2]), -6);

    // Over [-1, 1], 2 - x - 6x^2 range evaluation contains actual values
    const prodRange = tmProd.evaluateRange();
    // At x=0: 2. At x=1: -5. At x=-1: -3.
    assert(prodRange.lo <= -5);
    assert(prodRange.hi >= 2);
  });

  it("should integrate Taylor models with respect to time", () => {
    // Domain: t in [0, 0.5]
    const domain = [new Interval(0, 0.5)];
    // P(t) = 4 + 6t
    const tm = TaylorModel.constant(4, 1, domain, 2);
    tm.set([1], 6);

    // \int_0^t (4 + 6\tau) d\tau = 4t + 3t^2
    const integrated = tm.integrateTime(0);
    assert.strictEqual(integrated.get([0]), 0);
    assert.strictEqual(integrated.get([1]), 4);
    assert.strictEqual(integrated.get([2]), 3);

    // At t=0.5: 4*(0.5) + 3*(0.25) = 2 + 0.75 = 2.75
    const valAtPoint = integrated.evaluateAt([0.5]);
    assert.strictEqual(valAtPoint, 2.75);
  });

  it("should compute guaranteed flowpipe enclosure for harmonic oscillator dynamics", () => {
    // Harmonic oscillator:
    // dx1/dt = x2
    // dx2/dt = -x1
    const dt = 0.05;
    const tSpan: [number, number] = [0, 0.5];

    // Initial enclosure: x1 in [0.95, 1.05], x2 in [-0.05, 0.05]
    const initialEnclosure = [new Interval(0.95, 1.05), new Interval(-0.05, 0.05)];
    const nominalInitial = [1.0, 0.0];

    const result = TaylorModelFlowpipeSolver.solve({
      dynamics: (t, y) => {
        const dx1 = y[1]!.clone();
        const dx2 = y[0]!.scale(-1);
        return [dx1, dx2];
      },
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 2,
      requirements: [
        {
          stateIndex: 0,
          stateName: "x1_position",
          operator: "<=",
          limitValue: 1.2,
        },
        {
          stateIndex: 0,
          stateName: "x1_position",
          operator: ">=",
          limitValue: 0.5,
        },
      ],
      maxPicardIterations: 4,
    });

    assert(result.isCertifiedSafe, `Expected safe enclosure but got: ${result.summary}`);
    assert.strictEqual(result.violations.length, 0);
    assert.strictEqual(result.steps.length, 11); // t = 0, 0.05, ..., 0.50

    // Check that nominal trajectory lies strictly within the guaranteed tubes
    for (const step of result.steps) {
      for (let i = 0; i < 2; i++) {
        const nom = step.nominal[i]!;
        const tube = step.tubes[i]!;
        assert(
          nom >= tube.lo - 1e-9 && nom <= tube.hi + 1e-9,
          `Nominal ${nom} at step ${step.stepIndex} state ${i} escaped flowpipe tube [${tube.lo}, ${tube.hi}]`,
        );
      }
    }
  });

  it("should detect safety violations when continuous flowpipe breaches boundary", () => {
    // Non-linear vehicle braking:
    // dv/dt = -0.1 * v^2 - 2.0
    const dt = 0.1;
    const tSpan: [number, number] = [0, 2.0];

    // Initial velocity: [19.0, 21.0] m/s
    const initialEnclosure = [new Interval(19.0, 21.0)];
    const nominalInitial = [20.0];

    const result = TaylorModelFlowpipeSolver.solve({
      dynamics: (t, y) => {
        const v = y[0]!;
        const vSquared = v.mul(v);
        const drag = vSquared.scale(-0.1);
        const braking = TaylorModel.constant(-2.0, v.numVars, v.domain, v.order);
        return [drag.add(braking)];
      },
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 2,
      requirements: [
        // Unrealistically high speed threshold: requires v >= 18 m/s throughout
        {
          stateIndex: 0,
          stateName: "velocity",
          operator: ">=",
          limitValue: 18.0,
        },
      ],
      maxPicardIterations: 4,
    });

    assert.strictEqual(result.isCertifiedSafe, false);
    assert(result.violations.length > 0, "Expected violations due to braking deceleration");

    const firstViolation = result.violations[0]!;
    assert.strictEqual(firstViolation.stateIndex, 0);
    assert.strictEqual(firstViolation.operator, ">=");
    assert(firstViolation.worstCaseValue < 18.0);
    assert(firstViolation.reason.includes("Flowpipe breach"));
  });
});
