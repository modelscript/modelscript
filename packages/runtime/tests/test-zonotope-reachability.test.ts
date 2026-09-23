// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from "expect";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { Zonotope } from "../src/analysis/wasm_zonotope.js";
import { computeMatrixExponential, ZonotopeReachabilitySolver } from "../src/analysis/wasm_zonotope_reach.js";

describe("High-Dimensional Zonotope Linear Continuous Reachability", () => {
  it("should compute accurate matrix exponentials", () => {
    // 2x2 harmonic oscillator A = [[0, 1], [-1, 0]]
    const A = [
      [0, 1],
      [-1, 0],
    ];
    const dt = 0.1;
    const { expM, remainderNorm } = computeMatrixExponential(A, dt, 6);

    expect(expM.length).toBe(2);
    expect(expM[0]![0]).toBeCloseTo(Math.cos(dt), 4);
    expect(expM[0]![1]).toBeCloseTo(Math.sin(dt), 4);
    expect(expM[1]![0]).toBeCloseTo(-Math.sin(dt), 4);
    expect(expM[1]![1]).toBeCloseTo(Math.cos(dt), 4);
    expect(remainderNorm).toBeLessThan(1e-6);
  });

  it("should compute reachability tubes and certify safety for 1D stable system", () => {
    // dx/dt = -0.1 x
    const A = [[-0.1]];
    const initialSet = [new Interval(10.0, 12.0)];

    const result = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      tSpan: [0, 5],
      dt: 0.1,
      requirements: [
        { stateIndex: 0, operator: "<=", limitValue: 12.5 },
        { stateIndex: 0, operator: ">=", limitValue: 5.0 },
      ],
    });

    expect(result.isCertifiedSafe).toBe(true);
    expect(result.violations.length).toBe(0);
    expect(result.totalSteps).toBeGreaterThan(45);

    // Initial enclosure should enclose [10, 12]
    const initEnc = result.steps[0]!.enclosure[0]!;
    expect(initEnc.lo).toBeCloseTo(10.0, 3);
    expect(initEnc.hi).toBeCloseTo(12.0, 3);

    // Final enclosure should decay: x(5) in [10 * exp(-0.5), 12 * exp(-0.5)] ~= [6.06, 7.28]
    const finalEnc = result.steps[result.steps.length - 1]!.enclosure[0]!;
    expect(finalEnc.mid).toBeLessThan(initEnc.mid);
    expect(finalEnc.lo).toBeGreaterThanOrEqual(5.0);
  });

  it("should detect safety violations when requirements are exceeded", () => {
    // dx/dt = +0.5 x (unstable)
    const A = [[0.5]];
    const initialSet = [new Interval(1.0, 2.0)];

    const result = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      tSpan: [0, 5],
      dt: 0.1,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 5.0 }],
    });

    expect(result.isCertifiedSafe).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.summary).toContain("Safety violation detected");
  });

  it("should perform Giroux order reduction on high-dimensional generator sets", () => {
    // 3D system with 12 generators
    const A = [
      [-0.1, 0, 0],
      [0, -0.2, 0],
      [0, 0, -0.3],
    ];
    const initialZ = new Zonotope(
      [1, 2, 3],
      [
        [0.1, 0, 0],
        [0, 0.1, 0],
        [0, 0, 0.1],
        [0.05, 0.05, 0],
        [0, 0.05, 0.05],
        [0.02, 0, 0.02],
        [0.01, 0.01, 0.01],
      ],
    );

    const result = ZonotopeReachabilitySolver.solve({
      A,
      initialSet: initialZ,
      tSpan: [0, 1],
      dt: 0.1,
      maxOrder: 2, // max 2 * 3 = 6 generators
    });

    expect(result.isCertifiedSafe).toBe(true);
    for (const step of result.steps.slice(1)) {
      expect(step.zonotope.generatorCount).toBeLessThanOrEqual(6);
    }
  });
});
