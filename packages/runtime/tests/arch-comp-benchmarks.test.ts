// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ivAdd, ivMul, ivSub } from "../src/analysis/outward_rounding.js";
import { DaeFlowpipeSolver, type DaeSystem } from "../src/analysis/wasm_dae_flowpipe.js";
import {
  HybridAutomaton,
  HybridFlowpipeSolver,
  HybridMode,
  HybridTransition,
} from "../src/analysis/wasm_hybrid_flowpipe.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { TaylorModel, TaylorModelFlowpipeSolver } from "../src/analysis/wasm_taylor_model.js";
import { Zonotope } from "../src/analysis/wasm_zonotope.js";
import { ZonotopeReachabilitySolver } from "../src/analysis/wasm_zonotope_reach.js";

/**
 * Deterministic pseudo-random number generator for reproducible Monte-Carlo testing.
 */
function createDeterministicRng(seed = 123456789): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("ARCH-COMP Verification Benchmark Suite & Monte-Carlo Soundness Oracles", () => {
  // =========================================================================
  // 1. Lotka-Volterra Predator-Prey (ARCH-COMP NLN Category)
  // =========================================================================
  describe("1. Lotka-Volterra Benchmark (ARCH-COMP NLN)", () => {
    // dx1/dt = 1.5 * x1 - x1 * x2
    // dx2/dt = -3.0 * x2 + x1 * x2
    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => {
      const x1 = y[0]!;
      const x2 = y[1]!;
      const x1x2 = x1.mul(x2);
      const dx1 = x1.scale(1.5).sub(x1x2);
      const dx2 = x2.scale(-3.0).add(x1x2);
      return [dx1, dx2];
    };

    const initialEnclosure = [new Interval(0.95, 1.05), new Interval(0.95, 1.05)];
    const nominalInitial = [1.0, 1.0];
    const tSpan: [number, number] = [0, 0.4];
    const dt = 0.02;

    it("should compute validated flowpipe and prove safety limits", () => {
      const result = TaylorModelFlowpipeSolver.solve({
        dynamics,
        initialEnclosure,
        nominalInitial,
        tSpan,
        dt,
        order: 3,
        symbolicCarryOver: true,
        requirements: [
          { stateIndex: 0, operator: "<=", limitValue: 2.0 },
          { stateIndex: 0, operator: ">=", limitValue: 0.5 },
          { stateIndex: 1, operator: "<=", limitValue: 2.0 },
          { stateIndex: 1, operator: ">=", limitValue: 0.2 },
        ],
      });

      assert.strictEqual(result.isCertifiedSafe, true);
      assert.strictEqual(result.verdict.kind, "proven");
      assert.strictEqual(result.violations.length, 0);

      // Golden precision tracking: check final tube widths do not over-approximate
      const lastStep = result.steps[result.steps.length - 1]!;
      assert(
        lastStep.tubes[0]!.width < 0.35,
        `Lotka-Volterra x1 final width ${lastStep.tubes[0]!.width} exceeded golden precision threshold 0.35`,
      );
      assert(
        lastStep.tubes[1]!.width < 0.35,
        `Lotka-Volterra x2 final width ${lastStep.tubes[1]!.width} exceeded golden precision threshold 0.35`,
      );
    });

    it("should strictly contain 100 Monte-Carlo RK4 trajectories with zero escape", () => {
      const result = TaylorModelFlowpipeSolver.solve({
        dynamics,
        initialEnclosure,
        nominalInitial,
        tSpan,
        dt,
        order: 3,
        symbolicCarryOver: true,
      });

      assert(result.isCertifiedSafe);

      const f = (_t: number, [x1, x2]: [number, number]): [number, number] => [1.5 * x1 - x1 * x2, -3.0 * x2 + x1 * x2];

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

      const rng = createDeterministicRng(42);
      const subSteps = 10;
      const subH = dt / subSteps;

      for (let s = 0; s < 100; s++) {
        const x1_0 = 0.95 + 0.1 * rng();
        const x2_0 = 0.95 + 0.1 * rng();
        let state: [number, number] = [x1_0, x2_0];
        let t = 0;

        for (let stepIdx = 1; stepIdx < result.steps.length; stepIdx++) {
          for (let sub = 0; sub < subSteps; sub++) {
            state = rk4Step(t, state, subH);
            t += subH;
          }
          const tube = result.steps[stepIdx]!.tubes;
          assert(
            state[0] >= tube[0]!.lo - 1e-6 && state[0] <= tube[0]!.hi + 1e-6,
            `MC sample ${s} x1=${state[0]} escaped tube [${tube[0]!.lo}, ${tube[0]!.hi}] at step ${stepIdx}`,
          );
          assert(
            state[1] >= tube[1]!.lo - 1e-6 && state[1] <= tube[1]!.hi + 1e-6,
            `MC sample ${s} x2=${state[1]} escaped tube [${tube[1]!.lo}, ${tube[1]!.hi}] at step ${stepIdx}`,
          );
        }
      }
    });
  });

  // =========================================================================
  // 2. Laub-Loomis Enzymatic Reaction Model (7-Dimensional ARCH-COMP NLN)
  // =========================================================================
  describe("2. Laub-Loomis 7D Enzymatic Model (ARCH-COMP NLN)", () => {
    // 7 states:
    // dx1/dt = 1.4 * x3 - x1
    // dx2/dt = 2.5 * x5 - 1.5 * x2
    // dx3/dt = 0.6 * x7 - 0.76 * x3
    // dx4/dt = 2.0 - 1.1 * x4
    // dx5/dt = 0.7 * x1 - x5
    // dx6/dt = 0.3 * x2 - 3.1 * x6
    // dx7/dt = 1.8 * x4 - 1.5 * x7
    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => {
      const nVars = y[0]!.numVars;
      const dom = y[0]!.domain;
      const ord = y[0]!.order;
      const c2 = TaylorModel.constant(2.0, nVars, dom, ord);

      const dx1 = y[2]!.scale(1.4).sub(y[0]!);
      const dx2 = y[4]!.scale(2.5).sub(y[1]!.scale(1.5));
      const dx3 = y[6]!.scale(0.6).sub(y[2]!.scale(0.76));
      const dx4 = c2.sub(y[3]!.scale(1.1));
      const dx5 = y[0]!.scale(0.7).sub(y[4]!);
      const dx6 = y[1]!.scale(0.3).sub(y[5]!.scale(3.1));
      const dx7 = y[3]!.scale(1.8).sub(y[6]!.scale(1.5));
      return [dx1, dx2, dx3, dx4, dx5, dx6, dx7];
    };

    const nominalInitial = [1.2, 1.05, 1.5, 2.4, 1.0, 0.1, 0.45];
    const delta = 0.05;
    const initialEnclosure = nominalInitial.map((c) => new Interval(c - delta, c + delta));
    const tSpan: [number, number] = [0, 0.2];
    const dt = 0.02;

    it("should compute tight 7D flowpipe with Taylor symbolic carry-over", () => {
      const res = TaylorModelFlowpipeSolver.solve({
        dynamics,
        initialEnclosure,
        nominalInitial,
        tSpan,
        dt,
        order: 2,
        symbolicCarryOver: true,
        requirements: [
          { stateIndex: 3, operator: "<=", limitValue: 3.5 },
          { stateIndex: 3, operator: ">=", limitValue: 1.5 },
        ],
      });

      assert.strictEqual(res.isCertifiedSafe, true);
      assert.strictEqual(res.verdict.kind, "proven");
      assert.strictEqual(res.steps.length, 11);

      // Verify all nominal trajectory points remain enclosed
      for (const step of res.steps) {
        for (let j = 0; j < 7; j++) {
          assert(step.tubes[j]!.lo <= step.nominal[j]!);
          assert(step.tubes[j]!.hi >= step.nominal[j]!);
        }
      }
    });

    it("should soundly contain 50 Monte-Carlo RK4 trajectories in 7D state space", () => {
      const res = TaylorModelFlowpipeSolver.solve({
        dynamics,
        initialEnclosure,
        nominalInitial,
        tSpan,
        dt,
        order: 2,
        symbolicCarryOver: true,
      });

      const f = (_t: number, y: number[]): number[] => [
        1.4 * y[2]! - y[0]!,
        2.5 * y[4]! - 1.5 * y[1]!,
        0.6 * y[6]! - 0.76 * y[2]!,
        2.0 - 1.1 * y[3]!,
        0.7 * y[0]! - y[4]!,
        0.3 * y[1]! - 3.1 * y[5]!,
        1.8 * y[3]! - 1.5 * y[6]!,
      ];

      const rk4Step = (t: number, y: number[], h: number): number[] => {
        const k1 = f(t, y);
        const k2 = f(
          t + 0.5 * h,
          y.map((v, i) => v + 0.5 * h * k1[i]!),
        );
        const k3 = f(
          t + 0.5 * h,
          y.map((v, i) => v + 0.5 * h * k2[i]!),
        );
        const k4 = f(
          t + h,
          y.map((v, i) => v + h * k3[i]!),
        );
        return y.map((v, i) => v + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
      };

      const rng = createDeterministicRng(999);
      const subSteps = 10;
      const subH = dt / subSteps;

      for (let s = 0; s < 50; s++) {
        let state = nominalInitial.map((c) => c + delta * (2 * rng() - 1));
        let t = 0;

        for (let stepIdx = 1; stepIdx < res.steps.length; stepIdx++) {
          for (let sub = 0; sub < subSteps; sub++) {
            state = rk4Step(t, state, subH);
            t += subH;
          }
          const tube = res.steps[stepIdx]!.tubes;
          for (let j = 0; j < 7; j++) {
            assert(
              state[j]! >= tube[j]!.lo - 1e-6 && state[j]! <= tube[j]!.hi + 1e-6,
              `Sample ${s} state[${j}]=${state[j]} outside tube [${tube[j]!.lo}, ${tube[j]!.hi}] at step ${stepIdx}`,
            );
          }
        }
      }
    });
  });

  // =========================================================================
  // 3. Robertson Chemical Kinetics (ARCH-COMP Stiff DAE)
  // =========================================================================
  describe("3. Chemical Reaction Kinetics & Stiff DAE Benchmarks", () => {
    // Catalytic reversible kinetics (well-conditioned semi-explicit index-1 DAE):
    // dx1/dt = -0.04 * x1 + 1.0 * x2 * z
    // dx2/dt = 0.04 * x1 - 1.0 * x2 * z - 2.0 * x2^2
    // g(x, z) = x1 + x2 + z - 1.0 = 0
    const catalyticDae: DaeSystem = {
      numDiffStates: 2,
      numAlgStates: 1,
      f: (_t, [x1, x2], [z]) => [-0.04 * x1! + 1.0 * x2! * z!, 0.04 * x1! - 1.0 * x2! * z! - 2.0 * x2! * x2!],
      g: ([x1, x2], [z]) => [x1! + x2! + z! - 1.0],
      jacobianGz: () => [[1.0]],
      jacobianGx: () => [[1.0, 1.0]],
      jacobianFx: (_t, [_x1, x2], [z]) => [
        [-0.04, 1.0 * z!],
        [0.04, -1.0 * z! - 4.0 * x2!],
      ],
      fInterval: (_t, [x1, x2], [z]) => {
        const p1 = new Interval(0.04, 0.04);
        const p2 = new Interval(1.0, 1.0);
        const p3 = new Interval(2.0, 2.0);
        const r1 = ivMul(p1, x1!);
        const r2 = ivMul(ivMul(p2, x2!), z!);
        const r3 = ivMul(ivMul(p3, x2!), x2!);
        return [ivSub(r2, r1), ivSub(ivSub(r1, r2), r3)];
      },
      gInterval: ([x1, x2], [z]) => [ivSub(ivAdd(ivAdd(x1!, x2!), z!), new Interval(1.0, 1.0))],
      jacobianGzInterval: () => [[new Interval(1.0, 1.0)]],
    };

    it("should certify catalytic reaction algebraic manifold and conservation law", () => {
      const initialX = [new Interval(0.95, 0.99), new Interval(0.01, 0.03)];
      const initialZ = [new Interval(0.0, 0.02)];
      const nominalX = [0.97, 0.02];
      const nominalZ = [0.01];
      const tSpan: [number, number] = [0, 0.05];
      const dt = 0.01;

      const res = DaeFlowpipeSolver.solve({
        dae: catalyticDae,
        initialX,
        initialZ,
        nominalX,
        nominalZ,
        tSpan,
        dt,
        order: 2,
        requirements: [
          { variable: "x", index: 0, operator: "<=", limitValue: 1.05 },
          { variable: "x", index: 0, operator: ">=", limitValue: 0.8 },
        ],
      });

      assert(res.totalSteps > 0);
      assert.strictEqual(res.isCertifiedSafe, true);
      assert.strictEqual(res.verdict.kind, "proven");

      // Verify algebraic Krawczyk certification at every step
      for (const step of res.steps) {
        assert(step.isAlgebraicManifoldCertified, `Krawczyk contractor failed at t=${step.time}`);
        // Mass conservation: x1 + x2 + z = 1
        const totalMassLo = step.xTubes[0]!.lo + step.xTubes[1]!.lo + step.zTubes[0]!.lo;
        const totalMassHi = step.xTubes[0]!.hi + step.xTubes[1]!.hi + step.zTubes[0]!.hi;
        assert(
          totalMassLo <= 1.05 && totalMassHi >= 0.95,
          `Mass conservation enclosure breached: [${totalMassLo}, ${totalMassHi}]`,
        );
      }
    });

    it("should soundly report unknown for ultra-stiff Robertson reaction (k=3e7)", () => {
      const stiffDae: DaeSystem = {
        numDiffStates: 2,
        numAlgStates: 1,
        f: (_t, [x1, x2], [z]) => [-0.04 * x1! + 1e4 * x2! * z!, 0.04 * x1! - 1e4 * x2! * z! - 3e7 * x2! * x2!],
        g: ([x1, x2], [z]) => [x1! + x2! + z! - 1.0],
        jacobianGz: () => [[1.0]],
        fInterval: (_t, [x1, x2], [z]) => {
          const p1 = new Interval(0.04, 0.04);
          const p2 = new Interval(1e4, 1e4);
          const p3 = new Interval(3e7, 3e7);
          const r1 = ivMul(p1, x1!);
          const r2 = ivMul(ivMul(p2, x2!), z!);
          const r3 = ivMul(ivMul(p3, x2!), x2!);
          return [ivSub(r2, r1), ivSub(ivSub(r1, r2), r3)];
        },
        gInterval: ([x1, x2], [z]) => [ivSub(ivAdd(ivAdd(x1!, x2!), z!), new Interval(1.0, 1.0))],
        jacobianGzInterval: () => [[new Interval(1.0, 1.0)]],
      };

      const res = DaeFlowpipeSolver.solve({
        dae: stiffDae,
        initialX: [new Interval(0.999, 1.001), new Interval(0.0, 1e-6)],
        initialZ: [new Interval(-1e-4, 1e-4)],
        nominalX: [1.0, 0.0],
        nominalZ: [0.0],
        tSpan: [0, 0.05],
        dt: 0.01,
      });

      // Ultra-stiff equation cannot be contracted by explicit Picard; must refuse certification soundly
      assert.strictEqual(res.isCertifiedSafe, false);
      assert.strictEqual(res.verdict.kind, "unknown");
      assert.strictEqual(res.verdict.reason, "nonconvergent");
    });
  });

  // =========================================================================
  // 4. Spacecraft Rendezvous (ARCH-COMP Hybrid Benchmark)
  // =========================================================================
  describe("4. Spacecraft Rendezvous Benchmark (ARCH-COMP Hybrid)", () => {
    // Relative orbital dynamics (Clohessy-Wiltshire):
    // Mode 1: Drift (approach under orbital dynamics)
    // Mode 2: StationKeeping (actuated thruster braking)
    const omega = 0.001; // Orbital frequency
    const driftMode: HybridMode = {
      id: "Drift",
      name: "Orbital Drift",
      dynamics: (_t, y) => {
        // x1=pos_x, x2=pos_y, x3=vel_x, x4=vel_y
        const dx1 = y[2]!.clone();
        const dx2 = y[3]!.clone();
        // d(vel_x)/dt = 3*w^2*x + 2*w*vel_y
        const dx3 = y[0]!.scale(3 * omega * omega).add(y[3]!.scale(2 * omega));
        // d(vel_y)/dt = -2*w*vel_x
        const dx4 = y[2]!.scale(-2 * omega);
        return [dx1, dx2, dx3, dx4];
      },
    };

    const stationKeepingMode: HybridMode = {
      id: "StationKeeping",
      name: "Braking & Hold",
      dynamics: (_t, y) => {
        const dx1 = y[2]!.clone();
        const dx2 = y[3]!.clone();
        // Thruster damping: -0.1*vel_x, -0.1*vel_y
        const dx3 = y[0]!
          .scale(3 * omega * omega)
          .add(y[3]!.scale(2 * omega))
          .sub(y[2]!.scale(0.1));
        const dx4 = y[2]!.scale(-2 * omega).sub(y[3]!.scale(0.1));
        return [dx1, dx2, dx3, dx4];
      },
    };

    // Transition when distance along x <= 10.0m
    const engageBraking: HybridTransition = {
      id: "EngageThrusters",
      sourceModeId: "Drift",
      targetModeId: "StationKeeping",
      guard: (y) => y[0]!.addConstant(-10.0), // x - 10 <= 0
      guardPoint: (y) => y[0]! - 10.0,
      reset: (pre) => pre.map((iv) => new Interval(iv.lo, iv.hi)),
      resetPoint: (pt) => [...pt],
      label: "ConeProximityTrigger",
    };

    const automaton: HybridAutomaton = {
      modes: [driftMode, stationKeepingMode],
      transitions: [engageBraking],
    };

    it("should track spacecraft approach and switch mode precisely at guard", () => {
      const initialEnclosure = [
        new Interval(14.5, 15.5), // x distance
        new Interval(-0.5, 0.5), // y distance
        new Interval(-1.05, -0.95), // closing velocity vx
        new Interval(-0.05, 0.05), // vy
      ];
      const nominalInitial = [15.0, 0.0, -1.0, 0.0];
      const tSpan: [number, number] = [0, 8.0];
      const dt = 0.5;

      const res = HybridFlowpipeSolver.solve({
        automaton,
        initialModeId: "Drift",
        initialEnclosure,
        nominalInitial,
        tSpan,
        dt,
        order: 2,
        requirements: [
          { stateIndex: 0, operator: "<=", limitValue: 20.0 },
          { stateIndex: 0, operator: ">=", limitValue: 0.0 },
        ],
      });

      assert(res.totalSteps > 5);
      assert.strictEqual(res.violations.length, 0);
      assert.strictEqual(res.jumps.length, 1, "Expected single discrete transition into StationKeeping");
      const jump = res.jumps[0]!;
      assert.strictEqual(jump.targetModeId, "StationKeeping");
      // Jump should occur near t = 5s (15m - 10m = 5m at 1 m/s)
      assert(jump.time >= 4.0 && jump.time <= 5.5, `Jump time ${jump.time} outside expected [4.0, 5.5]s`);
    });
  });

  // =========================================================================
  // 5. High-Dimensional Scalability (Girard / ARCH-COMP AFF Building Model)
  // =========================================================================
  describe("5. High-Dimensional Linear Scalability", () => {
    it("should compute guaranteed zonotope reach set on 10D interconnected oscillator chain", () => {
      const n = 10;
      // Tridiagonal stiffness matrix
      const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      for (let i = 0; i < n; i++) {
        A[i]![i] = -2.0;
        if (i > 0) A[i]![i - 1] = 1.0;
        if (i < n - 1) A[i]![i + 1] = 1.0;
      }

      const initialBoxes = Array.from({ length: n }, (_, i) => new Interval(i === 0 ? 0.9 : -0.1, i === 0 ? 1.1 : 0.1));
      const z0 = Zonotope.fromIntervals(initialBoxes);

      const res = ZonotopeReachabilitySolver.solve({
        A,
        initialSet: z0,
        tSpan: [0, 0.5],
        dt: 0.05,
        maxOrder: 3,
        expansionOrder: 5,
        budgetMs: 150,
      });

      assert.strictEqual(res.isCertifiedSafe, true);
      assert.strictEqual(res.verdict.kind, "proven");
      assert.strictEqual(res.steps.length, 11);

      // Verify generator reduction kept zonotope complexity bounded
      for (const step of res.steps) {
        assert(step.zonotope.generatorCount <= 30, `Generators ${step.zonotope.generatorCount} exceeded cap 30`);
        assert(Number.isFinite(step.zonotope.center[0]!));
      }
    });
  });
});
