// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HybridAutomaton,
  HybridFlowpipeSolver,
  HybridMode,
  HybridTransition,
  IntervalNewtonRootFinder,
} from "../src/analysis/wasm_hybrid_flowpipe.js";
import { Interval, TaylorModel } from "../src/analysis/wasm_taylor_model.js";

describe("Validated Hybrid Automata Flowpipe Reachability Suite", () => {
  it("should refine zero-crossing roots using Interval Newton method", () => {
    // Solve g(t) = t^2 - 2 = 0 on [1, 2] => root is sqrt(2) approx 1.41421356
    const evalGuard = (t: Interval) => {
      // g(t) = t^2 - 2
      const valLo = t.lo * t.lo - 2;
      const valHi = t.hi * t.hi - 2;
      // g'(t) = 2t
      const derLo = 2 * t.lo;
      const derHi = 2 * t.hi;
      return {
        value: new Interval(Math.min(valLo, valHi), Math.max(valLo, valHi)),
        deriv: new Interval(Math.min(derLo, derHi), Math.max(derLo, derHi)),
      };
    };

    const initial = new Interval(1.0, 2.0);
    const rootInterval = IntervalNewtonRootFinder.refineRoot(evalGuard, initial, 6, 1e-5);

    const sqrt2 = Math.SQRT2;
    assert(rootInterval.lo <= sqrt2, `rootInterval.lo ${rootInterval.lo} > sqrt(2)`);
    assert(rootInterval.hi >= sqrt2, `rootInterval.hi ${rootInterval.hi} < sqrt(2)`);
    assert(rootInterval.width < 1e-4, `Root interval width ${rootInterval.width} is too wide`);
  });

  it("should accurately simulate and certify bouncing ball hybrid automaton", () => {
    // Mode 1: Falling ball
    // State: y[0] = h (height), y[1] = v (velocity)
    // dh/dt = v, dv/dt = -9.81
    const fallingMode: HybridMode = {
      id: "Falling",
      name: "Ball Free Fall",
      dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
        const dh = y[1]!.clone();
        const dv = TaylorModel.constant(-9.81, y[0]!.numVars, y[0]!.domain, y[0]!.order);
        return [dh, dv];
      },
    };

    // Mode 2: Bouncing upwards
    const bouncingMode: HybridMode = {
      id: "Bouncing",
      name: "Ball Upward Flight",
      dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
        const dh = y[1]!.clone();
        const dv = TaylorModel.constant(-9.81, y[0]!.numVars, y[0]!.domain, y[0]!.order);
        return [dh, dv];
      },
    };

    // Transition: Ground impact when h <= 0 with downward velocity
    const groundImpact: HybridTransition = {
      id: "GroundImpact",
      sourceModeId: "Falling",
      targetModeId: "Bouncing",
      guard: (y: TaylorModel[]) => {
        // Guard triggers when h <= 0
        return y[0]!;
      },
      guardPoint: (pt: number[]) => pt[0]!,
      reset: (pre: Interval[]) => {
        // h^+ = 0, v^+ = -0.8 * v^-
        const postH = new Interval(0.0, 0.0);
        const postV = new Interval(-0.8 * pre[1]!.hi, -0.8 * pre[1]!.lo);
        return [postH, postV];
      },
      resetPoint: (pt: number[]) => [0.0, -0.8 * pt[1]!],
      label: "InelasticRestitution",
    };

    const automaton: HybridAutomaton = {
      modes: [fallingMode, bouncingMode],
      transitions: [groundImpact],
    };

    // Initial state: h in [0.98, 1.02], v = 0
    const initialEnclosure = [new Interval(0.98, 1.02), new Interval(-0.01, 0.01)];
    const nominalInitial = [1.0, 0.0];
    const tSpan: [number, number] = [0, 0.8];
    const dt = 0.05;

    const result = HybridFlowpipeSolver.solve({
      automaton,
      initialModeId: "Falling",
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 2,
      adaptive: true,
      tol: 1e-3,
      useQrPreconditioning: true,
      requirements: [
        {
          stateIndex: 0,
          stateName: "height",
          operator: ">=",
          limitValue: -0.05,
        },
        {
          stateIndex: 0,
          stateName: "height",
          operator: "<=",
          limitValue: 1.1,
        },
      ],
    });

    assert(result.isCertifiedSafe, `Bouncing ball safety verification failed: ${result.summary}`);
    assert(result.jumps.length >= 1, "Expected at least 1 discrete ground collision jump");

    const jump = result.jumps[0]!;
    assert.strictEqual(jump.sourceModeId, "Falling");
    assert.strictEqual(jump.targetModeId, "Bouncing");

    // Theoretical impact time for h=1.0 under g=9.81 is sqrt(2/9.81) approx 0.4515 s
    assert(Math.abs(jump.time - 0.4515) < 0.1, `Jump time ${jump.time} s differs from expected ~0.45s`);
    // Pre-impact velocity should be negative
    assert(jump.preJumpNominal[1]! < 0);
    // Post-impact velocity should be reversed positive
    assert(jump.postJumpNominal[1]! > 0);
    // Height should be reset to 0
    assert(Math.abs(jump.postJumpNominal[0]!) < 1e-6);
  });

  it("should verify thermostat hybrid mode switching within safe temperature envelope", () => {
    // Mode 1: Heating (dT/dt = 3.0 - 0.1*T)
    const heatingMode: HybridMode = {
      id: "Heating",
      name: "Heating Mode",
      dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
        const c3 = TaylorModel.constant(3.0, y[0]!.numVars, y[0]!.domain, 2);
        return [c3.add(y[0]!.scale(-0.1))];
      },
    };

    // Mode 2: Cooling (dT/dt = 1.0 - 0.1*T)
    const coolingMode: HybridMode = {
      id: "Cooling",
      name: "Cooling Mode",
      dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
        const c1 = TaylorModel.constant(1.0, y[0]!.numVars, y[0]!.domain, 2);
        return [c1.add(y[0]!.scale(-0.1))];
      },
    };

    // Transitions:
    // Heating -> Cooling when T >= 22 (i.e. 22 - T <= 0)
    const heatToCool: HybridTransition = {
      id: "HeatToCool",
      sourceModeId: "Heating",
      targetModeId: "Cooling",
      guard: (y: TaylorModel[]) => {
        const c22 = TaylorModel.constant(22.0, y[0]!.numVars, y[0]!.domain, 2);
        return c22.sub(y[0]!);
      },
      guardPoint: (pt: number[]) => 22.0 - pt[0]!,
      reset: (pre: Interval[]) => [new Interval(pre[0]!.lo, pre[0]!.hi)],
      resetPoint: (pt: number[]) => [pt[0]!],
    };

    // Cooling -> Heating when T <= 18 (i.e. T - 18 <= 0)
    const coolToHeat: HybridTransition = {
      id: "CoolToHeat",
      sourceModeId: "Cooling",
      targetModeId: "Heating",
      guard: (y: TaylorModel[]) => {
        const c18 = TaylorModel.constant(18.0, y[0]!.numVars, y[0]!.domain, 2);
        return y[0]!.sub(c18);
      },
      guardPoint: (pt: number[]) => pt[0]! - 18.0,
      reset: (pre: Interval[]) => [new Interval(pre[0]!.lo, pre[0]!.hi)],
      resetPoint: (pt: number[]) => [pt[0]!],
    };

    const automaton: HybridAutomaton = {
      modes: [heatingMode, coolingMode],
      transitions: [heatToCool, coolToHeat],
    };

    const initialEnclosure = [new Interval(19.9, 20.1)];
    const nominalInitial = [20.0];
    const tSpan: [number, number] = [0, 4.0];
    const dt = 0.1;

    const result = HybridFlowpipeSolver.solve({
      automaton,
      initialModeId: "Heating",
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 2,
      adaptive: true,
      tol: 1e-4,
      useQrPreconditioning: true,
      requirements: [
        {
          stateIndex: 0,
          stateName: "temperature",
          operator: "<=",
          limitValue: 23.0,
        },
        {
          stateIndex: 0,
          stateName: "temperature",
          operator: ">=",
          limitValue: 17.0,
        },
      ],
    });

    assert(result.isCertifiedSafe, `Thermostat verification failed: ${result.summary}`);
    assert(result.segments.length >= 2, "Expected at least 2 mode segments (Heating -> Cooling)");
    assert(result.jumps.length >= 1, "Expected at least 1 thermostat switch jump");

    // Crossing temperature should be close to 22.0
    const jump = result.jumps[0]!;
    assert(Math.abs(jump.preJumpNominal[0]! - 22.0) < 0.2);
  });

  it("should execute with adaptive order selection and constrained zonotope jump reduction", () => {
    // 2D Bouncing ball with height and velocity
    const g = 9.81;
    const modeFreeFall: HybridMode = {
      id: "FreeFall",
      name: "Ball falling under gravity",
      dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
        const h = y[0]!;
        const v = y[1]!;
        const dh = v;
        const dv = TaylorModel.constant(-g, h.numVars, h.domain, h.order);
        return [dh, dv];
      },
      invariants: [{ stateIndex: 0, min: -0.1 }],
    };

    const transitionBounce: HybridTransition = {
      id: "Bounce",
      sourceModeId: "FreeFall",
      targetModeId: "FreeFall",
      guard: (y: TaylorModel[]) => y[0]!, // crosses 0
      guardPoint: (y: number[]) => y[0]!,
      reset: (preState: Interval[]) => {
        const hPost = new Interval(0.0, 0.01);
        const vPre = preState[1]!;
        const vPost = new Interval(-0.8 * vPre.hi, -0.8 * vPre.lo);
        return [hPost, vPost];
      },
    };

    const automaton: HybridAutomaton = {
      modes: [modeFreeFall],
      transitions: [transitionBounce],
    };

    const result = HybridFlowpipeSolver.solve({
      automaton,
      initialModeId: "FreeFall",
      initialEnclosure: [new Interval(5.0, 5.0), new Interval(0.0, 0.0)],
      nominalInitial: [5.0, 0.0],
      tSpan: [0, 2.5],
      dt: 0.1,
      order: 2,
      minOrder: 1,
      maxOrder: 4,
      adaptive: true,
      tol: 1e-3,
      useConstrainedZonotopes: true,
      maxConstrainedGenerators: 4,
    });

    assert(result.totalSteps > 5, "Expected steps to be computed");
    assert(result.jumps.length >= 1, "Expected at least 1 bounce jump");
    const jump = result.jumps[0]!;
    assert(Math.abs(jump.preJumpNominal[0]!) < 0.5, "Bounce height should be near 0");
  });
});
