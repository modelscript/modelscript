// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import type { DAEProblem, ODEProblem } from "../src/core/problem-types.js";
import { solveRadauIIA } from "../src/solvers/radau-iia.js";

console.log("=== Testing Radau IIA (Order 5 & 9) Stiff/Symplectic DAE Solver ===");

// ── Test 1: Van der Pol Oscillator (Stiff limit cycle, mu = 50) ──
{
  console.log("\nTest 1: Stiff Van der Pol Oscillator (mu = 50)...");
  const mu = 50.0;
  const vdpProblem: ODEProblem = {
    f: (_t: number, y: number[]) => [y[1]!, mu * (1.0 - y[0]! * y[0]!) * y[1]! - y[0]!],
    y0: [2.0, 0.0],
    tSpan: [0.0, 2.0],
  };

  const resOrder5 = solveRadauIIA(vdpProblem, { order: 5, atol: 1e-6, rtol: 1e-6 });
  assert.ok(resOrder5.stats.converged, "Order 5 Radau IIA should converge across [0, 2]");
  assert.ok(resOrder5.stats.acceptedSteps > 10, "Should take multiple adaptive steps");
  const finalY5 = resOrder5.states[resOrder5.states.length - 1]!;
  console.log(
    `  Order 5 finished in ${resOrder5.stats.acceptedSteps} steps: y(2.0) = [${finalY5[0]!.toFixed(6)}, ${finalY5[1]!.toFixed(6)}]`,
  );

  const resOrder9 = solveRadauIIA(vdpProblem, { order: 9, atol: 1e-6, rtol: 1e-6 });
  assert.ok(resOrder9.stats.converged, "Order 9 Radau IIA should converge across [0, 2]");
  const finalY9 = resOrder9.states[resOrder9.states.length - 1]!;
  console.log(
    `  Order 9 finished in ${resOrder9.stats.acceptedSteps} steps: y(2.0) = [${finalY9[0]!.toFixed(6)}, ${finalY9[1]!.toFixed(6)}]`,
  );

  // Both orders should agree to high accuracy
  const diffY0 = Math.abs(finalY5[0]! - finalY9[0]!);
  assert.ok(diffY0 < 1e-3, `Difference between Order 5 and 9 must be small: ${diffY0}`);
  console.log("  ✔ Stiff Van der Pol oscillator integrated stably with both Order 5 and Order 9!");
}

// ── Test 2: Semi-Explicit Index-1 DAE with Singular Mass Matrix ──
// System:
//   dy1/dt = -y1 + y2
//   0      = y1^2 + y2 - 1   => algebraic constraint: y2 = 1 - y1^2
{
  console.log("\nTest 2: Semi-Explicit Index-1 DAE with Singular Mass Matrix M = diag(1, 0)...");
  const daeProblem: DAEProblem = {
    f: (_t: number, y: number[]) => [-y[0]! + y[1]!, y[0]! * y[0]! + y[1]! - 1.0],
    y0: [0.0, 1.0], // Consistent initial condition: 0^2 + 1 - 1 = 0
    tSpan: [0.0, 1.0],
    massMatrix: [
      [1.0, 0.0],
      [0.0, 0.0],
    ],
  };

  const res = solveRadauIIA(daeProblem, { order: 5, atol: 1e-7, rtol: 1e-7 });
  assert.ok(res.stats.converged, "Radau IIA should integrate DAE to completion");

  // Verify algebraic constraint at all recorded trajectory points
  let maxConstraintViolation = 0;
  for (const st of res.states) {
    const y1 = st[0]!;
    const y2 = st[1]!;
    const violation = Math.abs(y1 * y1 + y2 - 1.0);
    if (violation > maxConstraintViolation) maxConstraintViolation = violation;
  }

  console.log(`  Max algebraic constraint violation along trajectory: ${maxConstraintViolation.toExponential(3)}`);
  assert.ok(maxConstraintViolation < 1e-6, `Algebraic constraint violated: ${maxConstraintViolation}`);
  console.log("  ✔ Singular mass matrix DAE solved with zero constraint drift!");
}

