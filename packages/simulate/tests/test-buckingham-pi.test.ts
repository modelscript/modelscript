// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { BuckinghamPiEngine, PhysicalVariableSpec } from "../src/surrogates/buckingham-pi.js";

describe("BuckinghamPiEngine - Similarity & Dedimensionalization", () => {
  it("resolves basic and derived SI unit dimensions correctly", () => {
    assert.deepStrictEqual(BuckinghamPiEngine.resolveDimension("m"), [1, 0, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(BuckinghamPiEngine.resolveDimension("kg"), [0, 1, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(BuckinghamPiEngine.resolveDimension("s"), [0, 0, 1, 0, 0, 0, 0]);
    assert.deepStrictEqual(BuckinghamPiEngine.resolveDimension("Pa"), [-1, 1, -2, 0, 0, 0, 0]);
    assert.deepStrictEqual(BuckinghamPiEngine.resolveDimension("kg/m3"), [-3, 1, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(BuckinghamPiEngine.resolveDimension("Pa*s"), [-1, 1, -1, 0, 0, 0, 0]);
    assert.deepStrictEqual(BuckinghamPiEngine.resolveDimension("W/(m*K)"), [1, 1, -3, 0, -1, 0, 0]);
    assert.deepStrictEqual(BuckinghamPiEngine.resolveDimension("1"), [0, 0, 0, 0, 0, 0, 0]);
  });

  it("derives the classic Reynolds number Re from [rho, v, D, mu]", () => {
    const vars: PhysicalVariableSpec[] = [
      { name: "rho", unit: "kg/m3" },
      { name: "v", unit: "m/s" },
      { name: "D", unit: "m" },
      { name: "mu", unit: "Pa*s" },
    ];

    const groups = BuckinghamPiEngine.derivePiGroups(vars);
    assert.strictEqual(groups.length, 1);

    const re = groups[0]!;
    assert(re.variables.includes("rho"));
    assert(re.variables.includes("v"));
    assert(re.variables.includes("D"));
    assert(re.variables.includes("mu"));

    // Check evaluation at typical water properties:
    // rho = 1000 kg/m3, v = 2 m/s, D = 0.05 m, mu = 0.001 Pa*s
    // Re = 1000 * 2 * 0.05 / 0.001 = 100,000
    const testVals = { rho: 1000, v: 2, D: 0.05, mu: 0.001 };
    const val = BuckinghamPiEngine.evaluatePi(re, testVals);

    // Either Re or 1/Re depending on basis sign convention
    const isDirect = Math.abs(val - 100000) < 1e-3;
    const isInverse = Math.abs(val - 1e-5) < 1e-8;
    assert(isDirect || isInverse);
  });

  it("evaluates and reconstructs physical variables bidirectionally", () => {
    const vars: PhysicalVariableSpec[] = [
      { name: "rho", unit: "kg/m3" },
      { name: "v", unit: "m/s" },
      { name: "D", unit: "m" },
      { name: "mu", unit: "Pa*s" },
    ];

    const groups = BuckinghamPiEngine.derivePiGroups(vars);
    const group = groups[0]!;

    const inputs = { rho: 998, v: 1.5, D: 0.02, mu: 0.001002 };
    const piVal = BuckinghamPiEngine.evaluatePi(group, inputs);

    // Reconstruct velocity from Pi
    const reconstructedV = BuckinghamPiEngine.reconstructPhysical(group, piVal, "v", {
      rho: 998,
      D: 0.02,
      mu: 0.001002,
    });

    assert(Math.abs(reconstructedV - 1.5) < 1e-3);

    // Reconstruct diameter D from Pi
    const reconstructedD = BuckinghamPiEngine.reconstructPhysical(group, piVal, "D", {
      rho: 998,
      v: 1.5,
      mu: 0.001002,
    });

    assert(Math.abs(reconstructedD - 0.02) < 1e-4);
  });

  it("handles thermal fluid system with pressure drop [rho, v, D, mu, delta_p]", () => {
    const vars: PhysicalVariableSpec[] = [
      { name: "rho", unit: "kg/m3" },
      { name: "v", unit: "m/s" },
      { name: "D", unit: "m" },
      { name: "mu", unit: "Pa*s" },
      { name: "delta_p", unit: "Pa" },
    ];

    // 5 variables, 3 fundamental dimensions (L, M, T) => 5 - 3 = 2 dimensionless groups (e.g. Re, Eu)
    const groups = BuckinghamPiEngine.derivePiGroups(vars);
    assert.strictEqual(groups.length, 2);

    const testVals = { rho: 1000, v: 2, D: 0.1, mu: 0.001, delta_p: 500 };
    for (const g of groups) {
      const v = BuckinghamPiEngine.evaluatePi(g, testVals);
      assert(Number.isFinite(v));
      assert(v > 0);
    }
  });
});
