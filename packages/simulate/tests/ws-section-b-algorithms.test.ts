// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm, Interval, solveLgg09Reachability, verifyClosedLoopNnSystem } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulateArena } from "../src/core/simulate-arena.js";
import { lowerPde1DMolToDae } from "../src/solvers/pde-mol.js";
import { rodas5p } from "../src/solvers/rodas5p.js";
import { implicitEulerMaruyama, methodOfSteps, rock2Solve } from "../src/solvers/stiff-sde-and-rock.js";
import { ContinuousTimeEchoStateNetwork } from "../src/surrogates/ctesn.js";

describe("Section B: LGG09, CROWN NN Verification, ImplicitEM, ROCK2, MethodOfSteps, CTESN & PDE-MOL", () => {
  it("LGG09 verifies 100-dimensional coupled linear system safety via support functions", () => {
    const n = 100;
    const A: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? -2.0 : Math.abs(i - j) === 1 ? 0.4 : 0.0)),
    );
    const initBox = Array.from({ length: n }, () => new Interval(0.8, 1.0));
    const dir = new Float64Array(n);
    dir[0] = 1.0;

    const res = solveLgg09Reachability({
      A,
      initialBox: initBox,
      tEnd: 1.0,
      dt: 0.05,
      requirements: [{ direction: dir, limit: 1.15, name: "x0 <= 1.15" }],
    });

    assert.equal(res.isCertifiedSafe, true, res.summary);
    assert.equal(res.verdict.kind, "proven");
    assert.ok(res.maxSupportPerRequirement[0]! <= 1.15);
  });

  it("CROWN closed-loop NN verifier proves safety of a 2-layer ReLU stabilizing controller", () => {
    // 1D plant: x_{k+1} = 1.05 * x_k + 0.5 * u_k
    // 2-layer ReLU controller with both active neuron ReLU(x) and unstable crossing neuron ReLU(x - 0.5):
    //   u = -0.7 * ReLU(x) - 0.1 * ReLU(x - 0.5)
    const layers = [
      {
        W: [[1.0], [1.0]],
        b: [0.0, -0.5],
        activation: "relu" as const,
      },
      {
        W: [[-0.7, -0.1]],
        b: [0.0],
        activation: "linear" as const,
      },
    ];

    const res = verifyClosedLoopNnSystem({
      Ad: [[1.05]],
      Bd: [[0.5]],
      controllerLayers: layers,
      initialBox: [new Interval(0.2, 1.0)],
      horizonSteps: 10,
      safeStateBounds: [{ stateIndex: 0, min: 0.0, max: 1.05 }],
    });

    assert.equal(res.isCertifiedSafe, true, res.summary);
    assert.equal(res.verdict.kind, "proven");
    // Final box should contract well below 0.2
    const finalIv = res.reachableBoxes[res.reachableBoxes.length - 1]![0]!;
    assert.ok(
      finalIv.hi < 0.2 && finalIv.lo >= 0.0,
      `Expected contraction in [0, 0.2], got [${finalIv.lo}, ${finalIv.hi}]`,
    );
  });

  it("ImplicitEM remains strictly stable on stiff Ornstein-Uhlenbeck SDE", () => {
    // dy = -500 * y dt + 0.1 dW, dt = 0.02 (explicit Euler-Maruyama blows up since |1 - 10| = 9 > 1!)
    const res = implicitEulerMaruyama(
      (_t, y) => [-500 * y[0]!],
      () => [0.1],
      0,
      [1.0],
      0.5,
      { dt: 0.02, seed: 7 },
    );
    const yEnd = res.states[res.states.length - 1]![0]!;
    assert.ok(Number.isFinite(yEnd) && Math.abs(yEnd) < 0.05, `Expected stable decay near 0, got ${yEnd}`);
  });

  it("ROCK2 stabilized explicit RK integrates stiff 1D diffusion system without Jacobian factorizations", () => {
    // 20-node 1D heat equation with D / dx^2 = 200 -> spectral radius ≈ 800
    const N = 20;
    const dx = 1.0 / (N - 1);
    const D = 0.5;
    const f = (_t: number, y: number[]): number[] => {
      const dy = new Array<number>(N).fill(0);
      for (let i = 1; i < N - 1; i++) {
        dy[i] = (D / (dx * dx)) * (y[i - 1]! - 2 * y[i]! + y[i + 1]!);
      }
      return dy;
    };
    const y0 = Array.from({ length: N }, (_, i) => Math.sin(Math.PI * i * dx));
    const res = rock2Solve(f, 0, y0, 0.1, { dt: 0.02 });
    const midIdx = Math.floor(N / 2);
    const exactMid = Math.exp(-Math.PI * Math.PI * D * 0.1) * Math.sin(Math.PI * midIdx * dx);
    const numMid = res.states[res.states.length - 1]![midIdx]!;
    assert.ok(Math.abs(numMid - exactMid) < 0.02, `ROCK2 mid=${numMid} vs exact=${exactMid}`);
    assert.ok(res.maxStagesUsed >= 3, `Expected multi-stage Chebyshev stabilization, got s=${res.maxStagesUsed}`);
  });

  it("methodOfSteps lifts Rodas5P to solve constant-lag DDE accurately", () => {
    // dy/dt = -y(t - 1), y(t) = 1 for t <= 0
    // Exact: on [0, 1], y(t) = 1 - t => y(1) = 0
    //        on [1, 2], y(t) = - (t - 1) + 0.5*(t - 1)^2 => y(2) = -0.5
    const baseSolver = (f: (t: number, y: number[]) => number[], t0: number, y0: number[], tEnd: number) =>
      rodas5p(f, t0, y0, tEnd, undefined, { rtol: 1e-6, atol: 1e-8 });

    const res = methodOfSteps(
      baseSolver,
      (t, _y, hist) => [-hist(t - 1.0)[0]!],
      () => [1.0],
      [1.0],
      0.0,
      2.0,
    );
    const yEnd = res.states[res.states.length - 1]![0]!;
    assert.ok(Math.abs(yEnd - -0.5) < 1e-2, `MethodOfSteps(Rodas5P) y(2)=${yEnd}, expected -0.5`);
  });

  it("ContinuousTimeEchoStateNetwork learns and predicts driven dynamical response via ridge regression", () => {
    const N = 80;
    const times = Array.from({ length: N }, (_, i) => i * 0.05);
    const inputs = times.map((t) => [Math.sin(2 * t)]);
    // Target: filtered response y(t) = 0.5 * sin(2t - 0.3) + 0.1 * cos(4t)
    const targets = times.map((t) => [0.5 * Math.sin(2 * t - 0.3) + 0.1 * Math.cos(4 * t)]);

    const ctesn = new ContinuousTimeEchoStateNetwork({
      reservoirSize: 30,
      inputDim: 1,
      outputDim: 1,
      ridgeLambda: 1e-6,
    });
    const { trainRmse } = ctesn.fit(times, inputs, targets);
    assert.ok(trainRmse < 0.05, `Expected CTESN train RMSE < 0.05, got ${trainRmse}`);
    const pred = ctesn.predict(times, inputs);
    assert.equal(pred.length, N);
  });

  it("lowerPde1DMolToDae discretizes 1D heat PDE into DAEBuilder and matches analytical decay", async () => {
    await initBltWasm();
    const D = 0.1;
    const mol = lowerPde1DMolToDae({
      domain: [0, 1],
      numPoints: 11,
      diffusion: D,
      leftBc: { kind: "dirichlet", value: 0 },
      rightBc: { kind: "dirichlet", value: 0 },
      initialProfile: (x) => Math.sin(Math.PI * x),
    });

    const sim = simulateArena(mol.dae, {
      startTime: 0,
      stopTime: 0.2,
      numberOfIntervals: 20,
      solver: "rodas5p",
    });

    const midVarIdx = sim.states.indexOf("u_5");
    assert.ok(midVarIdx >= 0);
    const uMidEnd = sim.y[sim.y.length - 1]![midVarIdx]!;
    const exactMid = Math.exp(-Math.PI * Math.PI * D * 0.2); // sin(pi * 0.5) = 1
    assert.ok(Math.abs(uMidEnd - exactMid) < 0.02, `PDE-MOL u(0.5, 0.2)=${uMidEnd} vs exact ${exactMid}`);
  });
});
