// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrnsysDeck, solveTrnsysTransient } from "../src/index.js";

function computeRmse(actual: number[], expected: number[]): number {
  assert.equal(actual.length, expected.length);
  let sumSq = 0;
  for (let i = 0; i < actual.length; i++) {
    const diff = actual[i]! - expected[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / actual.length);
}

describe("@modelscript/trnsys — Transient Thermal/Solar Benchmarks", () => {
  it("matches exact exponential thermal-loss decay for a Type 4 storage tank (relErr < 1e-6, rmse < 1e-6)", () => {
    // 1-node cylindrical tank: V = 0.3 m3, H = 1.5 m, rho = 1000 kg/m3, cp = 4.19 kJ/(kg.K), U = 1.5 kJ/(h.m2.K)
    // Initial temperature T0 = 60 C, ambient Tenv = 20 C, zero flow (mdot = 0)
    const V = 0.3;
    const H = 1.5;
    const rho = 1000.0;
    const cp = 4.19;
    const U = 1.5;
    const T0 = 60.0;
    const Tenv = 20.0;

    const r = Math.sqrt(V / (Math.PI * H));
    const areaTotal = 2.0 * Math.PI * r * H + 2.0 * Math.PI * r * r;
    const ua = U * areaTotal;
    const cap = rho * V * cp;
    const tau = cap / ua; // thermal time constant (hours)

    const deck = parseTrnsysDeck(`
VERSION 18
SIMULATION 0 24 0.5
TOLERANCES 1e-6 1e-6
LIMITS 30 30 30

UNIT 1 TYPE 4 TankDecay
PARAMETERS 6
  ${V} ${cp} ${rho} ${U} ${H} 1
INPUTS 5
  0,0 0,0 0,0 0,0 0,0
  20.0 0.0 20.0 0.0 ${Tenv}
DERIVATIVES 1
  ${T0}
END
`);

    const sim = solveTrnsysTransient(deck);
    assert.equal(sim.convergedAllSteps, true);

    const tSimulated = sim.series[1]![6]!; // out6 = end-of-step Tavg
    const tAnalytical = sim.times.map((t) => Tenv + (T0 - Tenv) * Math.exp(-t / tau));

    const rmse = computeRmse(tSimulated, tAnalytical);
    let maxRelErr = 0;
    for (let i = 0; i < tSimulated.length; i++) {
      const relErr = Math.abs(tSimulated[i]! - tAnalytical[i]!) / Math.max(1e-9, Math.abs(tAnalytical[i]!));
      if (relErr > maxRelErr) maxRelErr = relErr;
    }

    assert.ok(rmse < 1e-6, `Expected exponential decay RMSE < 1e-6, got ${rmse}`);
    assert.ok(maxRelErr < 1e-6, `Expected exponential decay max relErr < 1e-6, got ${maxRelErr}`);
  });

  it("satisfies closed-loop Type 1 solar collector + Type 4 storage tank energy balance and analytical trajectory", () => {
    // Closed-loop 1-node tank coupled to flat-plate collector under constant irradiance It = 2880 kJ/(h.m2), Tamb = 20 C
    // Exact analytical ODE:
    //   M*cp * dT/dt = Ac * (FR*ta * It - FR*UL * (T - Tamb)) - UA_tank * (T - Tamb)
    //   Let G_tot = Ac*FR*UL + UA_tank, Q_sol = Ac*FR*ta*It
    //   T_eq = Tamb + Q_sol / G_tot,  tau = (M*cp) / G_tot
    //   T(t) = T_eq + (T0 - T_eq) * exp(-t / tau)
    const Ac = 4.0;
    const cp = 4.19;
    const frTa = 0.75;
    const frUl = 15.0;
    const mDot = 200.0;
    const V = 0.3;
    const H = 1.5;
    const rho = 1000.0;
    const U = 1.5;
    const T0 = 20.0;
    const Tamb = 20.0;
    const It = 2880.0;
    const dt = 0.1;

    const r = Math.sqrt(V / (Math.PI * H));
    const uaTank = U * (2.0 * Math.PI * r * H + 2.0 * Math.PI * r * r);
    const cap = rho * V * cp;
    const gTot = Ac * frUl + uaTank;
    const tEq = Tamb + (Ac * frTa * It) / gTot;
    const tau = cap / gTot;

    const deck = parseTrnsysDeck(`
VERSION 18
SIMULATION 0 6 ${dt}
TOLERANCES 1e-6 1e-6
LIMITS 50 30 30

UNIT 1 TYPE 1 Collector
PARAMETERS 5
  ${Ac} ${cp} ${frTa} ${frUl} 0.0
INPUTS 4
  2,1 0,0 0,0 0,0
  ${T0} ${mDot} ${Tamb} ${It}

UNIT 2 TYPE 4 Tank
PARAMETERS 6
  ${V} ${cp} ${rho} ${U} ${H} 1
INPUTS 5
  1,1 1,2 0,0 0,0 0,0
  ${T0} ${mDot} 15.0 0.0 ${Tamb}
DERIVATIVES 1
  ${T0}
END
`);

    const sim = solveTrnsysTransient(deck);
    assert.equal(sim.convergedAllSteps, true);

    const tTank = sim.series[2]![6]!; // out6 = end-of-step tank temp
    const qUseful = sim.series[1]![3]!; // out3 = collector Qu (kJ/h)
    const qLoss = sim.series[2]![5]!; // out5 = tank Qloss (kJ/h)

    // 1. Verify exact discrete energy conservation: M*cp*(T_final - T0) == sum((Qu - Qloss) * dt)
    const tFinal = tTank[tTank.length - 1]!;
    const deltaE = cap * (tFinal - T0);
    let netEnergyIn = 0;
    for (let i = 0; i < qUseful.length; i++) {
      netEnergyIn += (qUseful[i]! - qLoss[i]!) * dt;
    }
    const energyRelErr = Math.abs(deltaE - netEnergyIn) / Math.max(1.0, Math.abs(deltaE));
    assert.ok(energyRelErr < 1e-4, `Expected closed-loop energy balance relErr < 1e-4, got ${energyRelErr}`);

    // 2. Verify trajectory parity against analytical closed-loop ODE solution
    const tAnalytical = sim.times.map((t) => tEq + (T0 - tEq) * Math.exp(-t / tau));
    const rmse = computeRmse(tTank, tAnalytical);
    let maxRelErr = 0;
    for (let i = 0; i < tTank.length; i++) {
      const relErr = Math.abs(tTank[i]! - tAnalytical[i]!) / Math.max(1e-9, Math.abs(tAnalytical[i]!));
      if (relErr > maxRelErr) maxRelErr = relErr;
    }

    assert.ok(rmse < 0.05, `Expected closed-loop trajectory RMSE < 0.05 C, got ${rmse}`);
    assert.ok(maxRelErr < 1e-3, `Expected closed-loop trajectory max relErr < 1e-3, got ${maxRelErr}`);
  });

  it("simulates coupled Type 15 weather + Type 2 controller + Type 3 pump + Type 1 collector + Type 4 tank + Type 56 building", () => {
    const deck = parseTrnsysDeck(`
VERSION 18
SIMULATION 0 24 0.5
TOLERANCES 1e-4 1e-4
LIMITS 40 30 30

UNIT 1 TYPE 15 Weather
PARAMETERS 5
  20.0 5.0 2880.0 6.0 18.0

UNIT 2 TYPE 14 LoadSchedule
PARAMETERS 6
  0.0 1.0 12.0 1.0 24.0 1.0

UNIT 3 TYPE 2 Controller
PARAMETERS 2
  5 95.0
INPUTS 6
  5,1 6,1 6,3 3,1 0,0 0,0
  20.0 20.0 20.0 1.0 5.0 1.0

UNIT 4 TYPE 3 Pump
PARAMETERS 4
  200.0 4.19 180.0 0.05
INPUTS 3
  6,1 0,0 2,1
  20.0 200.0 1.0

UNIT 5 TYPE 1 Collector
PARAMETERS 5
  4.0 4.19 0.75 15.0 0.0
INPUTS 4
  4,1 4,2 1,1 1,2
  20.0 200.0 20.0 0.0

UNIT 6 TYPE 4 Tank
PARAMETERS 6
  0.3 4.19 1000.0 1.5 1.5 3
INPUTS 5
  5,1 5,2 0,0 0,0 1,1
  20.0 0.0 15.0 0.0 20.0
DERIVATIVES 3
  20.0 20.0 20.0

UNIT 7 TYPE 56 Building
PARAMETERS 4
  5000.0 250.0 6.0 20.0
INPUTS 4
  1,1 1,2 0,0 0,0
  20.0 0.0 500.0 0.0

END
`);

    const sim = solveTrnsysTransient(deck);
    assert.equal(sim.convergedAllSteps, true);
    assert.equal(sim.times.length, 48);

    const tankAvg = sim.series[6]![6]!;
    const maxTankTemp = Math.max(...tankAvg);
    assert.ok(maxTankTemp > 35.0, `Expected solar heating of tank > 35 C, got ${maxTankTemp}`);

    const zoneTemp = sim.series[7]![1]!;
    const maxZoneTemp = Math.max(...zoneTemp);
    assert.ok(maxZoneTemp > 25.0, `Expected solar gain warming building zone > 25 C, got ${maxZoneTemp}`);
  });
});
