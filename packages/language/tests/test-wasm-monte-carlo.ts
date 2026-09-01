// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import {
  ArenaDAEBuilder,
  BinOp,
  EqKind,
  StaticTapeBuilder,
  TapeOpKind,
  UnaryOp,
  VarType,
  Variability,
} from "../src/compiler/index.js";
import {
  SobolSequence,
  WasmMonteCarloEngine,
  Xoshiro256pp,
  betaQuantile,
  latinHypercubeSample,
  lgamma,
  normalQuantile,
  runMonteCarloArena,
  runMonteCarloTape,
  runSensitivityAnalysisArena,
  sobolSample,
  type RandomVariable,
} from "../src/runtime/wasm_monte_carlo.js";

console.log("=== Testing WASM Monte Carlo & Uncertainty Quantification Engine ===");

// 1. Test Xoshiro256pp PRNG
{
  const rng1 = new Xoshiro256pp(42);
  const rng2 = new Xoshiro256pp(42);

  for (let i = 0; i < 100; i++) {
    const val1 = rng1.random();
    const val2 = rng2.random();
    assert.strictEqual(val1, val2, "Identical seeds must produce identical random streams");
    assert.ok(val1 >= 0 && val1 < 1, "Random values must be in [0, 1)");
  }

  // Check Gaussian distribution mean ~ 0, stddev ~ 1
  const N = 10000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < N; i++) {
    const g = rng1.randn();
    sum += g;
    sumSq += g * g;
  }
  const mean = sum / N;
  const variance = sumSq / N - mean * mean;
  assert.ok(Math.abs(mean) < 0.05, `Gaussian mean should be ~0, got ${mean}`);
  assert.ok(Math.abs(variance - 1.0) < 0.08, `Gaussian variance should be ~1, got ${variance}`);

  console.log("✓ Xoshiro256pp PRNG and Gaussian generator passed");
}

// 2. Test SobolSequence Quasi-Monte Carlo
{
  const dim = 3;
  const sobol = new SobolSequence(dim);
  const points: number[][] = [];

  for (let i = 0; i < 100; i++) {
    const pt = sobol.next();
    assert.strictEqual(pt.length, dim);
    for (let d = 0; d < dim; d++) {
      assert.ok(pt[d]! >= 0 && pt[d]! <= 1, "Sobol points must be in [0, 1]");
    }
    points.push(pt);
  }

  const rv: RandomVariable[] = [
    { name: "x", distribution: { type: "uniform", lo: 10, hi: 20 } },
    { name: "y", distribution: { type: "gaussian", mean: 5, stddev: 1 } },
  ];
  const samples = sobolSample(rv, 50);
  assert.strictEqual(samples.length, 50);
  for (const s of samples) {
    assert.ok(s.has("x") && s.has("y"));
    assert.ok(s.get("x")! >= 10 && s.get("x")! <= 20);
  }

  console.log("✓ SobolSequence quasi-random sampler passed");
}

// 3. Test Latin Hypercube Sampling (LHS)
{
  const rng = new Xoshiro256pp(12345);
  const rv: RandomVariable[] = [
    { name: "p1", distribution: { type: "uniform", lo: 0, hi: 100 } },
    { name: "p2", distribution: { type: "uniform", lo: -10, hi: 10 } },
  ];
  const N = 20;
  const lhsSamples = latinHypercubeSample(rv, N, rng);
  assert.strictEqual(lhsSamples.length, N);

  // Check stratification for p1
  const p1Vals = lhsSamples.map((s) => s.get("p1")!).sort((a, b) => a - b);
  for (let i = 0; i < N; i++) {
    const loBound = (i * 100) / N;
    const hiBound = ((i + 1) * 100) / N;
    assert.ok(
      p1Vals[i]! >= loBound && p1Vals[i]! <= hiBound,
      `LHS stratum ${i} out of bounds: ${p1Vals[i]} not in [${loBound}, ${hiBound}]`,
    );
  }

  console.log("✓ Latin Hypercube Sampling stratification passed");
}

