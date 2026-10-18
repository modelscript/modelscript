// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, initBltWasm, Variability, VarType } from "@modelscript/runtime";
import assert from "node:assert";
import { simulateArena } from "../src/core/simulate-arena.js";
import { liqss2, qss1, qss2, qss3 } from "../src/solvers/qss-solver.js";

await initBltWasm();
console.log("=== Testing Quantized State System (QSS1, QSS2, QSS3, LIQSS2) Integrators ===");

// 1. Harmonic Oscillator: dx/dt = v, dv/dt = -x, x(0) = 1, v(0) = 0 -> x(t) = cos(t), v(t) = -sin(t)
{
  const f = (_t: number, y: number[]) => [y[1] ?? 0, -(y[0] ?? 0)];
  const outputTimes = [0, 0.5, 1.0, 1.5, 2.0];

  const resQss1 = qss1(f, 0, [1, 0], 2.0, outputTimes, { rtol: 1e-3, atol: 1e-4 });
  const resQss2 = qss2(f, 0, [1, 0], 2.0, outputTimes, { rtol: 1e-4, atol: 1e-5 });
  const resQss3 = qss3(f, 0, [1, 0], 2.0, outputTimes, { rtol: 1e-4, atol: 1e-5 });

  const xExact = Math.cos(2.0);
  const err1 = Math.abs(resQss1.states[4]![0]! - xExact);
  const err2 = Math.abs(resQss2.states[4]![0]! - xExact);
  const err3 = Math.abs(resQss3.states[4]![0]! - xExact);

  assert.ok(err1 < 2e-2, `QSS1 harmonic oscillator error ${err1} must be < 2e-2`);
  assert.ok(err2 < 2e-3, `QSS2 harmonic oscillator error ${err2} must be < 2e-3`);
  assert.ok(err3 < 2e-3, `QSS3 harmonic oscillator error ${err3} must be < 2e-3`);
  assert.ok(
    resQss2.stats.quantumCrossings < resQss1.stats.quantumCrossings,
    "Higher-order QSS2 must require fewer quantum crossings than QSS1",
  );
  console.log(
    `✓ QSS1/QSS2/QSS3 harmonic oscillator passed (crossings: QSS1=${resQss1.stats.quantumCrossings}, QSS2=${resQss2.stats.quantumCrossings}, QSS3=${resQss3.stats.quantumCrossings})`,
  );
}

// 2. Stiff Linear System with LIQSS2: dy1/dt = -500 * y1 + 500, y1(0) = 0 -> y1(t) = 1 - exp(-500*t)
{
  const stiffRhs = (_t: number, y: number[]) => [-500 * (y[0] ?? 0) + 500];
  const resLiqss2 = liqss2(stiffRhs, 0, [0], 1.0, [0, 0.1, 0.5, 1.0], {
    rtol: 1e-3,
    atol: 1e-4,
  });
  const finalVal = resLiqss2.states[3]![0]!;
  assert.ok(Math.abs(finalVal - 1.0) < 5e-3, `LIQSS2 stiff steady state ${finalVal} must converge to 1.0`);
  assert.ok(
    resLiqss2.stats.quantumCrossings < 500,
    `LIQSS2 must avoid stiff chattering (crossings=${resLiqss2.stats.quantumCrossings})`,
  );
  console.log(`✓ Stiff LIQSS2 solver converged without chattering (${resLiqss2.stats.quantumCrossings} crossings)`);
}

// 3. End-to-End `simulateArena` with QSS2, `vectorCausalize: true`, and `microModelica: true`
{
  const arena = new DAEBuilder();
  const N = 4;
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  arena.setVarShape(xIdx, [N]);
  arena.setVarShape(yIdx, [N]);

  const iId = arena.interner.intern("i");
  // Alias loop: for i in 1:4 loop y[i] = x[i]; end for;
  const r1 = arena.addRange(arena.addIntLiteral(1), arena.addIntLiteral(N));
  const f1 = arena.addForEquation(iId, r1);
  arena.addForBodyEquation(
    f1,
    EqKind.Simple,
    arena.addSubscriptExpr(arena.addNameExpr("y"), [arena.addNameExpr("i")]),
    arena.addSubscriptExpr(arena.addNameExpr("x"), [arena.addNameExpr("i")]),
  );

  // ODE loop: for i in 1:4 loop der(x[i]) = -y[i]; end for;
  const r2 = arena.addRange(arena.addIntLiteral(1), arena.addIntLiteral(N));
  const f2 = arena.addForEquation(iId, r2);
  arena.addForBodyEquation(
    f2,
    EqKind.Simple,
    arena.addDerExpr(arena.addSubscriptExpr(arena.addNameExpr("x"), [arena.addNameExpr("i")])),
    arena.addBinaryExpr(
      BinOp.Mul,
      arena.addRealLiteral(-1.0),
      arena.addSubscriptExpr(arena.addNameExpr("y"), [arena.addNameExpr("i")]),
    ),
  );

  const simRes = simulateArena(arena, {
    startTime: 0,
    stopTime: 1.0,
    step: 0.25,
    solver: "qss2",
    vectorCausalize: true,
    microModelica: true,
  });

  assert.strictEqual(simRes.states.length, N, "All 4 state components x[1..4] must be simulated");
  const finalRow = simRes.y[simRes.y.length - 1]!;
  for (let i = 0; i < N; i++) {
    const err = Math.abs(finalRow[i]! - Math.exp(-1.0));
    assert.ok(err < 5e-3, `State x[${i + 1}](1.0) = ${finalRow[i]} must match exp(-1) within 5e-3`);
  }
  console.log("✓ simulateArena with solver='qss2', vectorCausalize=true, microModelica=true passed");
}

console.log("All QSS1/QSS2/QSS3/LIQSS2 unit and arena integration tests passed!");
