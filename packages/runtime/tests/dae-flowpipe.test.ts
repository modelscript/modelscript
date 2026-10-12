// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ivAdd, ivMul, ivNeg, ivSub } from "../src/analysis/outward_rounding.js";
import { DaeFlowpipeSolver, type DaeSystem, IntervalKrawczykOperator } from "../src/analysis/wasm_dae_flowpipe.js";
import { Interval } from "../src/analysis/wasm_interval.js";

describe("Native Validated DAE Flowpipe Reachability Suite", () => {
  it("should contract algebraic variables using Interval Krawczyk operator", () => {
    // Algebraic constraint: g(x, z) = z - 2*x = 0  =>  z = 2*x
    // J_z = 1.0
    const dae: DaeSystem = {
      numDiffStates: 1,
      numAlgStates: 1,
      f: (_t, x, z) => [-z[0]!],
      g: (x, z) => [z[0]! - 2 * x[0]!],
      jacobianGz: (_x, _z) => [[1.0]],
    };

    // x in [1.0, 1.1], z initial enclosure [-10, 10]
    const xBox = [new Interval(1.0, 1.1)];
    const zBox = [new Interval(-10, 10)];
    const z0Nom = [2.0];
    const x0Nom = [1.0];

    const res = IntervalKrawczykOperator.contract(dae, xBox, zBox, z0Nom, x0Nom);
    assert(res.isContracted);

    const contractedZ = res.contractedZ[0]!;
    // Expect z contracted tightly around 2*x in [2.0, 2.2]
    assert(
      contractedZ.lo >= 1.99 && contractedZ.hi <= 2.21,
      `z [${contractedZ.lo}, ${contractedZ.hi}] should be tightly in [2.0, 2.2]`,
    );
  });

  it("should compute guaranteed flowpipe tubes for DAE systems", () => {
    // DAE: \dot{x} = -x * z,  g(x, z) = z - 1 = 0
    const dae: DaeSystem = {
      numDiffStates: 1,
      numAlgStates: 1,
      f: (_t, x, z) => [-x[0]! * z[0]!],
      g: (_x, z) => [z[0]! - 1.0],
      jacobianGz: (_x, _z) => [[1.0]],
    };

    const initialX = [new Interval(0.95, 1.05)];
    const initialZ = [new Interval(0.8, 1.2)];

    const result = DaeFlowpipeSolver.solve({
      dae,
      initialX,
      initialZ,
      nominalX: [1.0],
      nominalZ: [1.0],
      tSpan: [0, 0.5],
      dt: 0.1,
    });

    assert(result.isCertifiedSafe);
    assert.strictEqual(result.totalSteps, 6);

    // Differential state x decays over time: x(t) = x0 * exp(-t)
    const finalStep = result.steps[result.steps.length - 1]!;
    assert(finalStep.nominalX[0]! < 1.0, "x should decay exponentially");
    assert(finalStep.isAlgebraicManifoldCertified, "Algebraic manifold must be certified");
  });
});

