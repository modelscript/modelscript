// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from "expect";
import { describe, it } from "node:test";
import type { DaeSystem } from "../src/analysis/wasm_dae_flowpipe.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { Zonotope } from "../src/analysis/wasm_zonotope.js";
import {
  computeMatrixExponential,
  ConservativeLinearizationSolver,
  ZonotopeReachabilitySolver,
} from "../src/analysis/wasm_zonotope_reach.js";

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

  it("should return verdict 'proven' with float-sound continuous enclosures", () => {
    // 2D stable oscillator with damping: A = [[0, 1], [-2, -1]]
    const A = [
      [0, 1],
      [-2, -1],
    ];
    const initialSet = [new Interval(0.9, 1.1), new Interval(-0.1, 0.1)];

    const result = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      tSpan: [0, 2.0],
      dt: 0.05,
      requirements: [
        { stateIndex: 0, operator: "<=", limitValue: 2.0 },
        { stateIndex: 0, operator: ">=", limitValue: -2.0 },
      ],
    });

    expect(result.isCertifiedSafe).toBe(true);
    expect(result.verdict.kind).toBe("proven");
    if (result.verdict.kind === "proven") {
      expect(result.verdict.rigor).toBe("float-sound");
    }
    expect(result.continuousEnclosures).toBeDefined();
    expect(result.continuousEnclosures!.length).toBeGreaterThan(0);
  });

  it("should return verdict 'unknown' when enclosure crosses boundary but nominal stays safe", () => {
    // 1D decay: dx/dt = -0.1 x, x(0) in [10, 12], nominal = 11.
    // At t=0, interval reaches 12.0. Requirement: x <= 11.5.
    // Nominal is 11.0 <= 11.5 (safe!), but upper bound 12.0 > 11.5 (crosses!).
    const A = [[-0.1]];
    const initialSet = [new Interval(10.0, 12.0)];

    const result = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      nominalInitial: [11.0],
      tSpan: [0, 1.0],
      dt: 0.1,
      enableFalsification: false,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 11.5 }],
    });

    expect(result.isCertifiedSafe).toBe(false);
    expect(result.verdict.kind).toBe("unknown");
    if (result.verdict.kind === "unknown") {
      expect(result.verdict.reason).toBe("inconclusive-enclosure");
    }
    // Crossings recorded, but no concrete witness
    expect(result.violations.some((v) => v.isConcreteWitness)).toBe(false);
  });

  it("should return verdict 'violated' when boundary falsification finds witness even if nominal stays safe", () => {
    // 1D decay: dx/dt = -0.1 x, x(0) in [10, 12], nominal = 11.
    // Requirement: x <= 11.5. Nominal is 11.0 <= 11.5 (safe),
    // but boundary vertex x0 = 12.0 violates x <= 11.5. Falsification finds this witness!
    const A = [[-0.1]];
    const initialSet = [new Interval(10.0, 12.0)];

    const result = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      nominalInitial: [11.0],
      tSpan: [0, 1.0],
      dt: 0.1,
      enableFalsification: true,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 11.5 }],
    });

    expect(result.isCertifiedSafe).toBe(false);
    expect(result.verdict.kind).toBe("violated");
    expect(result.violations.some((v) => v.isConcreteWitness)).toBe(true);
  });

  it("should return verdict 'violated' when concrete nominal witness breaches requirement", () => {
    // 1D decay: dx/dt = -0.1 x, x(0) in [10, 12], nominal = 11.
    // Requirement: x <= 8.0. Nominal is 11.0 > 8.0 -> concrete breach!
    const A = [[-0.1]];
    const initialSet = [new Interval(10.0, 12.0)];

    const result = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      nominalInitial: [11.0],
      tSpan: [0, 1.0],
      dt: 0.1,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 8.0 }],
    });

    expect(result.isCertifiedSafe).toBe(false);
    expect(result.verdict.kind).toBe("violated");
    if (result.verdict.kind === "violated") {
      expect(result.verdict.witness).toBeDefined();
    }
    expect(result.violations.some((v) => v.isConcreteWitness)).toBe(true);
  });

  it("should scale truncation error with large state norm (D9 fix)", () => {
    // Large state system x_0 = 1e6
    const A = [[-0.01]];
    const initialSet = [new Interval(1e6 - 10, 1e6 + 10)];

    const result = ZonotopeReachabilitySolver.solve({
      A,
      initialSet,
      tSpan: [0, 0.2],
      dt: 0.1,
    });

    expect(result.isCertifiedSafe).toBe(true);
    expect(result.steps.length).toBe(3);
    // Upper bound after step 1 should decay: x(0.1) ~= 1e6 * exp(-0.001) < 1e6
    const enc1 = result.steps[1]!.enclosure[0]!;
    expect(enc1.hi).toBeLessThan(1e6 + 10);
  });

  it("should soundly integrate continuous input set via Psi(A, dt) * B * U", () => {
    // dx/dt = -x + u, u in [-0.5, 0.5], x(0) = 0
    const A = [[-1.0]];
    const B = [[1.0]];
    const U = new Zonotope([0.0], [[0.5]]);
    const initialSet = [new Interval(0, 0)];

    const result = ZonotopeReachabilitySolver.solve({
      A,
      B,
      U,
      initialSet,
      tSpan: [0, 1.0],
      dt: 0.1,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 0.6 }],
    });

    expect(result.isCertifiedSafe).toBe(true);
    expect(result.verdict.kind).toBe("proven");
    const finalEnc = result.steps[result.steps.length - 1]!.enclosure[0]!;
    // Steady state bound for u in [-0.5, 0.5] is [-0.5, 0.5]
    expect(finalEnc.hi).toBeLessThanOrEqual(0.6);
    expect(finalEnc.lo).toBeGreaterThanOrEqual(-0.6);
  });
});

