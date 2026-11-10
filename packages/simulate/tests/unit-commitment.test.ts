// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  solveDirectUnitCommitment,
  type GenericPowerCase,
  type UnitCommitmentOptions,
} from "../src/solvers/opf/index.js";

const UC_TEST_GRID: GenericPowerCase = {
  header: { sbase: 100.0, basfrq: 60.0 },
  title1: "3-Generator Unit Commitment & Storage Network",
  buses: new Map([
    [1, { i: 1, name: "BUS_1", baseKv: 138.0, ide: 3, vm: 1.0, va: 0.0 }],
    [2, { i: 2, name: "BUS_2", baseKv: 138.0, ide: 2, vm: 1.0, va: 0.0 }],
    [3, { i: 3, name: "BUS_3", baseKv: 138.0, ide: 1, vm: 1.0, va: 0.0 }],
  ]),
  generators: [
    // Unit 1: Cheap Baseload Coal/Nuclear ($15/MWh, c0 = $50, Pmin = 50, Pmax = 200, UT = 4, DT = 4)
    { i: 1, id: "BASE_G1", pg: 100.0, qg: 0.0, pb: 50.0, pt: 200.0, stat: 1 },
    // Unit 2: Mid-merit CCGT ($30/MWh, c0 = $25, Pmin = 20, Pmax = 120, UT = 2, DT = 2)
    { i: 2, id: "MID_G2", pg: 40.0, qg: 0.0, pb: 20.0, pt: 120.0, stat: 1 },
    // Unit 3: Expensive OCGT Peaker ($70/MWh, c0 = $10, Pmin = 10, Pmax = 80, UT = 1, DT = 1, Startup = $150)
    { i: 3, id: "PEAK_G3", pg: 0.0, qg: 0.0, pb: 10.0, pt: 80.0, stat: 1 },
  ],
  loads: [{ i: 3, pl: 150.0, ql: 30.0, status: 1 }],
  branches: [
    { i: 1, j: 2, ckt: "1", r: 0.01, x: 0.05, rateA: 250.0, st: 1 },
    { i: 2, j: 3, ckt: "1", r: 0.01, x: 0.05, rateA: 250.0, st: 1 },
    { i: 1, j: 3, ckt: "1", r: 0.01, x: 0.05, rateA: 250.0, st: 1 },
  ],
};

test("Direct MILP Unit Commitment: Optimizes 24-hour generator schedule with startup and reserve constraints", () => {
  const options: UnitCommitmentOptions = {
    timeHorizon: 24,
    spinningReservePercent: 0.15,
    unitParameters: new Map([
      [
        "1_BASE_G1",
        {
          marginalCost: 15.0,
          noLoadCost: 50.0,
          startupCost: 300.0,
          shutdownCost: 100.0,
          minUpTimeHours: 4,
          minDownTimeHours: 4,
          pMinMw: 50.0,
          pMaxMw: 200.0,
        },
      ],
      [
        "2_MID_G2",
        {
          marginalCost: 30.0,
          noLoadCost: 25.0,
          startupCost: 150.0,
          shutdownCost: 50.0,
          minUpTimeHours: 2,
          minDownTimeHours: 2,
          pMinMw: 20.0,
          pMaxMw: 120.0,
        },
      ],
      [
        "3_PEAK_G3",
        {
          marginalCost: 70.0,
          noLoadCost: 10.0,
          startupCost: 80.0,
          shutdownCost: 30.0,
          minUpTimeHours: 1,
          minDownTimeHours: 1,
          pMinMw: 10.0,
          pMaxMw: 80.0,
        },
      ],
    ]),
    bess: [
      {
        id: "BATT_1",
        busNumber: 3,
        energyCapacityMwh: 100.0,
        minEnergyMwh: 10.0,
        maxChargeMw: 30.0,
        maxDischargeMw: 30.0,
        chargeEfficiency: 0.95,
        dischargeEfficiency: 0.95,
        initialEnergyMwh: 40.0,
        finalEnergyMwh: 40.0,
        cycleCostDollarsPerMwh: 2.0,
      },
    ],
  };

  const sol = solveDirectUnitCommitment(UC_TEST_GRID, options);

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.timeHorizon, 24);
  assert.equal(sol.periods.length, 24);
  assert.ok(sol.totalCost > 0, "Total cost must be positive");
  assert.ok(sol.totalGenMwh > 0, "Total generation must be positive");
  assert.ok(sol.totalDemandMwh > 0, "Total demand must be positive");

  // Baseload unit 1 should stay committed across periods
  const baseSchedules = sol.generatorSchedules.get("1_BASE_G1")!;
  assert.equal(baseSchedules.length, 24);
  const baseCommittedCount = baseSchedules.filter((s) => s.isCommitted).length;
  assert.ok(baseCommittedCount >= 20, "Baseload unit 1 should be committed almost entire horizon");

  // Every period must satisfy spinning reserve >= (1 + 0.15) * demand
  for (const p of sol.periods) {
    assert.ok(
      p.spinningReserveMw >= p.demandMw * 1.149,
      `Period ${p.hour}: Spinning reserve ${p.spinningReserveMw} MW must meet 15% margin on ${p.demandMw} MW demand`,
    );
    assert.ok(p.generationMw > 0, `Period ${p.hour}: Generation must be non-zero`);
  }

  // Report must contain Unit Commitment banner
  assert.ok(sol.reportText.includes("MIXED-INTEGER UNIT COMMITMENT (MILP) SCHEDULE"));
});
