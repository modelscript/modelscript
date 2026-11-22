// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import {
  choleskyDecompose,
  computeSobolIndices,
  computeSobolIndicesArena,
  propagateCovarianceODE,
  propagateFOSM,
  propagateFOSMArena,
  propagateSOSM,
  propagateUnscented,
  propagateUnscentedArena,
  type RandomVariable,
} from "../src/uq/index.js";

await initBltWasm();

console.log("=== Testing Phase 1 Analytical UQ & Sensitivity Propagation ===");

// 1. Cholesky decomposition & exact linear map (FOSM, SOSM, UT) with correlated inputs
{
  const muX = [2.0, -3.0];
  const covX = [
    [0.25, 0.12],
    [0.12, 0.64],
  ];

  const L = choleskyDecompose(covX);
  // Verify L * L^T == covX
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const recon = L[i]![0]! * L[j]![0]! + L[i]![1]! * L[j]![1]!;
      assert.ok(Math.abs(recon - covX[i]![j]!) < 1e-12, `Cholesky reconstruction mismatch at (${i},${j})`);
    }
  }

  // y = A x + b
  const A = [
    [3.0, -1.5],
    [0.5, 2.0],
  ];
  const b = [1.0, -4.0];
  const linearMap = (x: number[]): number[] => [
    A[0]![0]! * x[0]! + A[0]![1]! * x[1]! + b[0]!,
    A[1]![0]! * x[0]! + A[1]![1]! * x[1]! + b[1]!,
  ];

  // Exact mean and covariance: muY = A * muX + b, covY = A * covX * A^T
  const exactMean = linearMap(muX);
  const exactCov = [
    [
      A[0]![0]! * (covX[0]![0]! * A[0]![0]! + covX[0]![1]! * A[0]![1]!) +
        A[0]![1]! * (covX[1]![0]! * A[0]![0]! + covX[1]![1]! * A[0]![1]!),
      A[0]![0]! * (covX[0]![0]! * A[1]![0]! + covX[0]![1]! * A[1]![1]!) +
        A[0]![1]! * (covX[1]![0]! * A[1]![0]! + covX[1]![1]! * A[1]![1]!),
    ],
    [
      A[1]![0]! * (covX[0]![0]! * A[0]![0]! + covX[0]![1]! * A[0]![1]!) +
        A[1]![1]! * (covX[1]![0]! * A[0]![0]! + covX[1]![1]! * A[0]![1]!),
      A[1]![0]! * (covX[0]![0]! * A[1]![0]! + covX[0]![1]! * A[1]![1]!) +
        A[1]![1]! * (covX[1]![0]! * A[1]![0]! + covX[1]![1]! * A[1]![1]!),
    ],
  ];

  const fosm = propagateFOSM(linearMap, muX, covX);
  const sosm = propagateSOSM(linearMap, muX, covX);
  const ut = propagateUnscented(linearMap, muX, covX);

  assert.strictEqual(fosm.rigor, "approximate");
  assert.strictEqual(sosm.rigor, "approximate");
  assert.strictEqual(ut.rigor, "approximate");

  for (const [label, res] of [
    ["FOSM", fosm],
    ["SOSM", sosm],
    ["UT", ut],
  ] as const) {
    for (let i = 0; i < 2; i++) {
      assert.ok(
        Math.abs(res.mean[i]! - exactMean[i]!) < 1e-9,
        `${label} mean[${i}] mismatch: ${res.mean[i]} vs ${exactMean[i]}`,
      );
      for (let j = 0; j < 2; j++) {
        assert.ok(
          Math.abs(res.covariance[i]![j]! - exactCov[i]![j]!) < 1e-8,
          `${label} cov[${i},${j}] mismatch: ${res.covariance[i]![j]} vs ${exactCov[i]![j]}`,
        );
      }
    }
  }

  // Verify UT cross-covariance Cov(x, y) = covX * A^T
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const exactCross = covX[i]![0]! * A[j]![0]! + covX[i]![1]! * A[j]![1]!;
      assert.ok(Math.abs(ut.crossCovariance[i]![j]! - exactCross) < 1e-9, `UT crossCovariance[${i},${j}] mismatch`);
    }
  }

  console.log("✓ Linear map exactness (FOSM, SOSM, UT + Cholesky) passed");
}

