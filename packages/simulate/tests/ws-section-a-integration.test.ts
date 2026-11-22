// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  DAEBuilder,
  diagnoseInitializationSystem,
  EqKind,
  extractPolynomialSystemFromArena,
  initBltWasm,
  SosBarrierSynthesizer,
  Variability,
  VarType,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { samplePosteriorNuts } from "../src/calibration/bayesian_calibrator.js";
import { synthesizeHinfOutputFeedback } from "../src/control/hinf-synthesis.js";
import { createArenaRtiNmpc } from "../src/control/nmpc.js";
import { solveDaeAdjoint } from "../src/core/dae-adjoint-solver.js";
import { DenseHermiteCheckpointTape } from "../src/core/dense-checkpoint-tape.js";
import { ArenaSimulator, simulateArena } from "../src/core/simulate-arena.js";

describe("Section A End-to-End Integration & Remaining Top-5 Items", () => {
  it("extractPolynomialSystemFromArena lowers DAEBuilder and certifies SOS barrier rigorously", () => {
    // der(x) = -2*x - x^3
    const dae = new DAEBuilder();
    dae.addVariable("x", VarType.Real, Variability.Continuous, 0, 0.5);
    const xRef = dae.addNameExpr("x");
    const neg2x = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-2.0), xRef);
    const x3 = dae.addBinaryExpr(BinOp.Pow, xRef, dae.addRealLiteral(3.0));
    const rhs = dae.addBinaryExpr(BinOp.Sub, neg2x, x3);
    dae.addEquation(EqKind.Simple, dae.addDerExpr(xRef), rhs);

    const polySys = extractPolynomialSystemFromArena(dae);
    assert.ok(polySys !== null);
    assert.equal(polySys.numVars, 1);

    const cert = SosBarrierSynthesizer.synthesizePolynomialCertified(polySys, {
      initialRadius: 0.5,
      unsafeRadius: 1.5,
    });
    assert.equal(cert.isCertifiedSafe, true);
    assert.equal(cert.verdict.kind, "proven");
  });

  it("simulateArena dispatches end-to-end to rodas5p and auto-composite integrators", async () => {
    await initBltWasm();
    const dae = new DAEBuilder();
    const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
    dae.setVarStartValue(xIdx, 1.0);
    const xRef = dae.addNameExpr("x");
    dae.addEquation(EqKind.Simple, dae.addDerExpr(xRef), dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-2.0), xRef));

    const res5p = simulateArena(dae, { startTime: 0, stopTime: 1.0, numberOfIntervals: 20, solver: "rodas5p" });
    const xEnd5p = res5p.y[res5p.y.length - 1]![0]!;
    assert.ok(Math.abs(xEnd5p - Math.exp(-2)) < 1e-4, `Rodas5P end=${xEnd5p}, expected ${Math.exp(-2)}`);

    const resAuto = simulateArena(dae, {
      startTime: 0,
      stopTime: 1.0,
      numberOfIntervals: 20,
      solver: "auto-composite",
    });
    const xEndAuto = resAuto.y[resAuto.y.length - 1]![0]!;
    assert.ok(Math.abs(xEndAuto - Math.exp(-2)) < 1e-4, `AutoComposite end=${xEndAuto}, expected ${Math.exp(-2)}`);
  });

  it("DenseHermiteCheckpointTape enforces Revolve maxCheckpoints and 2-pt Gauss-Legendre adjoint matches exact gradient", async () => {
    await initBltWasm();
    const tape = new DenseHermiteCheckpointTape(["x"], [], 16, 12);
    for (let i = 0; i < 40; i++) {
      tape.pushSegment(i * 0.1, (i + 1) * 0.1, [i], [i + 1], [10], [10]);
    }
    assert.ok(
      tape.getStats().segmentCount <= 12,
      `Expected <= 12 compressed checkpoints, got ${tape.getStats().segmentCount}`,
    );
    assert.ok(Math.abs(tape.getStats().startTime - 0) < 1e-12);
    assert.ok(Math.abs(tape.getStats().stopTime - 4.0) < 1e-12);

    const dae = new DAEBuilder();
    const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
    dae.setVarStartValue(xIdx, 1.0);
    dae.addVariable("k", VarType.Real, Variability.Parameter, 0, 2.0);
    const xRef = dae.addNameExpr("x");
    const kRef = dae.addNameExpr("k");
    dae.addEquation(
      EqKind.Simple,
      dae.addDerExpr(xRef),
      dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), dae.addBinaryExpr(BinOp.Mul, kRef, xRef)),
    );

    const T = 0.5;
    const exact = -T * Math.exp(-2 * 2.0 * T);
    const adjRes = solveDaeAdjoint(dae, {
      startTime: 0,
      stopTime: T,
      numberOfIntervals: 40,
      forwardIntegrator: "rodas5p",
      adjointMethod: "quadrature",
      maxCheckpoints: 24,
      parametersToDifferentiate: ["k"],
      terminalLoss: (s) => {
        const xT = s.get("x") ?? 0;
        return { loss: 0.5 * xT * xT, gradState: new Map([["x", xT]]) };
      },
    });
    const g = adjRes.gradients.get("k") ?? NaN;
    assert.ok(Math.abs(g - exact) < 2e-3, `Bounded Gauss-Legendre adjoint ${g} vs exact ${exact}`);
  });

  it("diagnoseInitializationSystem reports balanced, under-determined, and over-determined init systems", () => {
    const under = diagnoseInitializationSystem({
      blocks: [{ type: "explicit", target: "x", expr: 0 }],
      knowns: new Set(["p"]),
      unknowns: new Set(["x", "y"]),
      equationCount: 1,
    });
    assert.equal(under.status, "under-determined");
    assert.equal(under.degreesOfFreedom, 1);
    assert.deepEqual(under.unmatchedUnknowns, ["y"]);

    const over = diagnoseInitializationSystem({
      blocks: [{ type: "explicit", target: "x", expr: 0 }],
      knowns: new Set(["p"]),
      unknowns: new Set(["x"]),
      equationCount: 2,
    });
    assert.equal(over.status, "over-determined");
    assert.equal(over.degreesOfFreedom, -1);
  });

  it("DGKF output-feedback H_inf, Arena RTI-NMPC, and NUTS posterior sampler all succeed", async () => {
    await initBltWasm();
    // 1. Output-feedback H_inf
    const hinf = synthesizeHinfOutputFeedback(
      {
        A: [
          [0, 1],
          [-1, -0.5],
        ],
        B1: [[0], [1]],
        B2: [[0], [1]],
        C1: [
          [1, 0],
          [0, 0.5],
        ],
        C2: [[1, 0]],
      },
      { gammaMin: 0.2, gammaMax: 25.0, gammaTol: 0.05 },
    );
    assert.equal(hinf.converged, true);
    assert.ok(hinf.spectralRadiusXY < hinf.gamma * hinf.gamma);
    assert.equal(hinf.controller.Ak.length, 2);

    // 2. Arena-bound RTI-NMPC: der(x) = -x + u
    const dae = new DAEBuilder();
    const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
    dae.setVarStartValue(xIdx, 1.0);
    dae.addVariable("u", VarType.Real, Variability.Parameter, 0, 0.0);
    const xRef = dae.addNameExpr("x");
    const uRef = dae.addNameExpr("u");
    dae.addEquation(EqKind.Simple, dae.addDerExpr(xRef), dae.addBinaryExpr(BinOp.Sub, uRef, xRef));

    const sim = new ArenaSimulator(dae);
    const mpc = createArenaRtiNmpc(dae, sim, {
      stateNames: ["x"],
      controlNames: ["u"],
      horizon: 10,
      dt: 0.1,
      Q: [10],
      R: [0.1],
      uMin: [-5],
      uMax: [5],
    });
    const step = mpc.computeControl([0.0], [2.0]);
    assert.ok(step.u0[0]! > 0.5, `Expected positive control toward setpoint xRef=2, got ${step.u0[0]}`);

    // 3. NUTS posterior sampler on 2D Gaussian N([2.0, -1.0], diag(0.25, 0.25))
    const nuts = samplePosteriorNuts({
      initialPosition: new Float64Array([0.0, 0.0]),
      numSamples: 300,
      numWarmup: 150,
      stepSize: 0.15,
      logProbAndGrad: (q) => {
        const d0 = q[0]! - 2.0;
        const d1 = q[1]! + 1.0;
        return {
          logProb: -0.5 * ((d0 * d0) / 0.25 + (d1 * d1) / 0.25),
          grad: new Float64Array([-d0 / 0.25, -d1 / 0.25]),
        };
      },
    });
    assert.ok(Math.abs(nuts.mean[0]! - 2.0) < 0.25, `Expected NUTS mean[0] ≈ 2.0, got ${nuts.mean[0]}`);
    assert.ok(Math.abs(nuts.mean[1]! - -1.0) < 0.25, `Expected NUTS mean[1] ≈ -1.0, got ${nuts.mean[1]}`);
    assert.ok(nuts.ci95[0]![0] < 2.0 && nuts.ci95[0]![1] > 2.0);
  });
});
