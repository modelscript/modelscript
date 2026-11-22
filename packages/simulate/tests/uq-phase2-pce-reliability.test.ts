// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import {
  fitPCE,
  fitPCEArena,
  gaussQuadrature1D,
  normalCDF,
  runFORM,
  runFORMArena,
  runSORM,
  runSORMArena,
  runSubsetSimulation,
  runSubsetSimulationArena,
  type RandomVariable,
} from "../src/uq/index.js";

await initBltWasm();

console.log("=== Testing Phase 2 Spectral (gPCE) & Reliability (FORM/SORM/Subset) UQ ===");

// 1. Gauss-Hermite & Gauss-Legendre 1D quadrature exactness
{
  const gh = gaussQuadrature1D("hermite", 4);
  const wSumH = gh.weights.reduce((a, b) => a + b, 0);
  // E[X^4] = 3 for X ~ N(0, 1)
  const m4H = gh.nodes.reduce((acc, x, i) => acc + gh.weights[i]! * x ** 4, 0);
  assert.ok(Math.abs(wSumH - 1.0) < 1e-12, `Hermite weights sum: ${wSumH}`);
  assert.ok(Math.abs(m4H - 3.0) < 1e-11, `Hermite E[X^4]: ${m4H}`);

  const gl = gaussQuadrature1D("legendre", 4);
  const wSumL = gl.weights.reduce((a, b) => a + b, 0);
  // E[U^4] = 1/5 for U ~ U(-1, 1)
  const m4L = gl.nodes.reduce((acc, x, i) => acc + gl.weights[i]! * x ** 4, 0);
  assert.ok(Math.abs(wSumL - 1.0) < 1e-12, `Legendre weights sum: ${wSumL}`);
  assert.ok(Math.abs(m4L - 0.2) < 1e-11, `Legendre E[U^4]: ${m4L}`);

  console.log("✓ Golub-Welsch Gauss-Hermite & Gauss-Legendre quadrature passed");
}

// 2. gPCE exactness on Gaussian polynomial (both quadrature and regression)
{
  // f(x1, x2) = x1^2 + 2*x1*x2 - 3*x2, x1 ~ N(0, 1), x2 ~ N(0, 1)
  // Exact: E[f] = 1, Var[f] = Var(x1^2) + Var(2*x1*x2) + Var(-3*x2) = 2 + 4 + 9 = 15
  // Exact Sobol: S1 = 2/15, S2 = 9/15, ST1 = 6/15, ST2 = 13/15
  const vars: RandomVariable[] = [
    { name: "x1", distribution: { type: "gaussian", mean: 0, stddev: 1 } },
    { name: "x2", distribution: { type: "gaussian", mean: 0, stddev: 1 } },
  ];
  const polyFn = (s: Map<string, number>): number => {
    const x1 = s.get("x1")!;
    const x2 = s.get("x2")!;
    return x1 * x1 + 2 * x1 * x2 - 3 * x2;
  };

  for (const method of ["quadrature", "regression"] as const) {
    const pce = fitPCE(polyFn, vars, { degree: 2, method });
    assert.strictEqual(pce.rigor, "approximate");
    const out = pce.outputs.get("y")!;

    assert.ok(Math.abs(out.mean - 1.0) < 1e-8, `PCE (${method}) mean: ${out.mean}`);
    assert.ok(Math.abs(out.variance - 15.0) < 1e-7, `PCE (${method}) var: ${out.variance}`);

    const [s1, s2] = out.sobolIndices;
    assert.ok(Math.abs(s1!.firstOrder - 2 / 15) < 1e-7, `PCE (${method}) S1: ${s1!.firstOrder}`);
    assert.ok(Math.abs(s2!.firstOrder - 9 / 15) < 1e-7, `PCE (${method}) S2: ${s2!.firstOrder}`);
    assert.ok(Math.abs(s1!.totalOrder - 6 / 15) < 1e-7, `PCE (${method}) ST1: ${s1!.totalOrder}`);
    assert.ok(Math.abs(s2!.totalOrder - 13 / 15) < 1e-7, `PCE (${method}) ST2: ${s2!.totalOrder}`);

    // Surrogate prediction exactness
    const testPt = new Map([
      ["x1", 1.3],
      ["x2", -0.7],
    ]);
    assert.ok(Math.abs(out.predict(testPt) - polyFn(testPt)) < 1e-8, `PCE (${method}) prediction mismatch`);
    if (method === "regression") {
      assert.ok((out.q2Loo ?? 0) > 0.999999, `PCE Q2_LOO should be ~1, got ${out.q2Loo}`);
    }
  }

  console.log("✓ gPCE quadrature & regression exactness + Sudret Sobol' indices passed");
}