// 2. Nonlinear quadratic map y = x^2 for Gaussian x ~ N(mu, sigma^2)
{
  const mu = 3.0;
  const sigma = 0.5;
  const varX = sigma * sigma;
  const quad = (x: number[]): number[] => [x[0]! * x[0]!];

  const exactMean = mu * mu + varX; // 9.25
  const exactVar = 4 * mu * mu * varX + 2 * varX * varX; // 9.125

  const fosm = propagateFOSM(quad, [mu], [[varX]]);
  const sosm = propagateSOSM(quad, [mu], [[varX]]);
  const ut = propagateUnscented(quad, [mu], [[varX]], { alpha: 1.0, beta: 2.0, kappa: 0.0 });

  // FOSM only captures linear terms: mu^2 and 4*mu^2*sigma^2
  assert.ok(Math.abs(fosm.mean[0]! - mu * mu) < 1e-9);
  assert.ok(Math.abs(fosm.covariance[0]![0]! - 4 * mu * mu * varX) < 1e-7);

  // SOSM captures exact mean shift (+sigma^2) and exact fourth-moment variance (+2*sigma^4)
  assert.ok(Math.abs(sosm.mean[0]! - exactMean) < 1e-6, `SOSM quadratic mean: ${sosm.mean[0]} vs ${exactMean}`);
  assert.ok(
    Math.abs(sosm.covariance[0]![0]! - exactVar) < 1e-5,
    `SOSM quadratic var: ${sosm.covariance[0]![0]} vs ${exactVar}`,
  );

  // Scaled UT with alpha=1, beta=2, kappa=0 also matches exact Gaussian quadratic mean and variance
  assert.ok(Math.abs(ut.mean[0]! - exactMean) < 1e-9, `UT quadratic mean: ${ut.mean[0]} vs ${exactMean}`);
  assert.ok(
    Math.abs(ut.covariance[0]![0]! - exactVar) < 1e-9,
    `UT quadratic var: ${ut.covariance[0]![0]} vs ${exactVar}`,
  );

  console.log("✓ Nonlinear quadratic moment propagation (FOSM vs SOSM vs UT) passed");
}

// 3. Continuous-time Covariance ODE on Ornstein–Uhlenbeck SDE: dx = -lambda*x dt + sigma dW
{
  const lambda = 1.5;
  const sigma = 0.8;
  const mu0 = 4.0;
  const P0 = 0.5;
  const tEnd = 2.0;

  const resExactJac = propagateCovarianceODE(
    {
      drift: (_t, x) => [-lambda * x[0]!],
      jacobian: () => [[-lambda]],
      initialMean: [mu0],
      initialCovariance: [[P0]],
      processNoiseQ: [[sigma * sigma]],
    },
    { t0: 0, tEnd, dt: 0.01 },
  );

  const resFdJac = propagateCovarianceODE(
    {
      drift: (_t, x) => [-lambda * x[0]!],
      initialMean: [mu0],
      initialCovariance: [[P0]],
      processNoiseQ: [[1.0]],
      noiseMatrixG: [[sigma]],
    },
    { t0: 0, tEnd, dt: 0.01 },
  );

  assert.strictEqual(resExactJac.rigor, "approximate");

  for (const res of [resExactJac, resFdJac]) {
    const lastIdx = res.t.length - 1;
    const t = res.t[lastIdx]!;
    const exactMu = mu0 * Math.exp(-lambda * t);
    const exactP = P0 * Math.exp(-2 * lambda * t) + ((sigma * sigma) / (2 * lambda)) * (1 - Math.exp(-2 * lambda * t));

    assert.ok(
      Math.abs(res.mean[lastIdx]![0]! - exactMu) < 1e-7,
      `OU mean mismatch at t=${t}: ${res.mean[lastIdx]![0]} vs ${exactMu}`,
    );
    assert.ok(
      Math.abs(res.covariance[lastIdx]![0]![0]! - exactP) < 1e-7,
      `OU variance mismatch at t=${t}: ${res.covariance[lastIdx]![0]![0]} vs ${exactP}`,
    );
  }

  console.log("✓ Continuous-time Ornstein-Uhlenbeck covariance ODE passed");
}

