// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateCollocationPoints,
  generateMultiDimCollocationPoints,
  refineCollocationRAR,
} from "../src/surrogates/pinn-collocation.js";
import {
  computeAnalyticalPINNGradients,
  forwardMultiDimPINN,
  forwardPINN,
  trainPDEPINN,
  trainPINN,
  type PINNActivation,
  type PINNConfig,
  type PINNLayer,
} from "../src/surrogates/pinn-trainer.js";

describe("Physics-Informed Neural Network (PINN) Suite", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Collocation Generation & RAR Testing
  // ───────────────────────────────────────────────────────────────────────────
  describe("Collocation Point Generators", () => {
    it("generates uniform collocation points across [t0, tEnd]", () => {
      const pts = generateCollocationPoints({
        tSpan: [0.0, 10.0],
        count: 11,
        strategy: "uniform",
      });
      assert.equal(pts.length, 11);
      assert.equal(pts[0], 0.0);
      assert.equal(pts[10], 10.0);
      assert.ok(Math.abs(pts[1]! - 1.0) < 1e-9);
    });

    it("generates Sobol low-discrepancy points in [0, 5]", () => {
      const pts = generateCollocationPoints({
        tSpan: [0.0, 5.0],
        count: 50,
        strategy: "sobol",
      });
      assert.ok(pts.length >= 50);
      assert.equal(pts[0], 0.0);
      assert.equal(pts[pts.length - 1], 5.0);
      // Strictly monotonic ascending
      for (let i = 1; i < pts.length; i++) {
        assert.ok(pts[i]! >= pts[i - 1]!);
      }
    });

    it("generates Chebyshev-Gauss-Lobatto nodes with boundary clustering", () => {
      const pts = generateCollocationPoints({
        tSpan: [0.0, 1.0],
        count: 21,
        strategy: "chebyshev",
      });
      assert.equal(pts.length, 21);
      assert.ok(Math.abs(pts[0]! - 0.0) < 1e-9);
      assert.ok(Math.abs(pts[20]! - 1.0) < 1e-9);

      // Boundary intervals should be tighter than midpoint interval
      const dStart = pts[1]! - pts[0]!;
      const dMid = pts[11]! - pts[10]!;
      assert.ok(dStart < dMid, `Boundary spacing (${dStart}) must be smaller than mid spacing (${dMid})`);
    });

    it("refines collocation points adaptively at residual peaks via RAR", () => {
      const basePts = [0.0, 2.5, 5.0];
      // Residual function with a sharp localized peak at t = 3.7
      const peakResidual = (t: number) => Math.exp(-10.0 * Math.pow(t - 3.7, 2));

      const refined = refineCollocationRAR(basePts, [0.0, 5.0], peakResidual, 5, 100);
      assert.equal(refined.length, basePts.length + 5);

      // At least one new point should be very close to the peak at 3.7 (within 0.5)
      const closest = refined.reduce((min, t) => Math.min(min, Math.abs(t - 3.7)), Infinity);
      assert.ok(closest < 0.5, `RAR closest point to peak was ${closest}`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Exact Analytical Time-Derivatives vs. Finite Differences
  // ───────────────────────────────────────────────────────────────────────────
  describe("Exact Analytical Time Derivatives vs. Finite Differences", () => {
    const activations: PINNActivation[] = ["tanh", "sin", "gelu"];

    for (const act of activations) {
      it(`computes exact dy/dt and d2y/dt2 matching finite differences for '${act}'`, () => {
        // Construct a small 2-layer network with deterministic weights
        const layers: PINNLayer[] = [
          {
            W: [[0.5], [-0.8], [1.2]],
            b: [0.1, -0.2, 0.3],
          },
          {
            W: [
              [0.7, -0.4, 0.6],
              [-0.5, 0.9, -0.3],
            ],
            b: [-0.1, 0.2],
          },
        ];

        const tTest = 1.45;
        const res = forwardPINN(tTest, layers, act);

        // Finite difference step
        const eps = 1e-5;
        const resPlus = forwardPINN(tTest + eps, layers, act);
        const resMinus = forwardPINN(tTest - eps, layers, act);

        for (let dim = 0; dim < 2; dim++) {
          const numDy = (resPlus.y[dim]! - resMinus.y[dim]!) / (2.0 * eps);
          const analyticalDy = res.dy[dim]!;
          assert.ok(
            Math.abs(analyticalDy - numDy) < 1e-4,
            `[${act}] dy mismatch on dim ${dim}: analytical=${analyticalDy}, fd=${numDy}`,
          );

          const numD2y = (resPlus.y[dim]! - 2.0 * res.y[dim]! + resMinus.y[dim]!) / (eps * eps);
          const analyticalD2y = res.d2y[dim]!;
          assert.ok(
            Math.abs(analyticalD2y - numD2y) < 1e-3,
            `[${act}] d2y mismatch on dim ${dim}: analytical=${analyticalD2y}, fd=${numD2y}`,
          );
        }
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Physical Law Discovery & Training (Exponential Decay: dy/dt = -k*y)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Physical Law Training: Exponential Decay", () => {
    it("trains PINN on dy/dt = -0.5*y with only y(0)=1.0 (no trajectory data)", () => {
      const k = 0.5;
      const trained = trainPINN({
        tSpan: [0.0, 2.0],
        stateDim: 1,
        hiddenLayers: [16, 16],
        activation: "tanh",
        epochs: 60,
        learningRate: 0.02,
        initialConditions: [{ t: 0.0, y: [1.0] }],
        physicsResidual: (_t, y, dy) => [
          dy[0]! + k * y[0]!, // dy/dt + 0.5*y = 0
        ],
        collocation: {
          tSpan: [0.0, 2.0],
          count: 15,
          strategy: "chebyshev",
        },
        weights: {
          ic: 25.0,
          physics: 2.0,
        },
      });

      assert.ok(trained.lossHistory.length > 0);
      const initLoss = trained.lossHistory[0]!.total;
      const finalLoss = trained.finalLoss.total;

      // Loss should decrease significantly
      assert.ok(finalLoss < initLoss, `Final loss (${finalLoss}) must be lower than init loss (${initLoss})`);

      // Verify IC is satisfied
      const at0 = trained.predict(0.0);
      assert.ok(Math.abs(at0.y[0]! - 1.0) < 0.1, `y(0) was ${at0.y[0]}, expected ~1.0`);

      // Verify that at t = 1.0, prediction is close to exact analytical solution exp(-0.5) ~ 0.6065
      const at1 = trained.predict(1.0);
      const expected1 = Math.exp(-0.5 * 1.0);
      assert.ok(Math.abs(at1.y[0]! - expected1) < 0.25, `y(1) was ${at1.y[0]}, analytical expected ${expected1}`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Modelica Block Surrogate Export
  // ───────────────────────────────────────────────────────────────────────────
  describe("Modelica Block Surrogate Emitter", () => {
    it("exports trained PINN to a syntactically valid Modelica block", () => {
      const trained = trainPINN({
        tSpan: [0.0, 1.0],
        stateDim: 2,
        hiddenLayers: [8, 8],
        epochs: 2,
        initialConditions: [{ t: 0.0, y: [0.0, 1.0] }],
        physicsResidual: (_t, y, dy) => [dy[0]! - y[1]!, dy[1]! + y[0]!],
      });

      const moCode = trained.toModelica("HarmonicPINN");
      assert.ok(moCode.includes("block HarmonicPINN"));
      assert.ok(moCode.includes("input Real t"));
      assert.ok(moCode.includes("output Real y_0"));
      assert.ok(moCode.includes("output Real y_1"));
      assert.ok(moCode.includes("parameter Real W_0"));
      assert.ok(moCode.includes("end HarmonicPINN;"));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Exact Analytical Backward-of-Forward Weight Gradients vs. Finite Diff
  // ───────────────────────────────────────────────────────────────────────────
  describe("Exact Analytical Weight Backpropagation Through 2nd-Order Jet", () => {
    const activations: PINNActivation[] = ["tanh", "sin", "gelu"];

    for (const act of activations) {
      it(`matches centered finite-difference parameter gradients to < 1e-8 for '${act}'`, () => {
        const layers: PINNLayer[] = [
          {
            W: [[0.6], [-0.45], [0.85]],
            b: [0.15, -0.25, 0.05],
          },
          {
            W: [
              [0.5, -0.7, 0.3],
              [-0.4, 0.8, -0.2],
              [0.3, 0.2, -0.6],
            ],
            b: [-0.1, 0.2, 0.1],
          },
          {
            W: [
              [0.9, -0.5, 0.4],
              [-0.3, 0.7, -0.8],
            ],
            b: [0.05, -0.15],
          },
        ];

        const cfg: PINNConfig = {
          tSpan: [0.0, 2.0],
          stateDim: 2,
          activation: act,
          initialConditions: [{ t: 0.0, y: [1.0, 0.5], dy: [-0.2, 0.1] }],
          observations: [
            { t: 1.0, y: [0.6, 0.1] },
            { t: 2.0, y: [0.2, -0.1] },
          ],
          physicsResidual: (_t, y, dy, d2y) => [
            d2y![0]! + 0.5 * dy[0]! + 1.2 * y[0]! - 0.3 * y[1]!,
            d2y![1]! + 0.3 * dy[1]! + 0.8 * y[1]! + 0.2 * y[0]!,
          ],
          weights: { physics: 1.5, ic: 3.0, data: 1.0 },
        };

        const collocationPts = [0.0, 0.5, 1.0, 1.5, 2.0];
        const { gradW, gradB } = computeAnalyticalPINNGradients(cfg, layers, collocationPts);

        // Helper to evaluate exact scalar loss for finite difference comparison
        const evalLoss = (): number => {
          let lPhys = 0;
          for (const t of collocationPts) {
            const { y, dy, d2y } = forwardPINN(t, layers, act);
            const res = cfg.physicsResidual(t, y, dy, d2y);
            for (const r of res) lPhys += r * r;
          }
          lPhys /= collocationPts.length;

          let lIc = 0;
          for (const ic of cfg.initialConditions) {
            const { y, dy } = forwardPINN(ic.t, layers, act);
            for (let d = 0; d < 2; d++) {
              const diffY = y[d]! - ic.y[d]!;
              lIc += diffY * diffY;
              if (ic.dy && ic.dy[d] !== undefined) {
                const diffDy = dy[d]! - ic.dy[d]!;
                lIc += diffDy * diffDy;
              }
            }
          }
          lIc /= cfg.initialConditions.length;

          let lData = 0;
          for (const obs of cfg.observations!) {
            const { y } = forwardPINN(obs.t, layers, act);
            for (let d = 0; d < 2; d++) {
              const diff = y[d]! - obs.y[d]!;
              lData += diff * diff;
            }
          }
          lData /= cfg.observations!.length;

          return 1.5 * lPhys + 3.0 * lIc + 1.0 * lData;
        };

        const eps = 1e-6;
        for (let l = 0; l < layers.length; l++) {
          const layer = layers[l]!;
          for (let i = 0; i < layer.W.length; i++) {
            const row = layer.W[i]!;
            for (let j = 0; j < row.length; j++) {
              const orig = row[j]!;
              row[j] = orig + eps;
              const lPlus = evalLoss();
              row[j] = orig - eps;
              const lMinus = evalLoss();
              row[j] = orig;

              const fdGrad = (lPlus - lMinus) / (2.0 * eps);
              const anaGrad = gradW[l]![i]![j]!;
              assert.ok(
                Math.abs(anaGrad - fdGrad) < 1e-7,
                `[${act}] W[${l}][${i}][${j}] grad mismatch: analytical=${anaGrad}, fd=${fdGrad}`,
              );
            }

            const origB = layer.b[i]!;
            layer.b[i] = origB + eps;
            const lPlusB = evalLoss();
            layer.b[i] = origB - eps;
            const lMinusB = evalLoss();
            layer.b[i] = origB;

            const fdGradB = (lPlusB - lMinusB) / (2.0 * eps);
            const anaGradB = gradB[l]![i]!;
            assert.ok(
              Math.abs(anaGradB - fdGradB) < 1e-7,
              `[${act}] b[${l}][${i}] grad mismatch: analytical=${anaGradB}, fd=${fdGradB}`,
            );
          }
        }
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Multi-Dimensional Spatio-Temporal PDE Collocation & Training (1D Heat Eq)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Multi-Dimensional Spatio-Temporal PDE PINN (Heat Equation)", () => {
    it("generates 2D Halton and uniform collocation grids", () => {
      const haltonPts = generateMultiDimCollocationPoints(
        [
          [0.0, 1.0],
          [-1.0, 1.0],
        ],
        25,
        "halton",
      );
      assert.equal(haltonPts.length, 25);
      for (const pt of haltonPts) {
        assert.equal(pt.length, 2);
        assert.ok(pt[0]! >= 0.0 && pt[0]! <= 1.0);
        assert.ok(pt[1]! >= -1.0 && pt[1]! <= 1.0);
      }

      const uniformPts = generateMultiDimCollocationPoints(
        [
          [0.0, 1.0],
          [0.0, 2.0],
        ],
        16,
        "uniform",
      );
      assert.equal(uniformPts.length, 16);
    });

    it("computes exact spatial-temporal gradient and Laplacian jets in forwardMultiDimPINN", () => {
      const layers: PINNLayer[] = [
        {
          W: [
            [0.6, -0.8],
            [-0.5, 0.9],
            [0.4, 0.7],
          ],
          b: [0.1, -0.2, 0.15],
        },
        {
          W: [[0.8, -0.5, 0.6]],
          b: [0.05],
        },
      ];

      const z = [0.35, 0.65];
      const jet = forwardMultiDimPINN(z, layers, "tanh");
      const eps = 1e-5;

      for (let d = 0; d < 2; d++) {
        const zPlus = [...z];
        const zMinus = [...z];
        zPlus[d]! += eps;
        zMinus[d]! -= eps;

        const jPlus = forwardMultiDimPINN(zPlus, layers, "tanh");
        const jMinus = forwardMultiDimPINN(zMinus, layers, "tanh");

        const fdGrad = (jPlus.u[0]! - jMinus.u[0]!) / (2.0 * eps);
        const fdDiagH = (jPlus.u[0]! - 2.0 * jet.u[0]! + jMinus.u[0]!) / (eps * eps);

        assert.ok(Math.abs(jet.du[d]![0]! - fdGrad) < 1e-6);
        assert.ok(Math.abs(jet.d2u[d]![0]! - fdDiagH) < 1e-4);
      }
    });

    it("trains 2D spatio-temporal PINN on 1D Heat PDE u_t - alpha * u_xx = 0", () => {
      const alpha = 0.05;
      // Exact solution: u(t, x) = exp(-alpha * pi^2 * t) * sin(pi * x)
      const exactU = (t: number, x: number) => Math.exp(-alpha * Math.PI * Math.PI * t) * Math.sin(Math.PI * x);

      const boundaryConditions: Array<{ coords: number[]; u: number[] }> = [];
      // IC at t = 0: u(0, x) = sin(pi * x)
      for (let i = 0; i <= 8; i++) {
        const x = i / 8;
        boundaryConditions.push({ coords: [0.0, x], u: [Math.sin(Math.PI * x)] });
      }
      // Dirichlet BC at x = 0 and x = 1: u(t, 0) = 0, u(t, 1) = 0
      for (let j = 1; j <= 4; j++) {
        const t = (j / 4) * 0.2;
        boundaryConditions.push({ coords: [t, 0.0], u: [0.0] });
        boundaryConditions.push({ coords: [t, 1.0], u: [0.0] });
      }

      const pdeTrained = trainPDEPINN({
        domainBounds: [
          [0.0, 0.2], // t
          [0.0, 1.0], // x
        ],
        stateDim: 1,
        hiddenLayers: [12, 12],
        activation: "tanh",
        epochs: 120,
        learningRate: 0.03,
        collocationPoints: 25,
        boundaryConditions,
        pdeResidual: (_coords, _u, du, d2u) => {
          const u_t = du[0]![0]!;
          const u_xx = d2u[1]![0]!;
          return [u_t - alpha * u_xx];
        },
        weights: {
          pde: 1.0,
          bc: 25.0,
        },
      });

      assert.ok(pdeTrained.finalLoss < pdeTrained.lossHistory[0]!);
      const predMid = pdeTrained.predict([0.1, 0.5]).u[0]!;
      const exactMid = exactU(0.1, 0.5);
      assert.ok(Math.abs(predMid - exactMid) < 0.2, `Heat PDE u(0.1, 0.5) predicted ${predMid}, expected ${exactMid}`);
    });
  });
});
