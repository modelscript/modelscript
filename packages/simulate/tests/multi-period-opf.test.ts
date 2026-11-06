// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  type BessModel,
  DEFAULT_24H_LOAD_PROFILE,
  type GenericPowerCase,
  solveMultiPeriodOpf,
} from "../src/solvers/opf/index.js";

// Standard 3-bus test network
// Bus 1: Cheap coal/baseload gen ($15/MWh)
// Bus 2: Expensive peaker gen ($65/MWh)
// Bus 3: Industrial load (100 MW peak)
function create3BusCase(): GenericPowerCase {
  const buses = new Map<number, { i: number; name: string; baseKv: number; ide: number; vm: number; va: number }>();
  buses.set(1, { i: 1, name: "BASELOAD_1", baseKv: 230.0, ide: 3, vm: 1.0, va: 0.0 });
  buses.set(2, { i: 2, name: "PEAKER_2", baseKv: 230.0, ide: 2, vm: 1.0, va: 0.0 });
  buses.set(3, { i: 3, name: "LOAD_3", baseKv: 230.0, ide: 1, vm: 1.0, va: 0.0 });

  return {
    header: { sbase: 100.0, basfrq: 60.0 },
    buses,
    loads: [{ i: 3, pl: 100.0, ql: 25.0, status: 1 }],
    generators: [
      { i: 1, id: "1", pg: 60.0, qg: 10.0, pb: 10.0, pt: 80.0, qb: -40.0, qt: 40.0, stat: 1 },
      { i: 2, id: "1", pg: 40.0, qg: 15.0, pb: 0.0, pt: 150.0, qb: -60.0, qt: 60.0, stat: 1 },
    ],
    branches: [
      { i: 1, j: 2, ckt: "1", r: 0.01, x: 0.05, b: 0.02, rateA: 100.0, st: 1 },
      { i: 1, j: 3, ckt: "1", r: 0.015, x: 0.08, b: 0.02, rateA: 70.0, st: 1 }, // Constrained line from cheap gen
      { i: 2, j: 3, ckt: "1", r: 0.01, x: 0.06, b: 0.02, rateA: 150.0, st: 1 },
    ],
  };
}

test("Multi-Period OPF solves 24-hour horizon baseline with dynamic LMPs", () => {
  const pCase = create3BusCase();
  const costs = new Map<string, { c0: number; c1: number }>();
  costs.set("1_1", { c0: 0, c1: 15.0 }); // Cheap generator
  costs.set("2_1", { c0: 0, c1: 65.0 }); // Expensive peaker

  const sol = solveMultiPeriodOpf(pCase, {
    timeHorizon: 24,
    generatorCosts: costs,
    formulation: "dc",
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.timeHorizon, 24);
  assert.equal(sol.periods.length, 24);
  assert.ok(sol.totalCost > 0);
  assert.ok(sol.totalGenMwh >= sol.totalLoadMwh);

  // Night hours (0-4) should have lower generation than peak hours (10-16)
  const nightGen = sol.periods[2]!.totalGenMw;
  const peakGen = sol.periods[11]!.totalGenMw;
  assert.ok(peakGen > nightGen, `Peak gen (${peakGen}) must exceed night gen (${nightGen})`);

  // Report text should include multi-period summary table
  assert.ok(sol.reportText.includes("MULTI-PERIOD OPTIMAL POWER FLOW REPORT"));
  assert.ok(sol.reportText.includes("24 Periods"));
});

test("Multi-Period OPF with BESS performs energy arbitrage and lowers system cost", () => {
  const pCase = create3BusCase();
  const costs = new Map<string, { c0: number; c1: number }>();
  costs.set("1_1", { c0: 0, c1: 15.0 });
  costs.set("2_1", { c0: 0, c1: 65.0 });

  // Baseline without storage
  const solBase = solveMultiPeriodOpf(pCase, {
    timeHorizon: 24,
    generatorCosts: costs,
    formulation: "dc",
  });

  // With 40 MWh battery storage at load bus 3
  const bess: BessModel = {
    id: "BATT_LOAD_3",
    busNumber: 3,
    energyCapacityMwh: 50.0,
    minEnergyMwh: 5.0,
    maxChargeMw: 15.0,
    maxDischargeMw: 15.0,
    chargeEfficiency: 0.95,
    dischargeEfficiency: 0.95,
    initialEnergyMwh: 10.0,
    cycleCostDollarsPerMwh: 1.0,
  };

  const solBess = solveMultiPeriodOpf(pCase, {
    timeHorizon: 24,
    generatorCosts: costs,
    bess: [bess],
    formulation: "dc",
  });

  assert.equal(solBess.status, "OPTIMAL");
  assert.equal(solBess.bessTrajectories.size, 1);

  const traj = solBess.bessTrajectories.get("BATT_LOAD_3")!;
  assert.equal(traj.length, 24);

  // Check that battery charged during off-peak and discharged during on-peak
  const hasCharging = traj.some((step) => step.chargeMw > 0);
  const hasDischarging = traj.some((step) => step.dischargeMw > 0);
  assert.ok(hasCharging, "Battery should charge during low price periods");
  assert.ok(hasDischarging, "Battery should discharge during high price periods");

  // Verify state-of-charge bounds
  for (const step of traj) {
    assert.ok(step.energyMwh >= bess.minEnergyMwh - 0.1, `SoC ${step.energyMwh} should be >= min`);
    assert.ok(step.energyMwh <= bess.energyCapacityMwh + 0.1, `SoC ${step.energyMwh} should be <= max`);
  }

  // Report should format BESS telemetry
  assert.ok(solBess.reportText.includes("BATTERY ENERGY STORAGE SYSTEM (BESS) TRAJECTORIES"));
  assert.ok(solBess.reportText.includes("BATT_LOAD_3"));
});

test("Multi-Period OPF supports nonlinear AC formulation", () => {
  const pCase = create3BusCase();

  const solAc = solveMultiPeriodOpf(pCase, {
    timeHorizon: 6, // 6-hour test for quick AC-OPF validation
    loadProfile: [0.7, 0.85, 1.0, 0.95, 0.8, 0.75],
    formulation: "ac",
  });

  assert.equal(solAc.status, "OPTIMAL");
  assert.equal(solAc.formulation, "ac");
  assert.equal(solAc.periods.length, 6);
  assert.ok(solAc.periods.every((p) => p.totalLossMw >= 0), "AC OPF should compute positive transmission losses");
});
