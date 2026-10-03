// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Comprehensive verification test suite for all 5 differential equation classes:
 *  1. ODE: Tsit5 on Harmonic Oscillator
 *  2. DAE: Rodas4P and TR-BDF2 on Robertson Stiff System
 *  3. SDE: Euler-Maruyama, SRIW1, and Ensemble Statistics on Ornstein-Uhlenbeck
 *  4. DDE: Method-of-Steps on Delayed Negative Feedback Oscillator
 *  5. BVP: Multiple Shooting and LGR Collocation on Two-Point Boundary Value Problem
 */

import type { BVPProblem, DDEProblem, ODEProblem, SDEProblem } from "../src/core/problem-types.js";
import { solveBvpCollocation, solveBvpShooting } from "../src/solvers/bvp-solver.js";
import { ddeSteps } from "../src/solvers/dde-solver.js";
import { rodas4p } from "../src/solvers/rodas4p.js";
import { eulerMaruyama, simulateSDEEnsemble, sriw1 } from "../src/solvers/sde-solver.js";
import { trbdf2 } from "../src/solvers/trbdf2.js";
import { solveODE } from "../src/solvers/tsit5.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runAllTests() {
  console.log("=================================================================");
  console.log(" ModelScript Unified Differential Equations Test Suite (5 Classes)");
  console.log("=================================================================");

  // ─────────────────────────────────────────────────────────────────
  // 1. ODE: Tsitouras 5(4) Adaptive Solver (Harmonic Oscillator)
  // ─────────────────────────────────────────────────────────────────
  console.log("\n[1/5] Testing ODE Class: Tsit5 Adaptive Solver...");
  {
    // dx/dt = v, dv/dt = -x. Exact: x(t) = cos(t), v(t) = -sin(t).
    const prob: ODEProblem = {
      f: (_t, y) => [y[1] ?? 0, -(y[0] ?? 0)],
      y0: [1.0, 0.0],
      tSpan: [0, 2 * Math.PI],
    };

    const res = solveODE(prob, { atol: 1e-7, rtol: 1e-7 });
    const finalState = res.states[res.states.length - 1]!;
    const finalT = res.times[res.times.length - 1]!;

    const errX = Math.abs(finalState[0]! - 1.0);
    const errV = Math.abs(finalState[1]! - 0.0);

    console.log(`  ✓ Completed in ${res.stats?.acceptedSteps} accepted steps (${res.stats?.rejectedSteps} rejected)`);
    console.log(`  ✓ Final t=${finalT.toFixed(4)}, x=${finalState[0]?.toFixed(6)}, v=${finalState[1]?.toFixed(6)}`);
    console.log(`  ✓ Position error: ${errX.toExponential(4)}, Velocity error: ${errV.toExponential(4)}`);

    assert(errX < 1e-4, `Tsit5 position error too large: ${errX}`);
    assert(errV < 1e-4, `Tsit5 velocity error too large: ${errV}`);
    assert(res.stats?.converged === true, "Tsit5 solver should converge");
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. DAE: Robertson Stiff Chemical Reaction (TR-BDF2 & Rodas4P)
  // ─────────────────────────────────────────────────────────────────
  console.log("\n[2/5] Testing Stiff DAE Class: TR-BDF2 & Rodas4P...");
  {
    // Robertson system:
    // dy1/dt = -0.04*y1 + 1e4*y2*y3
    // dy2/dt =  0.04*y1 - 1e4*y2*y3 - 3e7*y2^2
    // dy3/dt =  3e7*y2^2
    // Conservation: y1 + y2 + y3 = 1
    const robertson = (_t: number, y: number[]) => {
      const y1 = y[0] ?? 0;
      const y2 = y[1] ?? 0;
      const y3 = y[2] ?? 0;
      return [-0.04 * y1 + 1e4 * y2 * y3, 0.04 * y1 - 1e4 * y2 * y3 - 3e7 * y2 * y2, 3e7 * y2 * y2];
    };

    const y0 = [1.0, 0.0, 0.0];
    const tSpan: [number, number] = [0.0, 10.0];

    // Test TR-BDF2
    const resTrbdf2 = trbdf2(robertson, tSpan[0], y0, tSpan[1], undefined, {
      atol: 1e-5,
      rtol: 1e-4,
    });
    const finalTr = resTrbdf2.states[resTrbdf2.states.length - 1]!;
    const sumTr = (finalTr[0] ?? 0) + (finalTr[1] ?? 0) + (finalTr[2] ?? 0);
    console.log(`  ✓ TR-BDF2 completed in ${resTrbdf2.stats?.acceptedSteps} steps`);
    console.log(`  ✓ TR-BDF2 mass conservation sum=${sumTr.toFixed(8)} (target: 1.0)`);
    assert(Math.abs(sumTr - 1.0) < 1e-3, `TR-BDF2 mass conservation error: ${sumTr}`);

    // Test Rodas4P
    const resRodas = rodas4p(robertson, tSpan[0], y0, tSpan[1], undefined, {
      atol: 1e-5,
      rtol: 1e-4,
    });
    const finalRodas = resRodas.states[resRodas.states.length - 1]!;
    const sumRodas = (finalRodas[0] ?? 0) + (finalRodas[1] ?? 0) + (finalRodas[2] ?? 0);
    console.log(`  ✓ Rodas4P completed in ${resRodas.stats?.acceptedSteps} steps`);
    console.log(`  ✓ Rodas4P mass conservation sum=${sumRodas.toFixed(8)} (target: 1.0)`);
    assert(Math.abs(sumRodas - 1.0) < 1e-3, `Rodas4P mass conservation error: ${sumRodas}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. SDE: Ornstein-Uhlenbeck Stochastic Process
  // ─────────────────────────────────────────────────────────────────
  console.log("\n[3/5] Testing SDE Class: Euler-Maruyama, SRIW1 & Ensemble Statistics...");
  {
    // dx = -theta * (x - mu) * dt + sigma * dW
    // Mean -> mu, Var -> sigma^2 / (2*theta)
    const theta = 2.0;
    const mu = 5.0;
    const sigma = 0.5;

    const sdeProb: SDEProblem = {
      f: (_t, y) => [-theta * ((y[0] ?? 0) - mu)],
      g: (_t, _y) => [sigma],
      y0: [1.0], // starts away from mu
      tSpan: [0, 4.0],
      noiseType: "diagonal",
    };

    // Single trajectory: Euler-Maruyama
    const resEm = eulerMaruyama(sdeProb, { dt: 0.005, seed: 1234 });
    console.log(`  ✓ Euler-Maruyama trajectory computed ${resEm.times.length} points`);
    assert(resEm.times.length > 500, "Euler-Maruyama should produce trajectory points");

    // Single trajectory: SRIW1 Adaptive
    const resSriw1 = sriw1(sdeProb, { seed: 5678, atol: 1e-3 });
    console.log(`  ✓ SRIW1 adaptive trajectory computed in ${resSriw1.stats?.acceptedSteps} steps`);
    assert((resSriw1.stats?.acceptedSteps ?? 0) > 0, "SRIW1 should accept steps");

    // Ensemble Simulation (200 realizations)
    console.log("  ✓ Running SDE Ensemble of 200 paths for asymptotic mean and variance...");
    const ensemble = simulateSDEEnsemble(sdeProb, 200, { dt: 0.01, seed: 999 });
    const finalIdx = ensemble.times.length - 1;
    const meanFinal = ensemble.mean[finalIdx]?.[0] ?? 0;
    const varFinal = ensemble.variance[finalIdx]?.[0] ?? 0;
    const theoreticalVar = (sigma * sigma) / (2 * theta); // 0.25 / 4 = 0.0625

    console.log(`  ✓ Empirical mean at t=4: ${meanFinal.toFixed(4)} (Theoretical: ${mu})`);
    console.log(`  ✓ Empirical variance at t=4: ${varFinal.toFixed(4)} (Theoretical: ${theoreticalVar.toFixed(4)})`);

    assert(Math.abs(meanFinal - mu) < 0.25, `Ensemble mean deviated too much: ${meanFinal}`);
    assert(Math.abs(varFinal - theoreticalVar) < 0.04, `Ensemble variance deviated too much: ${varFinal}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. DDE: Method of Steps (Delayed Negative Feedback Oscillator)
  // ─────────────────────────────────────────────────────────────────
  console.log("\n[4/5] Testing DDE Class: Method-of-Steps with Ring Buffer & Breaking Points...");
  {
    // dx/dt = -x(t - 1), with history x(t) = 1 for t <= 0.
    // Constant delay tau = 1.0. Breaking points at t = 1.0, 2.0, 3.0...
    const tau = 1.0;
    const ddeProb: DDEProblem = {
      f: (t, y, history) => {
        const delayedState = history(t - tau);
        return [-(delayedState[0] ?? 0)];
      },
      h: (_t) => [1.0],
      y0: [1.0],
      tSpan: [0, 4.0],
      constantDelays: [tau],
    };

    const resDde = ddeSteps(ddeProb, { atol: 1e-6, rtol: 1e-6 });
    console.log(`  ✓ DDE Method-of-Steps finished with ${resDde.stats?.acceptedSteps} accepted steps`);

    // On t in [0, 1]: dx/dt = -1 => x(t) = 1 - t. So x(1) = 0.
    // On t in [1, 2]: dx/dt = -(1 - (t - 1)) = t - 2 => x(t) = 0 + (t^2/2 - 2t - (1/2 - 2)) = t^2/2 - 2t + 3/2.
    // At t = 2: x(2) = 2 - 4 + 1.5 = -0.5.
    let xAt1 = 0;
    let xAt2 = 0;
    for (let i = 0; i < resDde.times.length; i++) {
      const t = resDde.times[i]!;
      if (Math.abs(t - 1.0) < 1e-4) xAt1 = resDde.states[i]?.[0] ?? 0;
      if (Math.abs(t - 2.0) < 1e-4) xAt2 = resDde.states[i]?.[0] ?? 0;
    }

    console.log(`  ✓ Analytical check: x(1) = ${xAt1.toFixed(4)} (Expected: 0.0000)`);
    console.log(`  ✓ Analytical check: x(2) = ${xAt2.toFixed(4)} (Expected: -0.5000)`);

    assert(Math.abs(xAt1 - 0.0) < 1e-3, `DDE x(1) error: ${xAt1}`);
    assert(Math.abs(xAt2 - -0.5) < 1e-3, `DDE x(2) error: ${xAt2}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. BVP: Boundary Value Problem (Two-Point Linear Oscillator)
  // ─────────────────────────────────────────────────────────────────
  console.log("\n[5/5] Testing BVP Class: Collocation & Multiple Shooting...");
  {
    // y'' + y = 0 on [0, pi/2] with y(0) = 0 and y(pi/2) = 1.
    // System: dy1/dt = y2, dy2/dt = -y1.
    // Analytical solution: y1(t) = sin(t), y2(t) = cos(t).
    const bvpProb: BVPProblem = {
      f: (_t, y) => [y[1] ?? 0, -(y[0] ?? 0)],
      bc: (ya, yb) => [
        (ya[0] ?? 0) - 0.0, // y1(0) = 0
        (yb[0] ?? 0) - 1.0, // y1(pi/2) = 1
      ],
      yGuess: (t) => [t / (Math.PI / 2), 1.0], // linear initial guess
      tSpan: [0, Math.PI / 2],
    };

    // Method A: Direct Collocation
    const resColloc = solveBvpCollocation(bvpProb, { numIntervals: 20, tolerance: 1e-6 });
    console.log(`  ✓ Collocation converged: ${resColloc.stats?.converged}`);
    assert(resColloc.stats?.converged === true, "Collocation should converge");

    // Check midpoint t = pi/4 -> sin(pi/4) = 1/sqrt(2) ≈ 0.70710678
    const midIdxColloc = Math.floor(resColloc.times.length / 2);
    const yMidColloc = resColloc.states[midIdxColloc]?.[0] ?? 0;
    const expectedMid = Math.sin(resColloc.times[midIdxColloc]!);
    console.log(
      `  ✓ Collocation at t=${resColloc.times[midIdxColloc]?.toFixed(4)}: y1=${yMidColloc.toFixed(6)} (Exact sin: ${expectedMid.toFixed(6)})`,
    );
    assert(Math.abs(yMidColloc - expectedMid) < 1e-3, "Collocation solution error too high");

    // Method B: Multiple Shooting
    const resShooting = solveBvpShooting(bvpProb, { numIntervals: 10, tolerance: 1e-6 });
    console.log(`  ✓ Multiple Shooting converged: ${resShooting.stats?.converged}`);
    assert(resShooting.stats?.converged === true, "Multiple Shooting should converge");

    const midIdxShoot = Math.floor(resShooting.times.length / 2);
    const yMidShoot = resShooting.states[midIdxShoot]?.[0] ?? 0;
    const expectedMidShoot = Math.sin(resShooting.times[midIdxShoot]!);
    console.log(
      `  ✓ Shooting at t=${resShooting.times[midIdxShoot]?.toFixed(4)}: y1=${yMidShoot.toFixed(6)} (Exact sin: ${expectedMidShoot.toFixed(6)})`,
    );
    assert(Math.abs(yMidShoot - expectedMidShoot) < 1e-3, "Multiple shooting solution error too high");
  }

  console.log("\n=================================================================");
  console.log(" 🎉 ALL 5 DIFFERENTIAL EQUATION CLASSES VERIFIED SUCCESSFULLY!");
  console.log("=================================================================");
}

runAllTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
