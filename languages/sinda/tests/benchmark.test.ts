// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STEFAN_BOLTZMANN, parseSindaDeck, solveSindaSteadyState, solveSindaTransient } from "../src/index.js";

function computeRmse(computed: number[], exact: number[]): number {
  let sumSq = 0;
  for (let i = 0; i < computed.length; i++) {
    const diff = computed[i]! - exact[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / Math.max(1, computed.length));
}

describe("@modelscript/sinda — Analytical Heat Transfer Verification Benchmarks", () => {
  it("Benchmark 1: 1D composite wall conduction analytical steady-state parity (STDSTL)", () => {
    // 3-layer composite wall between hot boundary T_hot = 500 K and cold boundary T_cold = 300 K:
    //   Layer 1: G1 = 10 W/K (R1 = 0.1 K/W)
    //   Layer 2: G2 = 5 W/K  (R2 = 0.2 K/W)
    //   Layer 3: G3 = 2.5 W/K (R3 = 0.4 K/W)
    // Total R = 0.7 K/W, steady heat flux Q = (500 - 300) / 0.7 = 285.714285714 W
    // Exact interface temperatures:
    //   T_1 = 500 - Q * R1 = 471.428571429 K
    //   T_2 = 500 - Q * (R1 + R2) = 414.285714286 K
    const deck = `
HEADER OPTIONS DATA
  TITLE = "1D Composite Wall Conduction"
HEADER NODE DATA
  -1, 500.0, 0.0   $ hot boundary
   2, 400.0, 0.0   $ interface 1 (arithmetic)
   3, 350.0, 0.0   $ interface 2 (arithmetic)
  -4, 300.0, 0.0   $ cold boundary
HEADER CONDUCTOR DATA
  10, 1, 2, 10.0
  20, 2, 3, 5.0
  30, 3, 4, 2.5
HEADER EXECUTION
  CALL STDSTL
END OF DATA
`;

    const model = parseSindaDeck(deck);
    const res = solveSindaSteadyState(model);
    assert.equal(res.converged, true);

    const qExact = (500.0 - 300.0) / (0.1 + 0.2 + 0.4);
    const t2Exact = 500.0 - qExact * 0.1;
    const t3Exact = 500.0 - qExact * 0.3;

    const t2 = res.temperatures.get(2)!;
    const t3 = res.temperatures.get(3)!;
    const q10 = res.conductorHeatFlows.get(10)!;

    const relErrT2 = Math.abs(t2 - t2Exact) / t2Exact;
    const relErrT3 = Math.abs(t3 - t3Exact) / t3Exact;
    const relErrQ = Math.abs(q10 - qExact) / qExact;
    const rmse = computeRmse([t2, t3], [t2Exact, t3Exact]);

    assert.ok(relErrT2 < 1e-9, `Expected relErr(T2) < 1e-9, got ${relErrT2}`);
    assert.ok(relErrT3 < 1e-9, `Expected relErr(T3) < 1e-9, got ${relErrT3}`);
    assert.ok(relErrQ < 1e-9, `Expected relErr(Q) < 1e-9, got ${relErrQ}`);
    assert.ok(rmse < 1e-7, `Expected RMSE < 1e-7 K, got ${rmse}`);
  });

  it("Benchmark 2: Lumped-capacitance RC exponential cooling T(t) = T_inf + (T0 - T_inf) * exp(-t/tau) parity (CRANKN & RK4)", () => {
    // C = 100 J/K, G = 2 W/K => tau = C / G = 50 s
    // T0 = 400 K, T_inf = 300 K
    const T0 = 400.0;
    const Tinf = 300.0;
    const tau = 50.0;

    const deck = `
HEADER OPTIONS DATA
  TITLE = "Lumped Capacitance RC Cooling"
HEADER NODE DATA
   1, 400.0, 100.0  $ lumped mass C = 100 J/K
  -2, 300.0, 0.0    $ ambient sink T_inf = 300 K
HEADER CONDUCTOR DATA
  10, 1, 2, 2.0     $ G = 2 W/K
HEADER CONSTANTS DATA
  TIMEO = 0.0, TIMEND = 150.0, DTIMEI = 0.5
HEADER EXECUTION
  CALL CRANKN
END OF DATA
`;

    const model = parseSindaDeck(deck);

    // 1. Implicit Crank-Nicolson (CRANKN)
    const cn = solveSindaTransient(model, { method: "CRANKN" });
    const cnTemps = cn.temperatures.get(1)!;
    const exactTemps = cn.times.map((t) => Tinf + (T0 - Tinf) * Math.exp(-t / tau));
    const cnRmse = computeRmse(cnTemps, exactTemps);
    const cnFinalRelErr = Math.abs(cn.finalTemperatures.get(1)! - exactTemps.at(-1)!) / exactTemps.at(-1)!;

    assert.ok(cnRmse < 5e-3, `Expected CRANKN RMSE < 5e-3 K, got ${cnRmse}`);
    assert.ok(cnFinalRelErr < 1e-4, `Expected CRANKN final relErr < 1e-4, got ${cnFinalRelErr}`);

    // 2. Explicit RK4
    const rk4 = solveSindaTransient(model, { method: "RK4" });
    const rk4Temps = rk4.temperatures.get(1)!;
    const rk4Rmse = computeRmse(rk4Temps, exactTemps);
    const rk4FinalRelErr = Math.abs(rk4.finalTemperatures.get(1)! - exactTemps.at(-1)!) / exactTemps.at(-1)!;

    assert.ok(rk4Rmse < 1e-6, `Expected RK4 RMSE < 1e-6 K, got ${rk4Rmse}`);
    assert.ok(rk4FinalRelErr < 1e-8, `Expected RK4 final relErr < 1e-8, got ${rk4FinalRelErr}`);
  });

  it("Benchmark 3: Spacecraft radiative equilibrium T = (Q / (sigma * eps * A))^(1/4) parity (STDSTL)", () => {
    // Spacecraft radiator with internal heat load Q = 250 W radiating to 0 K deep space (or 3 K CMB).
    // With T_space = 0 K boundary, exact equilibrium is T = (Q / (sigma * G_rad))^(1/4),
    // where G_rad = eps * A = 0.85 * 1.2 = 1.02 m^2.
    // Let's use T_space = 3.0 K (realistic deep space CMB):
    //   Q = sigma * G_rad * (T^4 - T_space^4) => T_exact = (Q / (sigma * G_rad) + T_space^4)^(1/4)
    const Q = 250.0;
    const epsA = 0.85 * 1.2; // 1.02 m^2
    const tSpace = 3.0;
    const tExact = Math.pow(Q / (STEFAN_BOLTZMANN * epsA) + Math.pow(tSpace, 4), 0.25);

    const deck = `
HEADER OPTIONS DATA
  TITLE = "Spacecraft Radiative Equilibrium"
HEADER NODE DATA
   1, 250.0, 200.0  $ radiator panel
  -99, 3.0, 0.0     $ deep space sink (3 K)
HEADER CONDUCTOR DATA
  -10, 1, 99, 1.02  $ radiation conductor G_rad = eps*A = 1.02 m^2
HEADER SOURCE DATA
   1, 250.0         $ internal dissipation Q = 250 W
HEADER EXECUTION
  CALL STDSTL
END OF DATA
`;

    const model = parseSindaDeck(deck);
    const res = solveSindaSteadyState(model);
    assert.equal(res.converged, true);

    const tComputed = res.temperatures.get(1)!;
    const relErr = Math.abs(tComputed - tExact) / tExact;
    const rmse = computeRmse([tComputed], [tExact]);

    assert.ok(relErr < 1e-9, `Expected radiative equilibrium relErr < 1e-9, got ${relErr}`);
    assert.ok(rmse < 1e-6, `Expected radiative equilibrium RMSE < 1e-6 K, got ${rmse}`);
  });
});