// 4. Test Special Functions & Quantiles (normalQuantile, betaQuantile, lgamma)
{
  // Normal quantiles
  assert.strictEqual(normalQuantile(0.5), 0);
  assert.ok(Math.abs(normalQuantile(0.975) - 1.95996) < 1e-4, "normalQuantile(0.975) should be ~1.96");
  assert.ok(Math.abs(normalQuantile(0.025) - -1.95996) < 1e-4, "normalQuantile(0.025) should be ~ -1.96");

  // lgamma values (Gamma(n) = (n-1)!)
  // Gamma(5) = 24 -> lgamma(5) = ln(24) ~ 3.1780538
  assert.ok(Math.abs(lgamma(5) - Math.log(24)) < 1e-6, "lgamma(5) should be ln(24)");
  // Gamma(1) = 1 -> lgamma(1) = 0
  assert.ok(Math.abs(lgamma(1)) < 1e-6, "lgamma(1) should be 0");

  // Regularized beta & beta quantile
  const bMed = betaQuantile(0.5, 2, 2);
  assert.ok(Math.abs(bMed - 0.5) < 1e-4, "Median of Beta(2,2) should be 0.5");

  console.log("✓ Special functions and quantile computations passed");
}

// 5. Test Static Tape Monte Carlo Batch Evaluation
{
  const tape = new StaticTapeBuilder();
  const aIdx = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("a"));
  const bIdx = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("b"));
  const sumIdx = tape.pushScalarOp(TapeOpKind.Add, aIdx, bIdx); // a + b

  const rv: RandomVariable[] = [
    { name: "a", distribution: { type: "uniform", lo: 1, hi: 3 } }, // mean = 2, var = 4/12 = 1/3
    { name: "b", distribution: { type: "uniform", lo: 3, hi: 5 } }, // mean = 4, var = 4/12 = 1/3
  ];

  const result = runMonteCarloTape(tape, rv, sumIdx, { numSamples: 2000, seed: 999 });
  assert.ok(Math.abs(result.mean - 6.0) < 0.1, `Expected sum mean ~6.0, got ${result.mean}`);
  assert.ok(Math.abs(result.variance - 2 / 3) < 0.1, `Expected sum variance ~0.666, got ${result.variance}`);
  assert.ok(result.ciLo < result.mean && result.ciHi > result.mean);

  console.log("✓ Tape Monte Carlo batch evaluation passed");
}

import { initBltWasm } from "../src/runtime/wasm_blt.js";
await initBltWasm();

// 6. Test Arena DAE Monte Carlo Sweep & Sensitivity Analysis
{
  const arena = new ArenaDAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(xIdx, 1.0);

  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 2.0);
  const kLit = arena.addRealLiteral(2.0);
  arena.setVarExpression(kIdx, kLit);

  // der(x) = -k * x
  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const kExpr = arena.addNameExpr("k");
  const rhs = arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr)); // -k*x
  arena.addEquation(EqKind.Simple, derX, rhs);

  const rv: RandomVariable[] = [{ name: "k", distribution: { type: "uniform", lo: 1.0, hi: 3.0 } }];

  const mcResult = runMonteCarloArena(arena, rv, {
    numSamples: 50,
    seed: 42,
    simulateOptions: { startTime: 0, stopTime: 1, step: 0.1 },
  });

  assert.strictEqual(mcResult.numSamples, 50);
  const xStats = mcResult.statistics.get("x");
  assert.ok(xStats, "Should compute statistics for state 'x'");
  assert.ok(xStats!.mean.length > 0);

  // Sensitivity Analysis
  const nominals = new Map<string, number>([["k", 2.0]]);
  const sens = runSensitivityAnalysisArena(arena, ["k"], nominals, 0.01, {
    startTime: 0,
    stopTime: 1,
    step: 0.1,
  });

  assert.ok(sens.sensitivities.has("k"));
  const kSens = sens.sensitivities.get("k")!;
  assert.ok(kSens.has("x"), "Should compute sensitivity of x with respect to k");

  console.log("✓ Arena DAE Monte Carlo sweep and sensitivity analysis passed");
}

// 7. Test WasmMonteCarloEngine Wrapper
{
  const engine = new WasmMonteCarloEngine();
  const rng = engine.createRng(777);
  const s = engine.sample({ type: "gaussian", mean: 100, stddev: 10 }, rng);
  assert.ok(!isNaN(s), "Engine sample should return valid number");

  const sobol = engine.createSobol(4);
  const pt = sobol.next();
  assert.strictEqual(pt.length, 4);

  console.log("✓ WasmMonteCarloEngine wrapper API passed");
}

console.log("=== All WASM Monte Carlo & UQ Tests Passed Cleanly ===");
