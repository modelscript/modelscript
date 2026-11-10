// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Advanced Extensions Verification Suite:
 * 1. Conic Optimization (SOCP & Rotated Second-Order Cones)
 * 2. Extended Nonlinear Special Functions (erf, erfc, gamma, lgamma, bessel, normal)
 * 3. In-Memory Native C / FFI Solver Bridges for IBM ILOG CPLEX & Artleys Knitro
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  besselJ0,
  besselJ1,
  besselY0,
  besselY1,
  classifyProblem,
  CplexNativeAdapter,
  erf,
  erfc,
  gamma,
  KnitroNativeAdapter,
  lgamma,
  normal,
  normal01,
  normalPdf,
  instantiateAmpl,
  parseAmplModel,
  probeNativeSolverLibrary,
  solveAmpl,
  solveWithNativeFfi,
} from "../src/index.js";

describe("languages/ampl: Advanced Extension 1 — Conic Optimization (SOCP & RSOC)", () => {
  it("detects standard Second-Order Cone (SOCP) constraints and classifies problem", async () => {
    const modSrc = `
      var x1 >= 0;
      var x2 >= 0;
      var t >= 0;

      minimize TotalCost:
        x1 + 2 * x2 + 3 * t;

      subject to ConicLimit:
        x1^2 + x2^2 - t^2 <= 0;

      subject to ProductionBound:
        x1 + x2 >= 5;
    `;

    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model, undefined, { preferConic: true });

    // Classified as SOCP
    assert.strictEqual(problem.problemClass, "SOCP");

    // Conic constraint detected
    assert.ok(problem.cones && problem.cones.length === 1, "Expected 1 detected cone");
    const cone = problem.cones![0]!;
    assert.strictEqual(cone.type, "SOC");
    assert.strictEqual(cone.name, "ConicLimit");

    const tVar = problem.variables.find((v) => v.name === "t")!;
    assert.strictEqual(cone.coneVarId, tVar.id);
    assert.strictEqual(cone.variables.length, 2);

    // Problem statistics reflect detected cone
    const stats = classifyProblem(problem);
    assert.strictEqual(stats.problemClass, "SOCP");
    assert.strictEqual(stats.numCones, 1);

    // Solves cleanly via interior point / penalty method
    const result = await solveAmpl(problem);
    assert.strictEqual(result.status, "OPTIMAL");
    const x1 = result.variables["x1"]!;
    const x2 = result.variables["x2"]!;
    const t = result.variables["t"]!;
    assert.ok(x1 + x2 >= 4.95, `Expected x1+x2>=5, got ${x1 + x2}`);
    assert.ok(Math.sqrt(x1 * x1 + x2 * x2) <= t + 1e-2, "SOC norm constraint violated");
  });

  it("detects Rotated Second-Order Cone (RSOC) quadratic constraints", () => {
    const modSrc = `
      var x >= 0;
      var y >= 0;
      var u >= 0;
      var v >= 0;

      minimize Obj: u + v;

      subject to RotatedCone:
        x^2 + y^2 - 2 * u * v <= 0;

      subject to Workload:
        x + y >= 10;
    `;

    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model, undefined, { preferConic: true });

    assert.strictEqual(problem.problemClass, "SOCP");
    assert.ok(problem.cones && problem.cones.length === 1);

    const cone = problem.cones![0]!;
    assert.strictEqual(cone.type, "RSOC");
    assert.strictEqual(cone.name, "RotatedCone");
    assert.strictEqual(cone.coneMultiplier, 2);

    const uVar = problem.variables.find((varObj) => varObj.name === "u")!;
    const vVar = problem.variables.find((varObj) => varObj.name === "v")!;
    assert.strictEqual(cone.coneVarId, uVar.id);
    assert.strictEqual(cone.rotVarId, vVar.id);
  });
});

