// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  type GenericPowerCase,
  solveStochasticOpf,
} from "../src/solvers/opf/index.js";

function createRenewableGrid(): GenericPowerCase {
  const buses = new Map<number, { i: number; name: string; baseKv: number; ide: number; vm: number; va: number }>();
  buses.set(1, { i: 1, name: "THERMAL_HUB", baseKv: 230, ide: 3, vm: 1, va: 0 });
  buses.set(2, { i: 2, name: "WIND_FARM", baseKv: 230, ide: 2, vm: 1, va: 0 });
  buses.set(3, { i: 3, name: "LOAD_CENTER", baseKv: 230, ide: 1, vm: 1, va: 0 });

  return {
    header: { sbase: 100 },
    buses,
    loads: [{ i: 3, pl: 120.0, ql: 30.0, status: 1 }],
    generators: [
      { i: 1, id: "1", pg: 70.0, qg: 10.0, pb: 10.0, pt: 150.0, qb: -40.0, qt: 40.0, stat: 1 },
      { i: 2, id: "W1", pg: 50.0, qg: 0.0, pb: 0.0, pt: 80.0, qb: -20.0, qt: 20.0, stat: 1 },
    ],
    branches: [
      { i: 1, j: 2, ckt: "1", r: 0.01, x: 0.05, rateA: 100.0, st: 1 },
      { i: 1, j: 3, ckt: "1", r: 0.015, x: 0.08, rateA: 90.0, st: 1 },
      { i: 2, j: 3, ckt: "1", r: 0.012, x: 0.06, rateA: 90.0, st: 1 },
    ],
  };
}

test("Stochastic OPF: Evaluates Monte Carlo / LHS renewable scenarios and allocates spinning reserves", () => {
  const pCase = createRenewableGrid();

  const sol = solveStochasticOpf(pCase, {
    numScenarios: 30,
    samplingMethod: "lhs",
    confidenceLevel: 0.95,
    reserveCostUpPerMw: 10.0,
    reserveCostDownPerMw: 6.0,
    loadStdDevFraction: 0.05,
    seed: 42,
    renewables: [
      {
        busNumber: 2,
        genId: "W1",
        type: "wind",
        ratedCapacityMw: 80.0,
        weibullK: 2.1,
        weibullC: 9.0,
      },
    ],
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.numScenarios, 30);
  assert.equal(sol.scenarios.length, 30);
  assert.ok(sol.expectedCostPerHour > 0);
  assert.ok(sol.reserveCostPerHour > 0, "Should commit non-zero spinning reserve capacity");

  // Risk metrics: CVaR >= VaR >= Base cost
  assert.ok(
    sol.cvar95 >= sol.valueAtRisk95,
    `CVaR (${sol.cvar95}) should be >= VaR (${sol.valueAtRisk95})`,
  );

  // Check spinning reserve allocation on thermal unit
  const thermalRes = sol.generatorReserves.find((g) => g.busNumber === 1);
  assert.ok(thermalRes, "Should find thermal unit reserve");
  assert.ok(thermalRes.reserveUpMw > 0, "Thermal unit must provide up-reserves for wind lull");

  // Check branch risk calculations
  assert.equal(sol.branchRisks.length, 3);
  assert.ok(sol.branchRisks.every((b) => b.expectedFlowMw > 0));

  // Check report text
  assert.ok(sol.reportText.includes("STOCHASTIC & CHANCE-CONSTRAINED OPTIMAL POWER FLOW"));
  assert.ok(sol.reportText.includes("COMMITTED GENERATOR SPINNING RESERVES"));
  assert.ok(sol.reportText.includes("TRANSMISSION LINE OVERLOAD RISK & FLOWS"));
});