describe("Validated DAE flowpipe (interval Krawczyk, a priori enclosure)", () => {
  // x' = -z,  g(x, z) = z^3 + z - x = 0   (J_z = 3 z^2 + 1 >= 1, index 1)
  const pt = (v: number) => new Interval(v, v);
  const cubic: DaeSystem = {
    numDiffStates: 1,
    numAlgStates: 1,
    f: (_t, _x, z) => [-z[0]!],
    g: (x, z) => [z[0]! ** 3 + z[0]! - x[0]!],
    jacobianGz: (_x, z) => [[3 * z[0]! ** 2 + 1]],
    fInterval: (_t, _x, z) => [ivNeg(z[0]!)],
    gInterval: (x, z) => [ivSub(ivAdd(ivMul(ivMul(z[0]!, z[0]!), z[0]!), z[0]!), x[0]!)],
    jacobianGzInterval: (_x, z) => [[ivAdd(ivMul(pt(3), ivMul(z[0]!, z[0]!)), pt(1))]],
  };

  /** Reference: RK4 on x' = -z(x) with z(x) solved by Newton. */
  const solveZ = (x: number): number => {
    let z = x;
    for (let i = 0; i < 60; i++) z -= (z ** 3 + z - x) / (3 * z * z + 1);
    return z;
  };
  const reference = (x0: number, t: number): number => {
    let x = x0;
    const h = 1e-4;
    for (let s = 0; s < t - 1e-15; s += h) {
      const k1 = -solveZ(x);
      const k2 = -solveZ(x + 0.5 * h * k1);
      const k3 = -solveZ(x + 0.5 * h * k2);
      const k4 = -solveZ(x + h * k3);
      x += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    }
    return x;
  };

  it("encloses the true DAE solution and is proven (float-sound)", () => {
    const res = DaeFlowpipeSolver.solve({
      dae: cubic,
      initialX: [new Interval(0.9, 1.1)],
      initialZ: [new Interval(0, 2)],
      nominalX: [1.0],
      nominalZ: [solveZ(1.0)],
      tSpan: [0, 0.5],
      dt: 0.05,
    });
    assert.equal(res.verdict.kind, "proven", res.summary);
    const last = res.steps[res.steps.length - 1]!;
    for (const x0 of [0.9, 0.95, 1.0, 1.05, 1.1]) {
      for (const step of res.steps) {
        const x = reference(x0, step.time);
        assert.ok(
          x >= step.xTubes[0]!.lo - 1e-6 && x <= step.xTubes[0]!.hi + 1e-6,
          `x0=${x0} t=${step.time}: ${x} not in [${step.xTubes[0]!.lo}, ${step.xTubes[0]!.hi}]`,
        );
        const z = solveZ(x);
        assert.ok(z >= step.zTubes[0]!.lo - 1e-6 && z <= step.zTubes[0]!.hi + 1e-6, `z at t=${step.time}`);
      }
    }
    assert.ok(last.xTubes[0]!.width < 1.0, `tube width ${last.xTubes[0]!.width}`);
  });

  it("singular algebraic Jacobian is never proven (index > 1 guard)", () => {
    const singular: DaeSystem = {
      numDiffStates: 1,
      numAlgStates: 1,
      f: (_t, _x, z) => [-z[0]!],
      g: (x, z) => [z[0]! * z[0]! - x[0]!],
      jacobianGz: (_x, z) => [[2 * z[0]!]],
      fInterval: (_t, _x, z) => [ivNeg(z[0]!)],
      gInterval: (x, z) => [ivSub(ivMul(z[0]!, z[0]!), x[0]!)],
      jacobianGzInterval: (_x, z) => [[ivMul(pt(2), z[0]!)]],
    };
    const res = DaeFlowpipeSolver.solve({
      dae: singular,
      initialX: [new Interval(-0.1, 0.1)],
      initialZ: [new Interval(-1, 1)],
      nominalX: [0],
      nominalZ: [0],
      tSpan: [0, 0.2],
      dt: 0.05,
    });
    assert.notEqual(res.verdict.kind, "proven");
    assert.equal(res.isCertifiedSafe, false);
  });

  it("a requirement the enclosure cannot satisfy gives unknown, not violated", () => {
    const res = DaeFlowpipeSolver.solve({
      dae: cubic,
      initialX: [new Interval(0.9, 1.1)],
      initialZ: [new Interval(0, 2)],
      nominalX: [1.0],
      nominalZ: [solveZ(1.0)],
      tSpan: [0, 0.2],
      dt: 0.05,
      requirements: [{ variable: "x", index: 0, operator: "<=", limitValue: 1.0 }],
    });
    assert.equal(res.verdict.kind, "unknown");
    assert.equal(res.isCertifiedSafe, false);
  });

  it("point-only systems stay non-rigorous (unknown)", () => {
    const res = DaeFlowpipeSolver.solve({
      dae: { ...cubic, fInterval: undefined, gInterval: undefined, jacobianGzInterval: undefined },
      initialX: [new Interval(0.9, 1.1)],
      initialZ: [new Interval(0, 2)],
      nominalX: [1.0],
      nominalZ: [solveZ(1.0)],
      tSpan: [0, 0.2],
      dt: 0.05,
    });
    assert.equal(res.verdict.kind, "unknown");
  });
});
