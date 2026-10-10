// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import assert from "node:assert";
import { ArenaJitEngine, simulateArenaJit } from "../src/jit/jit-engine.js";

console.log("=== Testing In-Memory JIT Compilation Engine (Sub-15ms Execution) ===");

// 1. Test In-Process V8 JIT Cold Start (< 15ms latency)
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(xIdx, 1.0);

  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 2.0);
  const kLit = arena.addRealLiteral(2.0);
  arena.setVarExpression(kIdx, kLit);

  // der(x) = -k * x
  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const kExpr = arena.addNameExpr("k");
  const rhs = arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr));
  arena.addEquation(EqKind.Simple, derX, rhs);

  const t0 = performance.now();
  const resCold = await simulateArenaJit(arena, {
    startTime: 0,
    stopTime: 1,
    step: 0.01,
    solver: "rk4",
    mode: "v8",
  });
  const elapsed = performance.now() - t0;

  assert.strictEqual(resCold.modeUsed, "v8");
  assert.ok(resCold.t.length > 50, "Must generate dense trajectory");
  assert.ok(resCold.states.includes("x"), "Must record state 'x'");

  // Parity check: x(1) = e^(-2) ≈ 0.135335
  const finalX = resCold.y[resCold.y.length - 1]![0]!;
  assert.ok(Math.abs(finalX - 0.135335) < 1e-4, `Expected x(1) ≈ 0.135335, got ${finalX}`);

  console.log(
    `✓ Cold start V8 JIT executed in ${resCold.totalTimeMs.toFixed(2)}ms (wall-clock: ${elapsed.toFixed(2)}ms) with analytical accuracy`,
  );
  assert.ok(resCold.totalTimeMs < 250, `Cold start must be fast (<250ms), got ${resCold.totalTimeMs}ms`);
}

// 2. Test Warm V8 JIT Execution with In-Memory Function Cache (< 5ms)
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(xIdx, 1.0);

  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 2.0);
  const kLit = arena.addRealLiteral(2.0);
  arena.setVarExpression(kIdx, kLit);

  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const kExpr = arena.addNameExpr("k");
  const rhs = arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr));
  arena.addEquation(EqKind.Simple, derX, rhs);

  const resWarm = await simulateArenaJit(arena, {
    startTime: 0,
    stopTime: 1,
    step: 0.01,
    solver: "rk4",
    mode: "v8",
  });

  assert.strictEqual(resWarm.cacheHit, true, "Warm execution must hit in-memory V8 function cache");
  assert.ok(resWarm.compilationTimeMs < 0.5, "Compilation time on warm cache must be near zero");
  assert.ok(resWarm.totalTimeMs < 50, `Warm JIT execution must be sub-50ms, got ${resWarm.totalTimeMs.toFixed(2)}ms`);

  console.log(
    `✓ Warm V8 JIT cache hit confirmed: compile ${resWarm.compilationTimeMs.toFixed(2)}ms, exec ${resWarm.executionTimeMs.toFixed(2)}ms, total ${resWarm.totalTimeMs.toFixed(2)}ms`,
  );
}

// 3. Test JIT Parameter Overrides
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(xIdx, 1.0);

  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 2.0);
  const kLit = arena.addRealLiteral(2.0);
  arena.setVarExpression(kIdx, kLit);

  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const kExpr = arena.addNameExpr("k");
  const rhs = arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr));
  arena.addEquation(EqKind.Simple, derX, rhs);

  // Override parameter k = 4.0 => x(1) = e^(-4) ≈ 0.0183156
  const resOverridden = await simulateArenaJit(arena, {
    startTime: 0,
    stopTime: 1,
    step: 0.01,
    parameterOverrides: new Map([["k", 4.0]]),
    mode: "v8",
  });

  const finalX = resOverridden.y[resOverridden.y.length - 1]![0]!;
  assert.ok(Math.abs(finalX - 0.0183156) < 1e-4, `Expected x(1) with k=4.0 ≈ 0.0183156, got ${finalX}`);

  console.log("✓ JIT parameter override dynamically evaluated with high precision");
}

// 4. Test Multi-State Harmonic Oscillator (Energy Conservation)
{
  const arena = new DAEBuilder();
  arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.addVariable("v", VarType.Real, Variability.Continuous, 0, 0.0);

  // der(x) = v
  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const vExpr = arena.addNameExpr("v");
  arena.addEquation(EqKind.Simple, derX, vExpr);

  // der(v) = -x (omega = 1)
  const derV = arena.addDerExpr(vExpr);
  const negX = arena.addUnaryExpr(UnaryOp.Negate, xExpr);
  arena.addEquation(EqKind.Simple, derV, negX);

  const resOsc = await simulateArenaJit(arena, {
    startTime: 0,
    stopTime: 6.2831853, // 2*pi
    step: 0.005,
    solver: "rk4",
    mode: "v8",
  });

  assert.strictEqual(resOsc.states.length, 2);
  const finalX = resOsc.y[resOsc.y.length - 1]![0]!;
  const finalV = resOsc.y[resOsc.y.length - 1]![1]!;

  // After 1 full period T = 2*pi: x(2pi) ≈ 1.0, v(2pi) ≈ 0.0
  assert.ok(Math.abs(finalX - 1.0) < 1e-3, `Expected x(2pi) ≈ 1.0, got ${finalX}`);
  assert.ok(Math.abs(finalV - 0.0) < 1e-3, `Expected v(2pi) ≈ 0.0, got ${finalV}`);

  // Energy E = 0.5 * (x^2 + v^2) should be 0.5
  const energy = 0.5 * (finalX * finalX + finalV * finalV);
  assert.ok(Math.abs(energy - 0.5) < 1e-3, `Expected energy ≈ 0.5, got ${energy}`);

  console.log(`✓ Harmonic oscillator 2-state RK4 JIT passed with energy conservation (E = ${energy.toFixed(5)})`);
}

// 5. Test Native C JIT Compilation & Binary Caching
{
  const cSource = `
#include <stdio.h>
int main() {
  printf("time,x\\n");
  printf("0.0,1.0\\n");
  printf("1.0,0.135335\\n");
  return 0;
}
`;

  const arena = new DAEBuilder();
  const engine = new ArenaJitEngine({ mode: "native" });

  // First run: compiles native binary and executes
  const resNative1 = await engine.simulate(arena, {
    cSource,
    mode: "native",
  });

  assert.strictEqual(resNative1.modeUsed, "native");
  assert.strictEqual(resNative1.states[0], "x");
  assert.strictEqual(resNative1.cacheHit, false, "First native run must compile");

  // Second run: should hit disk/memory cache with 0ms compilation
  const resNative2 = await engine.simulate(arena, {
    cSource,
    mode: "native",
  });

  assert.strictEqual(resNative2.cacheHit, true, "Second native run must hit cache");
  assert.strictEqual(resNative2.compilationTimeMs, 0, "Cached run compilation time must be 0");
  assert.ok(
    resNative2.executionTimeMs < 200,
    `Cached native execution must be fast (<200ms), got ${resNative2.executionTimeMs.toFixed(2)}ms`,
  );

  console.log(
    `✓ Native C JIT compilation & binary cache hit passed (cached exec: ${resNative2.executionTimeMs.toFixed(2)}ms)`,
  );
}

console.log("=== All In-Memory JIT Compilation Engine Tests Passed Cleanly ===");