// 4. Global Sobol' Sensitivity Indices on the Ishigami benchmark function
{
  // f(x1, x2, x3) = sin(x1) + 7*sin^2(x2) + 0.1*x3^4*sin(x1), x_i ~ U(-pi, pi)
  const a = 7.0;
  const b = 0.1;
  const ishigamiVars: RandomVariable[] = [
    { name: "x1", distribution: { type: "uniform", lo: -Math.PI, hi: Math.PI } },
    { name: "x2", distribution: { type: "uniform", lo: -Math.PI, hi: Math.PI } },
    { name: "x3", distribution: { type: "uniform", lo: -Math.PI, hi: Math.PI } },
  ];

  const ishigami = (s: Map<string, number>): number => {
    const x1 = s.get("x1")!;
    const x2 = s.get("x2")!;
    const x3 = s.get("x3")!;
    return Math.sin(x1) + a * Math.sin(x2) ** 2 + b * x3 ** 4 * Math.sin(x1);
  };

  const res = computeSobolIndices(ishigami, ishigamiVars, {
    baseSamples: 2048,
    bootstrapResamples: 50,
    seed: 123,
  });

  assert.strictEqual(res.rigor, "statistical");
  assert.strictEqual(res.numEvaluations, 2048 * (3 + 2));

  const out = res.outputs.get("y")!;
  const [s1, s2, s3] = out.indices;

  // Analytical Ishigami indices:
  // S1 = 0.3139, S2 = 0.4424, S3 = 0.0
  // ST1 = 0.5576, ST2 = 0.4424, ST3 = 0.2437
  assert.ok(Math.abs(s1!.firstOrder - 0.3139) < 0.03, `Ishigami S1: ${s1!.firstOrder}`);
  assert.ok(Math.abs(s2!.firstOrder - 0.4424) < 0.03, `Ishigami S2: ${s2!.firstOrder}`);
  assert.ok(Math.abs(s3!.firstOrder - 0.0) < 0.03, `Ishigami S3: ${s3!.firstOrder}`);

  assert.ok(Math.abs(s1!.totalOrder - 0.5576) < 0.03, `Ishigami ST1: ${s1!.totalOrder}`);
  assert.ok(Math.abs(s2!.totalOrder - 0.4424) < 0.03, `Ishigami ST2: ${s2!.totalOrder}`);
  assert.ok(Math.abs(s3!.totalOrder - 0.2437) < 0.03, `Ishigami ST3: ${s3!.totalOrder}`);

  // x3 has pure interaction (S3 ~ 0, ST3 ~ 0.244)
  assert.ok(s3!.interaction > 0.2, `Ishigami x3 interaction should be > 0.2, got ${s3!.interaction}`);
  assert.deepStrictEqual(out.rankedByTotalOrder, ["x1", "x2", "x3"]);

  // Bootstrap CIs should bracket estimates
  assert.ok(s1!.firstOrderCI && s1!.firstOrderCI[0] < s1!.firstOrderCI[1]);
  assert.ok(s1!.totalOrderCI && s1!.totalOrderCI[0] < s1!.totalOrderCI[1]);

  console.log("✓ Ishigami global Sobol' sensitivity benchmark passed");
}

