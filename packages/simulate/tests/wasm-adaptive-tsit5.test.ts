// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, EqKind, UnaryOp, VarType, Variability, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { simulateArena } from "../src/core/simulate-arena.js";

await initBltWasm();

console.log("=== Testing In-WASM DAE Adaptive Stepping Kernel (Tsit5) ===");

// 1. Harmonic Oscillator: x' = v, v' = -x, x(0) = 1, v(0) = 0
// Analytical: x(2*pi) = 1.0, v(2*pi) = 0.0
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(xIdx, 1.0);

  const vIdx = arena.addVariable("v", VarType.Real, Variability.Continuous, 0, 0.0);
  arena.setVarStartValue(vIdx, 0.0);

  const xExpr = arena.addNameExpr("x");
  const vExpr = arena.addNameExpr("v");
  const derX = arena.addDerExpr(xExpr);
  const derV = arena.addDerExpr(vExpr);

  // der(x) = v
  arena.addEquation(EqKind.Simple, derX, vExpr);
  // der(v) = -x
  const negX = arena.addUnaryExpr(UnaryOp.Negate, xExpr);
  arena.addEquation(EqKind.Simple, derV, negX);

  const tStart = 0.0;
  const tEnd = 2.0 * Math.PI;
  const steps = 100;
  const dt = (tEnd - tStart) / steps;

  const t0 = performance.now();
  const res = simulateArena(arena, {
    startTime: tStart,
    stopTime: tEnd,
    step: dt,
    solver: "tsit5",
    atol: 1e-8,
    rtol: 1e-8,
  });
  const elapsed = performance.now() - t0;

  assert.strictEqual(res.t.length, steps + 1, "Must generate exact number of output rows");
  const finalX = res.y[res.y.length - 1]![0]!;
  const finalV = res.y[res.y.length - 1]![1]!;

  console.log(`  ✓ Completed in ${elapsed.toFixed(2)}ms`);
  console.log(`  ✓ Final t=${res.t[res.t.length - 1]!.toFixed(4)}, x=${finalX.toFixed(7)}, v=${finalV.toFixed(7)}`);

  // High accuracy check against analytical solution (cos(2pi) = 1, sin(2pi) = 0)
  const errX = Math.abs(finalX - 1.0);
  const errV = Math.abs(finalV - 0.0);
  console.log(`  ✓ Position error: ${errX.toExponential(4)}, Velocity error: ${errV.toExponential(4)}`);

  assert.ok(errX < 1e-5, `Position error must be < 1e-5, got ${errX}`);
  assert.ok(errV < 1e-5, `Velocity error must be < 1e-5, got ${errV}`);
}

// 2. Harmonic Oscillator with Automated Solver Selection (solver: "auto")
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(xIdx, 1.0);

  const vIdx = arena.addVariable("v", VarType.Real, Variability.Continuous, 0, 0.0);
  arena.setVarStartValue(vIdx, 0.0);

  const xExpr = arena.addNameExpr("x");
  const vExpr = arena.addNameExpr("v");
  const derX = arena.addDerExpr(xExpr);
  const derV = arena.addDerExpr(vExpr);

  arena.addEquation(EqKind.Simple, derX, vExpr);
  arena.addEquation(EqKind.Simple, derV, arena.addUnaryExpr(UnaryOp.Negate, xExpr));

  const tStart = 0.0;
  const tEnd = 2.0 * Math.PI;
  const steps = 100;
  const dt = (tEnd - tStart) / steps;

  const t0 = performance.now();
  const res = simulateArena(arena, {
    startTime: tStart,
    stopTime: tEnd,
    step: dt,
    solver: "auto",
    atol: 1e-8,
    rtol: 1e-8,
  });
  const elapsed = performance.now() - t0;

  assert.strictEqual(res.t.length, steps + 1, "Must generate exact number of output rows");
  const finalX = res.y[res.y.length - 1]![0]!;
  const finalV = res.y[res.y.length - 1]![1]!;

  console.log(`  ✓ 'auto' solver in-WASM fast path completed in ${elapsed.toFixed(2)}ms`);
  const errX = Math.abs(finalX - 1.0);
  const errV = Math.abs(finalV - 0.0);
  console.log(`  ✓ Position error: ${errX.toExponential(4)}, Velocity error: ${errV.toExponential(4)}`);

  assert.ok(errX < 1e-5, `Position error must be < 1e-5, got ${errX}`);
  assert.ok(errV < 1e-5, `Velocity error must be < 1e-5, got ${errV}`);
}

console.log("=== In-WASM DAE Adaptive Stepping Kernel Verified Successfully ===");
