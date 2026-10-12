// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval, TaylorModel, TaylorModelFlowpipeSolver } from "../src/analysis/wasm_taylor_model.js";

describe("Taylor Model Flowpipe Symbolic Carry-Over Suite", () => {
  it("should drastically mitigate wrapping effect on 2D rotating damped flow", () => {
    // Rotating flow:
    // dx1/dt = -0.1*x1 + x2
    // dx2/dt = -x1 - 0.1*x2
    const initialEnclosure = [new Interval(0.9, 1.1), new Interval(-0.1, 0.1)];
    const nominalInitial = [1.0, 0.0];
    const tSpan: [number, number] = [0, 2.0];
    const dt = 0.05;

    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => {
      const dx1 = y[0]!.scale(-0.1).add(y[1]!);
      const dx2 = y[0]!.scale(-1.0).add(y[1]!.scale(-0.1));
      return [dx1, dx2];
    };

    // 1. Solve with re-boxing (symbolicCarryOver: false)
    const resRebox = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 3,
      symbolicCarryOver: false,
    });

    // 2. Solve with symbolic carry-over (symbolicCarryOver: true)
    const resCarry = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 3,
      symbolicCarryOver: true,
    });

    assert(resRebox.isCertifiedSafe);
    assert(resCarry.isCertifiedSafe);
    assert.strictEqual(resRebox.steps.length, resCarry.steps.length);

    const lastStepRebox = resRebox.steps[resRebox.steps.length - 1]!;
    const lastStepCarry = resCarry.steps[resCarry.steps.length - 1]!;

    const reboxWidth = Math.max(lastStepRebox.tubes[0]!.width, lastStepRebox.tubes[1]!.width);
    const carryWidth = Math.max(lastStepCarry.tubes[0]!.width, lastStepCarry.tubes[1]!.width);

    // Symbolic carry-over should be at least 3x tighter than naive re-boxing
    assert(
      carryWidth < reboxWidth / 3,
      `Expected carry-over width (${carryWidth}) to be < 1/3 of re-box width (${reboxWidth})`,
    );

    // Verify all nominal points lie inside the tubes
    for (const step of resCarry.steps) {
      assert(step.tubes[0]!.lo <= step.nominal[0]!);
      assert(step.tubes[0]!.hi >= step.nominal[0]!);
      assert(step.tubes[1]!.lo <= step.nominal[1]!);
      assert(step.tubes[1]!.hi >= step.nominal[1]!);
    }
  });

  it("should support numeric coordinate refresh period (e.g. refresh every 10 steps)", () => {
    const initialEnclosure = [new Interval(0.95, 1.05), new Interval(-0.05, 0.05)];
    const nominalInitial = [1.0, 0.0];
    const tSpan: [number, number] = [0, 1.0];
    const dt = 0.05;

    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => {
      const dx1 = y[0]!.scale(-0.1).add(y[1]!);
      const dx2 = y[0]!.scale(-1.0).add(y[1]!.scale(-0.1));
      return [dx1, dx2];
    };

    const res = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 2,
      symbolicCarryOver: 10,
    });

    assert(res.isCertifiedSafe);
    assert.strictEqual(res.steps.length, 21); // 0..20 steps

    for (const step of res.steps) {
      assert(step.tubes[0]!.lo <= step.nominal[0]!);
      assert(step.tubes[0]!.hi >= step.nominal[0]!);
      assert(step.tubes[1]!.lo <= step.nominal[1]!);
      assert(step.tubes[1]!.hi >= step.nominal[1]!);
    }
  });

  it("should soundly contain 100 Monte-Carlo RK4 sample trajectories across full horizon", () => {
    const initialEnclosure = [new Interval(0.9, 1.1), new Interval(-0.1, 0.1)];
    const nominalInitial = [1.0, 0.0];
    const tSpan: [number, number] = [0, 1.5];
    const dt = 0.05;

    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => {
      const dx1 = y[0]!.scale(-0.1).add(y[1]!);
      const dx2 = y[0]!.scale(-1.0).add(y[1]!.scale(-0.1));
      return [dx1, dx2];
    };

    const res = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 3,
      symbolicCarryOver: true,
    });

    assert(res.isCertifiedSafe);

    // RK4 numerical integrator for testing sound containment of concrete trajectories
    const f = (_t: number, [x1, x2]: [number, number]): [number, number] => [-0.1 * x1 + x2, -x1 - 0.1 * x2];

    const rk4Step = (t: number, y: [number, number], h: number): [number, number] => {
      const k1 = f(t, y);
      const k2 = f(t + 0.5 * h, [y[0] + 0.5 * h * k1[0], y[1] + 0.5 * h * k1[1]]);
      const k3 = f(t + 0.5 * h, [y[0] + 0.5 * h * k2[0], y[1] + 0.5 * h * k2[1]]);
      const k4 = f(t + h, [y[0] + h * k3[0], y[1] + h * k3[1]]);
      return [
        y[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
        y[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      ];
    };

    let seed = 42;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let sample = 0; sample < 100; sample++) {
      const x0 = 0.9 + 0.2 * rng();
      const v0 = -0.1 + 0.2 * rng();
      let state: [number, number] = [x0, v0];
      let t = 0;

      for (let sIdx = 1; sIdx < res.steps.length; sIdx++) {
        // Sub-step RK4 with small step size for high accuracy
        const subSteps = 10;
        const subH = dt / subSteps;
        for (let sub = 0; sub < subSteps; sub++) {
          state = rk4Step(t, state, subH);
          t += subH;
        }

        const tube = res.steps[sIdx]!.tubes;
        assert(
          state[0] >= tube[0]!.lo - 1e-6 && state[0] <= tube[0]!.hi + 1e-6,
          `Trajectory sample ${sample} state[0]=${state[0]} outside tube[0]=[${tube[0]!.lo}, ${tube[0]!.hi}] at step ${sIdx}`,
        );
        assert(
          state[1] >= tube[1]!.lo - 1e-6 && state[1] <= tube[1]!.hi + 1e-6,
          `Trajectory sample ${sample} state[1]=${state[1]} outside tube[1]=[${tube[1]!.lo}, ${tube[1]!.hi}] at step ${sIdx}`,
        );
      }
    }
  });
});