describe("languages/ampl: Advanced Extension 2 — Extended Nonlinear Special Functions", () => {
  it("evaluates high-precision error functions erf and erfc satisfying mathematical identities", () => {
    assert.strictEqual(erf(0), 0);
    assert.ok(Math.abs(erf(1) - 0.84270079) < 1e-4);
    assert.ok(Math.abs(erf(-1) - -0.84270079) < 1e-4);

    // Identity: erf(x) + erfc(x) === 1
    for (const x of [0.1, 0.5, 1.0, 2.0, 3.5]) {
      assert.ok(
        Math.abs(erf(x) + erfc(x) - 1.0) < 1e-7,
        `Identity failed at x=${x}: erf=${erf(x)}, erfc=${erfc(x)}`,
      );
    }
  });

  it("evaluates Gamma and log-Gamma functions accurately", () => {
    // Factorial identity: Gamma(n) = (n - 1)!
    assert.ok(Math.abs(gamma(1) - 1) < 1e-12);
    assert.ok(Math.abs(gamma(2) - 1) < 1e-12);
    assert.ok(Math.abs(gamma(3) - 2) < 1e-12);
    assert.ok(Math.abs(gamma(4) - 6) < 1e-12);
    assert.ok(Math.abs(gamma(5) - 24) < 1e-12);
    assert.ok(Math.abs(gamma(6) - 120) < 1e-12);

    // Half-integer: Gamma(1/2) = sqrt(pi) ≈ 1.77245385
    assert.ok(Math.abs(gamma(0.5) - Math.sqrt(Math.PI)) < 1e-10);

    // lgamma(5) = ln(24) ≈ 3.17805383
    assert.ok(Math.abs(lgamma(5) - Math.log(24)) < 1e-10);
  });

  it("evaluates Bessel functions of first and second kinds J0, J1, Y0, Y1", () => {
    // J_0(0) = 1, J_1(0) = 0
    assert.ok(Math.abs(besselJ0(0) - 1.0) < 1e-6);
    assert.ok(Math.abs(besselJ1(0) - 0.0) < 1e-6);

    // Known values at x = 1:
    // J0(1) ≈ 0.7651976865
    // J1(1) ≈ 0.4400505857
    // Y0(1) ≈ 0.0882569642
    // Y1(1) ≈ -0.7812128213
    assert.ok(Math.abs(besselJ0(1) - 0.76519768) < 1e-4);
    assert.ok(Math.abs(besselJ1(1) - 0.44005058) < 1e-4);
    assert.ok(Math.abs(besselY0(1) - 0.08825696) < 1e-4);
    assert.ok(Math.abs(besselY1(1) - -0.78121282) < 1e-4);
  });

  it("evaluates Normal distribution CDF and PDF functions", () => {
    // Standard normal CDF: Phi(0) = 0.5, Phi(-inf) = 0, Phi(+inf) = 1
    assert.ok(Math.abs(normal01(0) - 0.5) < 1e-7);
    assert.ok(Math.abs(normal01(1.96) - 0.975) < 1e-3);
    assert.ok(Math.abs(normal01(-1.96) - 0.025) < 1e-3);

    // General normal: normal(mu, mu, sigma) = 0.5
    assert.ok(Math.abs(normal(100, 100, 15) - 0.5) < 1e-7);

    // PDF at mean: 1 / (sigma * sqrt(2*pi))
    const expectedPeak = 1.0 / Math.sqrt(2 * Math.PI);
    assert.ok(Math.abs(normalPdf(0, 0, 1) - expectedPeak) < 1e-7);
  });

  it("solves optimization models containing special functions in objectives", async () => {
    const modSrc = `
      var x := 2.0;

      minimize Loss:
        (erf(x) - 0.8427)^2;
    `;

    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);
    assert.strictEqual(problem.problemClass, "NLP");

    const result = await solveAmpl(problem);
    assert.strictEqual(result.status, "OPTIMAL");
    // erf(1.0) ≈ 0.8427, so minimum is at x ≈ 1.0
    assert.ok(
      Math.abs(result.variables["x"]! - 1.0) < 0.1,
      `Expected x ≈ 1.0, got ${result.variables["x"]}`,
    );
    assert.ok(result.objectiveValue < 0.01);
  });
});

describe("languages/ampl: Advanced Extension 4 — CPLEX & Knitro In-Memory C FFI Bridges", () => {
  it("probes host system for CPLEX and Knitro shared libraries", () => {
    const cplexProbe = probeNativeSolverLibrary("cplex");
    assert.strictEqual(cplexProbe.solver, "cplex");
    assert.strictEqual(typeof cplexProbe.available, "boolean");

    const knitroProbe = probeNativeSolverLibrary("knitro");
    assert.strictEqual(knitroProbe.solver, "knitro");
    assert.strictEqual(typeof knitroProbe.available, "boolean");
  });

  it("instantiates adapters directly and handles absence gracefully", async () => {
    const cplexAdapter = new CplexNativeAdapter();
    const knitroAdapter = new KnitroNativeAdapter();

    assert.strictEqual(cplexAdapter.solver, "cplex");
    assert.strictEqual(knitroAdapter.solver, "knitro");

    const modSrc = `
      var x >= 0;
      minimize Obj: 5 * x;
      subject to Con: x >= 10;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);

    if (!cplexAdapter.probe().available) {
      await assert.rejects(
        () => solveWithNativeFfi(problem, "cplex"),
        /Native IBM ILOG CPLEX shared library/,
      );
    }

    if (!knitroAdapter.probe().available) {
      await assert.rejects(
        () => solveWithNativeFfi(problem, "knitro"),
        /Native Artleys Knitro shared library/,
      );
    }
  });
});