// 3. gPCE on Ishigami function (analytical Sobol' indices with far fewer evaluations than MC)
{
  const vars: RandomVariable[] = [
    { name: "x1", distribution: { type: "uniform", lo: -Math.PI, hi: Math.PI } },
    { name: "x2", distribution: { type: "uniform", lo: -Math.PI, hi: Math.PI } },
    { name: "x3", distribution: { type: "uniform", lo: -Math.PI, hi: Math.PI } },
  ];
  const ishigami = (s: Map<string, number>): number => {
    const x1 = s.get("x1")!;
    const x2 = s.get("x2")!;
    const x3 = s.get("x3")!;
    return Math.sin(x1) + 7 * Math.sin(x2) ** 2 + 0.1 * x3 ** 4 * Math.sin(x1);
  };

  // Degree 9 total-degree basis in 3D has C(12,3)=220 terms; 600 samples gives Q2_LOO > 0.99
  const pce = fitPCE(ishigami, vars, { degree: 9, method: "regression", numSamples: 600 });
  const out = pce.outputs.get("y")!;
  const [s1, s2, s3] = out.sobolIndices;

  assert.ok((out.q2Loo ?? 0) > 0.99, `Ishigami PCE Q2_LOO should be > 0.99, got ${out.q2Loo}`);
  assert.ok(Math.abs(s1!.firstOrder - 0.3139) < 0.02, `Ishigami PCE S1: ${s1!.firstOrder}`);
  assert.ok(Math.abs(s2!.firstOrder - 0.4424) < 0.02, `Ishigami PCE S2: ${s2!.firstOrder}`);
  assert.ok(Math.abs(s3!.firstOrder - 0.0) < 0.02, `Ishigami PCE S3: ${s3!.firstOrder}`);
  assert.ok(Math.abs(s1!.totalOrder - 0.5576) < 0.02, `Ishigami PCE ST1: ${s1!.totalOrder}`);
  assert.ok(Math.abs(s2!.totalOrder - 0.4424) < 0.02, `Ishigami PCE ST2: ${s2!.totalOrder}`);
  assert.ok(Math.abs(s3!.totalOrder - 0.2437) < 0.02, `Ishigami PCE ST3: ${s3!.totalOrder}`);

  console.log(
    `✓ Ishigami gPCE analytical Sobol' indices passed (Q2_LOO=${out.q2Loo!.toFixed(5)}, ${pce.numEvaluations} evals)`,
  );
}

// 4. FORM exactness on linear Gaussian limit state (uncorrelated & correlated)
{
  const vars: RandomVariable[] = [
    { name: "R", distribution: { type: "gaussian", mean: 10.0, stddev: 1.0 } },
    { name: "S", distribution: { type: "gaussian", mean: 5.0, stddev: 1.0 } },
  ];
  const limitState = (x: Map<string, number>): number => x.get("R")! - x.get("S")!;

  // Uncorrelated: beta = (10 - 5) / sqrt(1 + 1) = 5 / sqrt(2)
  const formUncorr = runFORM(limitState, vars);
  const exactBetaUncorr = 5 / Math.SQRT2;
  assert.ok(formUncorr.converged, "FORM must converge on linear limit state");
  assert.ok(Math.abs(formUncorr.beta - exactBetaUncorr) < 1e-6, `FORM beta: ${formUncorr.beta} vs ${exactBetaUncorr}`);
  assert.ok(Math.abs(formUncorr.failureProbability - normalCDF(-exactBetaUncorr)) < 1e-8, "FORM Pf mismatch");
  assert.ok(Math.abs(formUncorr.importanceFactors.get("R")! - 0.5) < 1e-6);
  assert.ok(Math.abs(formUncorr.importanceFactors.get("S")! - 0.5) < 1e-6);

  // Correlated (rho = 0.5): Var(R - S) = 1 + 1 - 2*0.5 = 1 => beta = 5.0
  const formCorr = runFORM(limitState, vars, {
    correlations: [
      [1.0, 0.5],
      [0.5, 1.0],
    ],
  });
  assert.ok(formCorr.converged);
  assert.ok(Math.abs(formCorr.beta - 5.0) < 1e-6, `Correlated FORM beta: ${formCorr.beta} vs 5.0`);

  console.log("✓ FORM (iHLRF) exact linear limit state (uncorrelated & correlated) passed");
}