describe("Zonotope reachability Monte-Carlo soundness oracle", () => {
  it("every sampled trajectory (fine RK4, random x0 and piecewise-constant u) stays inside the tube", () => {
    const A = [
      [0, 1],
      [-4, -0.3],
    ];
    const B = [[0], [1]];
    const U = new Zonotope([0], [[0.4]]);
    const init = [new Interval(0.8, 1.2), new Interval(-0.2, 0.2)];
    const dt = 0.1;
    const T = 3;
    const res = ZonotopeReachabilitySolver.solve({ A, B, U, initialSet: init, tSpan: [0, T], dt });
    const tube = res.continuousEnclosures!;
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const f = (x: number[], u: number) => [x[1]!, -4 * x[0]! - 0.3 * x[1]! + u];
    for (let trial = 0; trial < 200; trial++) {
      let x = [0.8 + 0.4 * rnd(), -0.2 + 0.4 * rnd()];
      const h = dt / 20;
      for (const stepEnclosure of tube) {
        const u = (rnd() * 2 - 1) * 0.4;
        for (let s = 0; s <= 20; s++) {
          for (let i = 0; i < 2; i++) {
            expect(x[i]!).toBeGreaterThanOrEqual(stepEnclosure[i]!.lo - 1e-9);
            expect(x[i]!).toBeLessThanOrEqual(stepEnclosure[i]!.hi + 1e-9);
          }
          if (s === 20) break;
          const k1 = f(x, u);
          const k2 = f([x[0]! + (h / 2) * k1[0]!, x[1]! + (h / 2) * k1[1]!], u);
          const k3 = f([x[0]! + (h / 2) * k2[0]!, x[1]! + (h / 2) * k2[1]!], u);
          const k4 = f([x[0]! + h * k3[0]!, x[1]! + h * k3[1]!], u);
          x = [
            x[0]! + (h / 6) * (k1[0]! + 2 * k2[0]! + 2 * k3[0]! + k4[0]!),
            x[1]! + (h / 6) * (k1[1]! + 2 * k2[1]! + 2 * k3[1]! + k4[1]!),
          ];
        }
      }
    }
  });
});

