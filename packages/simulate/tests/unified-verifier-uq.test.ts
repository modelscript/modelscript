// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, PBox, UnaryOp, VarType, Variability, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { UnifiedVerifier } from "../src/verification/unified-verifier.js";

await initBltWasm();

console.log("=== Testing UnifiedVerifier Stage 11 (UQ & Probabilistic Verification) ===");

// 1. Rigorous P-Box Stage: certified when proven, failed when violated, uncertified when inconclusive
{
  const stressBox = PBox.fromNormalRange(40, 42, 1.5, 2.0, 64, 1e-6);

  // Proven case
  const reportProven = await UnifiedVerifier.verify(
    {
      uqConfig: {
        method: "pbox",
        pboxDistributions: new Map([["stress", stressBox]]),
        requirements: [{ state: "stress", operator: ">", threshold: 60.0, maxProbability: 1e-3 }],
      },
    },
    { all: false, uq: true },
  );
  const uqProven = reportProven.stages["uq"]!;
  assert.strictEqual(uqProven.passed, true);
  assert.strictEqual(uqProven.certified, true, "Rigorous P-box proof must emit certified=true");

  // Violated case
  const reportViolated = await UnifiedVerifier.verify(
    {
      uqConfig: {
        method: "pbox",
        pboxDistributions: new Map([["stress", stressBox]]),
        requirements: [{ state: "stress", operator: ">", threshold: 30.0, maxProbability: 0.1 }],
      },
    },
    { all: false, uq: true },
  );
  const uqViolated = reportViolated.stages["uq"]!;
  assert.strictEqual(uqViolated.passed, false);
  assert.strictEqual(uqViolated.certified, false);
  assert.ok((uqViolated.violations?.length ?? 0) === 1);

  // Inconclusive case
  const reportInconclusive = await UnifiedVerifier.verify(
    {
      uqConfig: {
        method: "pbox",
        pboxDistributions: new Map([["stress", stressBox]]),
        requirements: [{ state: "stress", operator: ">", threshold: 41.0, maxProbability: 0.5 }],
      },
    },
    { all: false, uq: true },
  );
  const uqInc = reportInconclusive.stages["uq"]!;
  assert.strictEqual(uqInc.passed, true);
  assert.strictEqual(uqInc.certified, false, "Inconclusive P-box must NOT be certified");

  console.log("✓ UnifiedVerifier rigorous P-box stage (proven / violated / inconclusive) passed");
}

// 2. Arena Analytical & Reliability Stages (Unscented, FOSM, FORM) — strictly certified: false
{
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

  // Safe requirement: P(x(1) <= 0.1) <= 0.01 (for k ~ N(1, 0.1), x(1) ~ 0.37 +/- 0.037)
  const reportUt = await UnifiedVerifier.verify(
    {
      arena,
      uqConfig: {
        method: "unscented",
        randomVars: [{ name: "k", distribution: { type: "gaussian", mean: 1.0, stddev: 0.1 } }],
        requirements: [{ state: "x", operator: "<=", threshold: 0.1, maxProbability: 0.01 }],
        simulateOptions: { startTime: 0, stopTime: 1.0, step: 0.05 },
      },
    },
    { all: false, uq: true },
  );
  const uqUt = reportUt.stages["uq"]!;
  assert.strictEqual(uqUt.passed, true);
  assert.strictEqual(uqUt.certified, false, "Approximate UT stage must NEVER emit certified=true");

  // Breached requirement via FORM: P(x(1) <= 0.35) <= 0.01 (actual Pf ~ 0.31)
  const reportFormFail = await UnifiedVerifier.verify(
    {
      arena,
      uqConfig: {
        method: "form",
        randomVars: [{ name: "k", distribution: { type: "gaussian", mean: 1.0, stddev: 0.15 } }],
        requirements: [{ state: "x", operator: "<=", threshold: 0.35, maxProbability: 0.01 }],
        simulateOptions: { startTime: 0, stopTime: 1.0, step: 0.05 },
      },
    },
    { all: false, uq: true },
  );
  const uqForm = reportFormFail.stages["uq"]!;
  assert.strictEqual(uqForm.passed, false, "FORM should detect breached probabilistic requirement");
  assert.strictEqual(uqForm.certified, false);
  assert.ok((uqForm.violations?.length ?? 0) === 1);

  // Direct DAEBuilder Arena -> Rigorous P-Box certification via UnifiedVerifier!
  const reportArenaPbox = await UnifiedVerifier.verify(
    {
      arena,
      uqConfig: {
        method: "pbox",
        randomVars: [{ name: "k", distribution: { type: "uniform", lo: 0.8, hi: 1.2 } }],
        requirements: [{ state: "x", operator: ">", threshold: 1.5, maxProbability: 0.01 }],
        simulateOptions: { startTime: 0, stopTime: 1.0, step: 0.05 },
      },
    },
    { all: false, uq: true },
  );
  const uqArenaPbox = reportArenaPbox.stages["uq"]!;
  assert.strictEqual(uqArenaPbox.passed, true);
  assert.strictEqual(uqArenaPbox.certified, true, "Direct arena P-box flowpipe proof must emit certified=true");

  console.log("✓ UnifiedVerifier Arena UT, FORM & direct P-Box flowpipe stages passed");
}

console.log("=== All UnifiedVerifier UQ integration tests passed! ===");