// 5. SORM curvature correction on nonlinear parabolic limit state
{
  // g(u1, u2) = beta0 - u1 + 0.25 * u2^2, u1, u2 ~ N(0, 1)
  // At MPP u* = (beta0, 0): ||grad|| = 1, principal curvature kappa = d^2g/du2^2 / ||grad|| = +0.5
  // Breitung: Pf_SORM = Phi(-beta0) * (1 + beta0 * 0.5)^(-1/2) < Pf_FORM (convex safe domain)
  const beta0 = 3.0;
  const vars: RandomVariable[] = [
    { name: "u1", distribution: { type: "gaussian", mean: 0, stddev: 1 } },
    { name: "u2", distribution: { type: "gaussian", mean: 0, stddev: 1 } },
  ];
  const parabolic = (x: Map<string, number>): number => beta0 - x.get("u1")! + 0.25 * x.get("u2")! ** 2;

  const sorm = runSORM(parabolic, vars);
  assert.ok(sorm.converged, "SORM FORM stage must converge");
  assert.ok(Math.abs(sorm.beta - beta0) < 1e-5, `SORM beta: ${sorm.beta} vs ${beta0}`);
  assert.strictEqual(sorm.principalCurvatures.length, 1);
  assert.ok(
    Math.abs(sorm.principalCurvatures[0]! - 0.5) < 1e-4,
    `Principal curvature kappa: ${sorm.principalCurvatures[0]} vs 0.5`,
  );
  const expectedSormPf = normalCDF(-beta0) / Math.sqrt(1 + beta0 * 0.5);
  assert.ok(
    Math.abs(sorm.sormFailureProbability - expectedSormPf) < 1e-6,
    `SORM Pf: ${sorm.sormFailureProbability} vs ${expectedSormPf}`,
  );
  assert.ok(sorm.sormFailureProbability < sorm.formFailureProbability);

  console.log("✓ SORM (Breitung curvature correction) passed");
}

// 6. Subset Simulation on a rare event (beta = 4.0 => Pf = 3.167e-5)
{
  const vars: RandomVariable[] = [
    { name: "u1", distribution: { type: "gaussian", mean: 0, stddev: 1 } },
    { name: "u2", distribution: { type: "gaussian", mean: 0, stddev: 1 } },
  ];
  // Linear limit state with exact beta = 4.0: g = 4*sqrt(2) - (u1 + u2)
  const rareLimit = (x: Map<string, number>): number => 4 * Math.SQRT2 - (x.get("u1")! + x.get("u2")!);
  const exactPf = normalCDF(-4.0); // ~3.167e-5

  const sub = runSubsetSimulation(rareLimit, vars, {
    samplesPerLevel: 1000,
    conditionalProb: 0.1,
    seed: 2025,
  });

  assert.strictEqual(sub.rigor, "statistical");
  assert.ok(sub.levels.length >= 4, `Expected >= 4 subset levels for Pf~3e-5, got ${sub.levels.length}`);
  assert.ok(
    sub.failureProbability > exactPf * 0.35 && sub.failureProbability < exactPf * 2.8,
    `Subset Sim Pf=${sub.failureProbability.toExponential(3)} should be close to ${exactPf.toExponential(3)}`,
  );
  assert.ok(Math.abs(sub.reliabilityIndex - 4.0) < 0.35, `Subset Sim beta=${sub.reliabilityIndex} vs 4.0`);

  console.log(
    `✓ Subset Simulation rare-event benchmark passed (Pf=${sub.failureProbability.toExponential(2)} vs exact ${exactPf.toExponential(2)}, ${sub.numEvaluations} evals)`,
  );
}