describe("ConservativeLinearizationSolver (Althoff 2008 Nonlinear Zonotopes)", () => {
  // Nonlinear damped pendulum:
  // dx1/dt = x2
  // dx2/dt = -sin(x1) - 0.2*x2
  const pendulumDae: DaeSystem = {
    numDiffStates: 2,
    numAlgStates: 0,
    f: (_t, x) => [x[1]!, -Math.sin(x[0]!) - 0.2 * x[1]!],
    g: () => [],
    jacobianGz: () => [],
    jacobianFx: (_t, x) => [
      [0, 1],
      [-Math.cos(x[0]!), -0.2],
    ],
    jacobianFxInterval: (_t, x) => {
      // Over x1 \in [lo, hi], cos(x1) is enclosed by [min(cos), max(cos)]
      const x1 = x[0]!;
      const cLo = Math.cos(x1.lo);
      const cHi = Math.cos(x1.hi);
      let minC = Math.min(cLo, cHi);
      let maxC = Math.max(cLo, cHi);
      if (x1.lo <= 0 && x1.hi >= 0) maxC = 1.0;
      if (x1.lo <= Math.PI && x1.hi >= Math.PI) minC = -1.0;
      return [
        [new Interval(0, 0), new Interval(1, 1)],
        [new Interval(-maxC, -minC), new Interval(-0.2, -0.2)],
      ];
    },
  };

  it("should prove safety on nonlinear pendulum with continuous curvature bounds", () => {
    const init = [new Interval(0.5, 0.6), new Interval(0.0, 0.1)];
    const res = ConservativeLinearizationSolver.solve({
      dae: pendulumDae,
      initialSet: init,
      tSpan: [0, 1.0],
      dt: 0.05,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 1.5 }],
    });

    expect(res.isCertifiedSafe).toBe(true);
    expect(res.verdict.kind).toBe("proven");
    expect(res.continuousEnclosures.length).toBeGreaterThanOrEqual(19);

    // Monte-Carlo soundness oracle: 100 sample trajectories with fine RK4 stay within continuous tube
    let seed = 54321;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let trial = 0; trial < 100; trial++) {
      let x = [0.5 + 0.1 * rnd(), 0.0 + 0.1 * rnd()];
      const dt = 0.05;
      const h = dt / 10;
      for (const stepEnclosure of res.continuousEnclosures) {
        for (let s = 0; s <= 10; s++) {
          for (let i = 0; i < 2; i++) {
            expect(x[i]!).toBeGreaterThanOrEqual(stepEnclosure[i]!.lo - 1e-6);
            expect(x[i]!).toBeLessThanOrEqual(stepEnclosure[i]!.hi + 1e-6);
          }
          if (s === 10) break;
          const k1 = pendulumDae.f(0, x, []);
          const k2 = pendulumDae.f(0, [x[0]! + (h / 2) * k1[0]!, x[1]! + (h / 2) * k1[1]!], []);
          const k3 = pendulumDae.f(0, [x[0]! + (h / 2) * k2[0]!, x[1]! + (h / 2) * k2[1]!], []);
          const k4 = pendulumDae.f(0, [x[0]! + h * k3[0]!, x[1]! + h * k3[1]!], []);
          x = [
            x[0]! + (h / 6) * (k1[0]! + 2 * k2[0]! + 2 * k3[0]! + k4[0]!),
            x[1]! + (h / 6) * (k1[1]! + 2 * k2[1]! + 2 * k3[1]! + k4[1]!),
          ];
        }
      }
    }
  });

  it("should detect concrete witness violation when nominal trajectory exceeds threshold", () => {
    const init = [new Interval(0.5, 0.6), new Interval(1.0, 1.2)];
    const res = ConservativeLinearizationSolver.solve({
      dae: pendulumDae,
      initialSet: init,
      tSpan: [0, 1.0],
      dt: 0.05,
      requirements: [{ stateIndex: 0, operator: "<=", limitValue: 0.7 }],
    });

    expect(res.isCertifiedSafe).toBe(false);
    expect(res.verdict.kind).toBe("violated");
    expect(res.violations.some((v) => v.isConcreteWitness)).toBe(true);
  });

  it("should respect keystroke budget discipline and exit unknown(budget) when timeout exceeded", () => {
    const init = [new Interval(0.5, 0.6), new Interval(0.0, 0.1)];
    const res = ConservativeLinearizationSolver.solve({
      dae: pendulumDae,
      initialSet: init,
      tSpan: [0, 5.0],
      dt: 0.001, // 5000 fine steps
      budgetMs: 0.001, // immediate budget expiration
    });

    expect(res.verdict.kind).toBe("unknown");
    if (res.verdict.kind === "unknown") {
      expect(res.verdict.reason).toBe("budget");
    }
  });
});