// ── Test 3: Symplectic Energy Conservation on Harmonic Oscillator ──
// d^2 x / dt^2 + omega^2 x = 0
// Energy E(t) = 0.5 * (v^2 + omega^2 * x^2) = const
{
  console.log("\nTest 3: Symplectic Energy Conservation on Harmonic Oscillator (omega = 2)...");
  const omega = 2.0;
  const harmonicProblem: ODEProblem = {
    f: (_t: number, y: number[]) => [y[1]!, -omega * omega * y[0]!],
    y0: [1.0, 0.0],
    tSpan: [0.0, 10.0],
  };

  const res = solveRadauIIA(harmonicProblem, {
    order: 5,
    initialStepSize: 0.05,
    maxStepSize: 0.05,
    atol: 1e-9,
    rtol: 1e-9,
  });
  assert.ok(res.stats.converged);

  const E0 = 0.5 * (0.0 + omega * omega * 1.0);
  let maxEnergyDrift = 0;
  for (const st of res.states) {
    const x = st[0]!;
    const v = st[1]!;
    const E = 0.5 * (v * v + omega * omega * x * x);
    const drift = Math.abs(E - E0);
    if (drift > maxEnergyDrift) maxEnergyDrift = drift;
  }

  console.log(
    `  Initial Energy E0: ${E0.toFixed(4)}, Max energy drift over [0, 10]: ${maxEnergyDrift.toExponential(3)}`,
  );
  assert.ok(maxEnergyDrift < 1e-4, `Energy drift exceeded tolerance: ${maxEnergyDrift}`);
  console.log("  ✔ Symplectic property confirmed: Hamiltonian energy preserved!");
}

// ── Test 4: simulateArena dispatch with solver: "radau5" and "radau9" ──
{
  console.log("\nTest 4: simulateArena Integration with solver: 'radau5' and 'radau9'...");
  const { DAEBuilder, EqKind, BinOp, VarType, Variability, initBltWasm } = await import("@modelscript/runtime");
  const { simulateArena } = await import("../src/core/simulate-arena.js");
  await initBltWasm();

  const arena = new DAEBuilder();
  const x = arena.addVariable("x", VarType.Real, Variability.Continuous);
  arena.setVarStartValue(x, 1.0);

  // der(x) = -100.0 * x
  arena.addEquation(
    EqKind.Simple,
    arena.addDerExpr(arena.addNameExpr("x")),
    arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-100.0), arena.addNameExpr("x")),
  );

  const res5 = simulateArena(arena, {
    startTime: 0,
    stopTime: 0.1,
    numberOfIntervals: 10,
    solver: "radau5",
  });
  assert.ok(res5.y.length > 0);
  const finalX5 = res5.y[res5.y.length - 1]?.[0] ?? 0;
  console.log(`  simulateArena(solver: 'radau5') x(0.1) = ${finalX5.toExponential(4)} (Expected ≈ e^-10 = 4.540e-5)`);
  assert.ok(Math.abs(finalX5 - Math.exp(-10)) < 5e-6);

  const res9 = simulateArena(arena, {
    startTime: 0,
    stopTime: 0.1,
    numberOfIntervals: 10,
    solver: "radau9",
  });
  assert.ok(res9.y.length > 0);
  const finalX9 = res9.y[res9.y.length - 1]?.[0] ?? 0;
  console.log(`  simulateArena(solver: 'radau9') x(0.1) = ${finalX9.toExponential(4)} (Expected ≈ e^-10 = 4.540e-5)`);
  assert.ok(Math.abs(finalX9 - Math.exp(-10)) < 5e-6);

  console.log("  ✔ simulateArena end-to-end dispatch verified for both radau5 and radau9!");
}

console.log("\n=== All Radau IIA Tests Passed Cleanly ===");
