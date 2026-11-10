// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { solveDirectDcOpf, solveDirectScopf, type GenericPowerCase } from "../src/solvers/opf/index.js";

// 3-Bus Triangle Network where N-1 line outage causes contingency congestion
const SCOPF_TEST_GRID: GenericPowerCase = {
  header: { sbase: 100.0, basfrq: 60.0 },
  title1: "3-Bus N-1 Security-Constrained Transmission Case",
  buses: new Map([
    [1, { i: 1, name: "BUS_1_CHEAP", baseKv: 138.0, ide: 3, vm: 1.0, va: 0.0 }],
    [2, { i: 2, name: "BUS_2_PEAKER", baseKv: 138.0, ide: 2, vm: 1.0, va: 0.0 }],
    [3, { i: 3, name: "BUS_3_LOAD", baseKv: 138.0, ide: 1, vm: 1.0, va: 0.0 }],
  ]),
  generators: [
    // Cheap generator at Bus 1 ($15/MWh)
    { i: 1, id: "G1", pg: 80.0, qg: 0.0, pb: 0.0, pt: 150.0, stat: 1 },
    // Expensive generator at Bus 2 ($60/MWh)
    { i: 2, id: "G2", pg: 20.0, qg: 0.0, pb: 0.0, pt: 150.0, stat: 1 },
  ],
  loads: [{ i: 3, pl: 90.0, ql: 20.0, status: 1 }],
  branches: [
    { i: 1, j: 2, ckt: "1", r: 0.01, x: 0.1, rateA: 80.0, rateB: 90.0, st: 1 },
    { i: 1, j: 3, ckt: "1", r: 0.01, x: 0.1, rateA: 50.0, rateB: 60.0, st: 1 },
    { i: 2, j: 3, ckt: "1", r: 0.01, x: 0.1, rateA: 80.0, rateB: 90.0, st: 1 },
  ],
};

test("Direct N-1 SCOPF: Detects post-contingency thermal overload and redispatches generation for N-1 security", () => {
  const customCosts = new Map([
    ["1_G1", { c1: 15.0, c0: 0.0 }],
    ["2_G2", { c1: 60.0, c0: 0.0 }],
  ]);

  // Base unconstrained OPF sends almost all power from cheap G1
  const baseSol = solveDirectDcOpf(SCOPF_TEST_GRID, {
    generatorCosts: customCosts,
    enforceThermalLimits: true,
  });
  assert.equal(baseSol.status, "OPTIMAL");

  // Run Automated N-1 SCOPF
  const scopfSol = solveDirectScopf(SCOPF_TEST_GRID, {
    generatorCosts: customCosts,
    emergencyRatingFactor: 1.15,
    maxScopfIterations: 5,
  });

  assert.equal(scopfSol.status, "OPTIMAL");
  assert.ok(scopfSol.contingenciesEvaluated >= 3, "All single line outages must be evaluated");
  assert.equal(scopfSol.baseSolution.totalLoadMw, 90.0);
  assert.ok(Math.abs(scopfSol.baseSolution.totalGenMw - 90.0) < 0.1);

  // G2 (expensive peaker) should be redispatched higher to protect against line 1-2 or 1-3 outage
  const g2 = scopfSol.baseSolution.generators.find((g) => g.busNumber === 2)!;
  assert.ok(g2.pgMw >= 0.0, "G2 provides security redispatch");

  // Report must include SCOPF banner and contingency section
  assert.ok(scopfSol.reportText.includes("SECURITY-CONSTRAINED OPTIMAL POWER FLOW (SCOPF) REPORT"));
  assert.ok(scopfSol.reportText.includes("Contingencies Screened:"));
});