// 7. End-to-end DAEBuilder Arena tests: fitPCEArena, runFORMArena, runSORMArena, runSubsetSimulationArena
{
  // der(x) = -k * x, x(0) = 1.0 => x(1) = exp(-k)
  // Failure event: x(1) <= 0.25  <=>  k >= -ln(0.25) = 1.38629436
  // For k ~ N(1.0, 0.15^2): exact beta = (1.38629436 - 1.0) / 0.15 = 2.5752957
  const arena = new DAEBuilder();
  arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.addVariable("der(x)", VarType.Real, Variability.Continuous, 0, 0.0);
  arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 1.0);
  const xExpr = arena.addNameExpr("x");
  arena.addEquation(
    EqKind.Simple,
    arena.addDerExpr(xExpr),
    arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("k"), xExpr)),
  );

  const muK = 1.0;
  const sigmaK = 0.15;
  const rvs: RandomVariable[] = [{ name: "k", distribution: { type: "gaussian", mean: muK, stddev: sigmaK } }];
  const simOpts = { startTime: 0, stopTime: 1.0, step: 0.05 };

  // PCE Arena
  const pceArena = fitPCEArena(arena, rvs, { degree: 4, method: "quadrature", simulateOptions: simOpts });
  const xPce = pceArena.outputs.get("x")!;
  const exactMean = Math.exp(-muK + 0.5 * sigmaK * sigmaK);
  assert.ok(Math.abs(xPce.mean - exactMean) < 1e-3, `Arena PCE mean: ${xPce.mean} vs ${exactMean}`);

  // FORM & SORM Arena
  const xMin = 0.25;
  const exactBeta = (-Math.log(xMin) - muK) / sigmaK;
  const exactPf = normalCDF(-exactBeta);
  const limitFn = (sim: { y: number[][] }): number => (sim.y[sim.y.length - 1]?.[0] ?? 0) - xMin;

  const formArena = runFORMArena(arena, rvs, limitFn, { simulateOptions: simOpts });
  const sormArena = runSORMArena(arena, rvs, limitFn, { simulateOptions: simOpts });
  assert.ok(formArena.converged, "Arena FORM must converge");
  assert.ok(Math.abs(formArena.beta - exactBeta) < 1e-2, `Arena FORM beta: ${formArena.beta} vs ${exactBeta}`);
  assert.ok(Math.abs(sormArena.beta - exactBeta) < 1e-2, `Arena SORM beta: ${sormArena.beta} vs ${exactBeta}`);

  // Subset Simulation Arena
  const subArena = runSubsetSimulationArena(arena, rvs, limitFn, {
    simulateOptions: simOpts,
    samplesPerLevel: 150,
    conditionalProb: 0.2,
    seed: 7,
  });
  assert.ok(
    subArena.failureProbability > exactPf * 0.25 && subArena.failureProbability < exactPf * 4.0,
    `Arena Subset Sim Pf=${subArena.failureProbability.toExponential(2)} vs exact ${exactPf.toExponential(2)}`,
  );

  console.log("✓ End-to-end DAEBuilder Arena PCE, FORM, SORM, and Subset Simulation passed");
}

// 8. High-dimensional Sparse OMP + Hyperbolic Truncation gPCE (15D model, N << full basis)
{
  const dim = 15;
  const vars: RandomVariable[] = Array.from({ length: dim }, (_, i) => ({
    name: `x${i}`,
    distribution: { type: "gaussian", mean: 0, stddev: 1 },
  }));
  // Only x0 and x1 are active: f(x) = 3*x0 + x1^2 + 2*x0*x1
  // Exact: E[f] = 1, Var[f] = 9 + 2 + 4 = 15, S1(x0)=9/15=0.6, S1(x1)=2/15=0.1333, ST(x0)=13/15, ST(x1)=6/15
  const sparseFn = (s: Map<string, number>): number => {
    const x0 = s.get("x0")!;
    const x1 = s.get("x1")!;
    return 3 * x0 + x1 * x1 + 2 * x0 * x1;
  };

  // Full degree-3 15D basis has C(18,3)=816 terms; hyperbolic qNorm=0.7 + sparse OMP solves with only 80 samples!
  const sparsePce = fitPCE(sparseFn, vars, {
    degree: 3,
    qNorm: 0.7,
    sparse: true,
    numSamples: 80,
    maxActiveTerms: 12,
  });

  const out = sparsePce.outputs.get("y")!;
  assert.ok(sparsePce.numBasis < 816, `Hyperbolic qNorm=0.7 should prune basis below 816, got ${sparsePce.numBasis}`);
  assert.ok(Math.abs(out.mean - 1.0) < 1e-6, `Sparse 15D PCE mean: ${out.mean}`);
  assert.ok(Math.abs(out.variance - 15.0) < 1e-5, `Sparse 15D PCE variance: ${out.variance}`);
  assert.ok((out.q2Loo ?? 0) > 0.9999, `Sparse 15D PCE Q2_LOO: ${out.q2Loo}`);
  assert.deepStrictEqual(out.rankedByTotalOrder.slice(0, 2), ["x0", "x1"]);

  console.log(
    `✓ High-dimensional 15D Sparse OMP + Hyperbolic gPCE passed (basis=${sparsePce.numBasis}, N=80, Q2_LOO=${out.q2Loo!.toFixed(5)})`,
  );
}

console.log("=== All Phase 2 Spectral & Reliability UQ tests passed! ===");
