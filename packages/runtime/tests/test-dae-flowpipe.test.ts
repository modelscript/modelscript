// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