// 5. End-to-end DAEBuilder Arena tests: FOSM, Unscented (moment & isoprobabilistic), and Sobol'
{
  // Build exponential decay DAE: der(x) = -k * x, x(0) = 1.0, k = 1.0
  // Exact solution: x(t) = exp(-k * t)
  // For k ~ N(mu_k, sigma_k^2):
  //   exact E[x(t)]   = exp(-mu_k * t + 0.5 * sigma_k^2 * t^2)
  //   exact Var[x(t)] = exp(-2*mu_k*t + 2*sigma_k^2*t^2) - exp(-2*mu_k*t + sigma_k^2*t^2)
  //   FOSM  Var[x(t)] = (t * exp(-mu_k * t))^2 * sigma_k^2
  const arena = new DAEBuilder();
  arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.addVariable("der(x)", VarType.Real, Variability.Continuous, 0, 0.0);
  arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 1.0);

  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const kExpr = arena.addNameExpr("k");
  const rhs = arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr));
  arena.addEquation(EqKind.Simple, derX, rhs);

  const muK = 1.0;
  const sigmaK = 0.1;
  const tStop = 1.0;
  const randomVars: RandomVariable[] = [{ name: "k", distribution: { type: "gaussian", mean: muK, stddev: sigmaK } }];

  const simOpts = { startTime: 0, stopTime: tStop, step: 0.05 };
  const fosmArena = propagateFOSMArena(arena, randomVars, {
    simulateOptions: simOpts,
    includeFullCovariance: true,
  });
  const utArena = propagateUnscentedArena(arena, randomVars, {
    simulateOptions: simOpts,
    includeFullCovariance: true,
  });
  const utIsoArena = propagateUnscentedArena(arena, randomVars, {
    simulateOptions: simOpts,
    isoprobabilistic: true,
  });

  const lastFosm = fosmArena.t.length - 1;
  const exactFosmMean = Math.exp(-muK * tStop);
  const exactFosmStd = tStop * Math.exp(-muK * tStop) * sigmaK;
  const exactNonlinearMean = Math.exp(-muK * tStop + 0.5 * sigmaK * sigmaK * tStop * tStop);
  const exactNonlinearVar =
    Math.exp(-2 * muK * tStop + 2 * sigmaK * sigmaK * tStop * tStop) -
    Math.exp(-2 * muK * tStop + sigmaK * sigmaK * tStop * tStop);
  const exactNonlinearStd = Math.sqrt(exactNonlinearVar);

  assert.strictEqual(fosmArena.numEvaluations, 3); // 2*1 + 1
  assert.strictEqual(utArena.numEvaluations, 3); // 2*1 + 1

  assert.ok(
    Math.abs(fosmArena.mean[lastFosm]![0]! - exactFosmMean) < 1e-3,
    `Arena FOSM mean: ${fosmArena.mean[lastFosm]![0]} vs ${exactFosmMean}`,
  );
  assert.ok(
    Math.abs(fosmArena.stddev[lastFosm]![0]! - exactFosmStd) < 1e-3,
    `Arena FOSM std: ${fosmArena.stddev[lastFosm]![0]} vs ${exactFosmStd}`,
  );
  // Single parameter => variance contribution must be 1.0 at t > 0
  const kContrib = fosmArena.varianceContributions.get("x")!.get("k")![lastFosm]!;
  assert.ok(Math.abs(kContrib - 1.0) < 1e-6, `Single-param variance contribution should be 1, got ${kContrib}`);

  // UT captures the Jensen convexity shift in mean: E[exp(-k*t)] > exp(-E[k]*t)
  const lastUt = utArena.t.length - 1;
  assert.ok(
    Math.abs(utArena.mean[lastUt]![0]! - exactNonlinearMean) < 1e-3,
    `Arena UT mean: ${utArena.mean[lastUt]![0]} vs ${exactNonlinearMean}`,
  );
  assert.ok(
    Math.abs(utArena.stddev[lastUt]![0]! - exactNonlinearStd) < 1e-3,
    `Arena UT std: ${utArena.stddev[lastUt]![0]} vs ${exactNonlinearStd}`,
  );
  assert.ok(
    Math.abs(utIsoArena.mean[lastUt]![0]! - exactNonlinearMean) < 1e-3,
    `Arena isoprobabilistic UT mean: ${utIsoArena.mean[lastUt]![0]} vs ${exactNonlinearMean}`,
  );

  // Two-parameter Sobol' arena test: der(x) = -(k1 + 0.1*k2) * x
  const arena2 = new DAEBuilder();
  arena2.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena2.addVariable("der(x)", VarType.Real, Variability.Continuous, 0, 0.0);
  arena2.addVariable("k1", VarType.Real, Variability.Parameter, 0, 1.0);
  arena2.addVariable("k2", VarType.Real, Variability.Parameter, 0, 1.0);
  const x2Expr = arena2.addNameExpr("x");
  const rate = arena2.addBinaryExpr(
    BinOp.Add,
    arena2.addNameExpr("k1"),
    arena2.addBinaryExpr(BinOp.Mul, arena2.addRealLiteral(0.1), arena2.addNameExpr("k2")),
  );
  arena2.addEquation(
    EqKind.Simple,
    arena2.addDerExpr(x2Expr),
    arena2.addUnaryExpr(UnaryOp.Negate, arena2.addBinaryExpr(BinOp.Mul, rate, x2Expr)),
  );

  const sobolArena = computeSobolIndicesArena(
    arena2,
    [
      { name: "k1", distribution: { type: "uniform", lo: 0.5, hi: 1.5 } },
      { name: "k2", distribution: { type: "uniform", lo: 0.5, hi: 1.5 } },
    ],
    { baseSamples: 64, simulateOptions: { startTime: 0, stopTime: 1.0, step: 0.1 } },
  );

  const xSobol = sobolArena.outputs.get("x")!;
  assert.strictEqual(xSobol.rankedByTotalOrder[0], "k1", "k1 should dominate k2");
  assert.ok(xSobol.indices[0]!.firstOrder > 0.9, `k1 firstOrder should be > 0.9, got ${xSobol.indices[0]!.firstOrder}`);
  assert.ok(
    xSobol.indices[1]!.totalOrder < 0.05,
    `k2 totalOrder should be < 0.05, got ${xSobol.indices[1]!.totalOrder}`,
  );

  console.log("✓ End-to-end DAEBuilder Arena FOSM, UT, and Sobol' tests passed");
}

console.log("=== All Phase 1 Analytical UQ tests passed! ===");
