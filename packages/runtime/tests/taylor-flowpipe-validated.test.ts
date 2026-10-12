// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { Interval, TaylorModel, TaylorModelFlowpipeSolver } from "../src/analysis/wasm_taylor_model.js";

type F = (t: number, y: number[]) => number[];

/** Classical RK4 with small fixed step: reference trajectory for point sampling. */
function rk4(f: F, y0: number[], t0: number, t1: number, h = 1e-4): number[] {
  let y = [...y0];
  let t = t0;
  while (t < t1 - 1e-15) {
    const dt = Math.min(h, t1 - t);
    const k1 = f(t, y);
    const k2 = f(
      t + dt / 2,
      y.map((v, i) => v + (dt / 2) * k1[i]!),
    );
    const k3 = f(
      t + dt / 2,
      y.map((v, i) => v + (dt / 2) * k2[i]!),
    );
    const k4 = f(
      t + dt,
      y.map((v, i) => v + dt * k3[i]!),
    );
    y = y.map((v, i) => v + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
    t += dt;
  }
  return y;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("validated Taylor-model flowpipe (Schauder-checked Picard)", () => {
  it("Van der Pol: sampled trajectories stay inside every step enclosure", () => {
    const mu = 1.0;
    const f: F = (_t, [x, y]) => [y!, mu * (1 - x! * x!) * y! - x!];
    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => {
      const x = y[0]!;
      const v = y[1]!;
      const one = x.mul(x).scale(-1).addConstant(1);
      return [v, one.mul(v).scale(mu).sub(x)];
    };
    const box = [new Interval(1.4, 1.5), new Interval(2.3, 2.4)];
    const res = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure: box,
      nominalInitial: [1.45, 2.35],
      tSpan: [0, 0.5],
      dt: 0.02,
      order: 4,
    });
    assert.ok(res.reachedTime >= 0.5 - 1e-9, `reached ${res.reachedTime}: ${res.summary}`);
    const rand = rng(42);
    for (let s = 0; s < 40; s++) {
      const y0 = box.map((iv) => iv.lo + rand() * iv.width);
      for (const step of res.steps) {
        const y = rk4(f, y0, 0, step.time, 5e-4);
        for (let j = 0; j < 2; j++) {
          // The step tube covers the whole step interval, so it must contain the end-point state.
          assert.ok(
            y[j]! >= step.tubes[j]!.lo - 1e-6 && y[j]! <= step.tubes[j]!.hi + 1e-6,
            `sample ${s} state ${j} at t=${step.time}: ${y[j]} not in [${step.tubes[j]!.lo}, ${step.tubes[j]!.hi}]`,
          );
        }
      }
    }
  });

  it("finite-time blow-up is never reported as proven", () => {
    // x' = x^2, x(0) in [1, 1.2] blows up at t = 1/x0 <= 1, so no enclosure exists on [0, 2].
    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => [y[0]!.mul(y[0]!)];
    const res = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure: [new Interval(1, 1.2)],
      nominalInitial: [1.1],
      tSpan: [0, 2],
      dt: 0.05,
      order: 3,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 1e9 }],
    });
    assert.equal(res.isCertifiedSafe, false);
    assert.notEqual(res.verdict.kind, "proven");
    assert.ok(res.reachedTime < 2, `reached ${res.reachedTime}`);
  });

  it("an enclosure crossing a limit is unknown, not violated", () => {
    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => [y[0]!.scale(-1)];
    const res = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure: [new Interval(0.9, 1.1)],
      nominalInitial: [1.0],
      tSpan: [0, 0.5],
      dt: 0.05,
      order: 3,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 1.0 }],
    });
    assert.equal(res.verdict.kind, "unknown");
    assert.equal(res.isCertifiedSafe, false);
  });

  it("linear decay: proven with a tight, correct enclosure", () => {
    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => [y[0]!.scale(-1)];
    const res = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure: [new Interval(0.9, 1.1)],
      nominalInitial: [1.0],
      tSpan: [0, 1],
      dt: 0.1,
      order: 4,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 1.2 }],
    });
    assert.equal(res.verdict.kind, "proven");
    const last = res.steps[res.steps.length - 1]!;
    assert.ok(last.tubes[0]!.lo <= 0.9 * Math.exp(-1) + 1e-9);
    assert.ok(last.tubes[0]!.hi >= 1.1 * Math.exp(-1) - 1e-9);
    assert.ok(last.tubes[0]!.width < 0.5, `width ${last.tubes[0]!.width}`);
  });

  it("Brusselator: 50 randomized RK4 trajectories stay inside step enclosures", () => {
    const A = 1.0;
    const B = 1.5;
    const f: F = (_t, [x, y]) => [A + x! * x! * y! - (B + 1) * x!, B * x! - x! * x! * y!];
    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => {
      const x = y[0]!;
      const yVar = y[1]!;
      const xSq = x.mul(x);
      const xSqY = xSq.mul(yVar);
      // dx/dt = 1 + x^2 y - 2.5 x
      const dx = xSqY.addConstant(A).sub(x.scale(B + 1));
      // dy/dt = 1.5 x - x^2 y
      const dy = x.scale(B).sub(xSqY);
      return [dx, dy];
    };
    const box = [new Interval(0.95, 1.05), new Interval(1.45, 1.55)];
    const res = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure: box,
      nominalInitial: [1.0, 1.5],
      tSpan: [0, 0.3],
      dt: 0.02,
      order: 4,
    });
    assert.ok(res.reachedTime >= 0.3 - 1e-9, `reached ${res.reachedTime}: ${res.summary}`);
    assert.strictEqual(res.verdict.kind, "proven");

    const rand = rng(12345);
    for (let s = 0; s < 50; s++) {
      const y0 = box.map((iv) => iv.lo + rand() * iv.width);
      for (const step of res.steps) {
        const y = rk4(f, y0, 0, step.time, 5e-4);
        for (let j = 0; j < 2; j++) {
          assert.ok(
            y[j]! >= step.tubes[j]!.lo - 1e-6 && y[j]! <= step.tubes[j]!.hi + 1e-6,
            `Brusselator sample ${s} state ${j} at t=${step.time}: ${y[j]} not in [${step.tubes[j]!.lo}, ${step.tubes[j]!.hi}]`,
          );
        }
      }
    }
  });
});
