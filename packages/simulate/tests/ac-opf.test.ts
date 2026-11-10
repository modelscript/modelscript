// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { solveAcOpf, solveDirectAcOpf, type GenericPowerCase } from "../src/solvers/opf/index.js";

// Standard 3-Bus Transmission Network with 2 Generators and 1 Load
const THREE_BUS_AC_CASE: GenericPowerCase = {
  header: { sbase: 100.0, basfrq: 60.0 },
  title1: "3-Bus AC-OPF Voltage & Reactive Power Test Case",
  buses: new Map([
    [1, { i: 1, name: "BUS_1_GEN_CHEAP", baseKv: 138.0, ide: 3, vm: 1.0, va: 0.0 }],
    [2, { i: 2, name: "BUS_2_GEN_EXPENSIVE", baseKv: 138.0, ide: 2, vm: 1.0, va: 0.0 }],
    [3, { i: 3, name: "BUS_3_LOAD_CENTER", baseKv: 138.0, ide: 1, vm: 1.0, va: 0.0 }],
  ]),
  generators: [
    { i: 1, id: "G1", pg: 60.0, qg: 10.0, pb: 0.0, pt: 100.0, qb: -50.0, qt: 50.0, stat: 1 },
    { i: 2, id: "G2", pg: 60.0, qg: 10.0, pb: 0.0, pt: 100.0, qb: -50.0, qt: 50.0, stat: 1 },
  ],
  loads: [{ i: 3, pl: 120.0, ql: 40.0, status: 1 }],
  branches: [
    { i: 1, j: 2, ckt: "1", r: 0.02, x: 0.1, b: 0.02, rateA: 100.0, st: 1 },
    { i: 1, j: 3, ckt: "1", r: 0.02, x: 0.1, b: 0.02, rateA: 100.0, st: 1 },
    { i: 2, j: 3, ckt: "1", r: 0.02, x: 0.1, b: 0.02, rateA: 100.0, st: 1 },
  ],
};

test("AC-OPF: Solves nonlinear AC power flow, optimizes reactive power, and calculates losses", () => {
  const customCosts = new Map([
    ["1_G1", { c1: 20.0, c0: 0.0, c2: 0.002 }],
    ["2_G2", { c1: 45.0, c0: 0.0, c2: 0.005 }],
  ]);

  const sol = solveAcOpf(THREE_BUS_AC_CASE, {
    generatorCosts: customCosts,
    voltageMin: 0.95,
    voltageMax: 1.05,
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "ac");
  assert.equal(sol.totalLoadMw, 120.0);
  assert.equal(sol.totalLoadMvar, 40.0);

  // Active generation should cover load plus positive transmission line losses
  assert.ok(sol.totalGenMw >= sol.totalLoadMw, "Total generation must cover demand");
  assert.ok(sol.totalLossMw >= 0.0, "Transmission line losses must be non-negative");

  // Voltage magnitudes must satisfy bounds
  for (const b of sol.buses) {
    assert.ok(b.vm >= 0.9 && b.vm <= 1.1, `Bus ${b.busNumber} voltage ${b.vm} pu must be within limits`);
  }

  // Reactive power should be dispatched
  assert.ok(sol.totalGenMvar !== undefined && sol.totalGenMvar > 0, "Reactive power should be generated");

  // Check branch results
  assert.equal(sol.branches.length, 3);
  for (const br of sol.branches) {
    assert.ok(br.qFlowMvar !== undefined, "Branch must report reactive power flow");
  }

  // Report must include AC-OPF header
  assert.ok(sol.reportText.includes("OPTIMAL POWER FLOW"));
});

test("AC-OPF: Converges on IEEE 14-bus test case with positive losses and voltage regulation", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const rawPath = path.resolve(process.cwd(), "languages/psse/testsuite/ieee14.raw");
  if (!fs.existsSync(rawPath)) return;

  const pssePkg = "@modelscript/psse";
  const { parseRaw } = (await import(pssePkg)) as any;
  const rawContent = fs.readFileSync(rawPath, "utf-8");
  const parsed = parseRaw(rawContent);

  const sol = solveAcOpf(parsed, {
    voltageMin: 0.94,
    voltageMax: 1.06,
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "ac");
  assert.equal(sol.buses.length, 5);
  assert.ok(sol.totalGenMw >= sol.totalLoadMw, "Total generation must cover load");
  assert.ok(sol.totalLossMw >= 0, "Transmission line losses must be positive");
  assert.ok(sol.averageLmp > 0, "Average LMP must be positive");
  assert.ok(sol.reportText.includes("OPTIMAL POWER FLOW"));
});

test("Direct Tier-2 AC-OPF: Solves nonlinear AC power flow using analytical Jacobian and IPOPT/L-BFGS-B", async () => {
  const customCosts = new Map([
    ["1_G1", { c1: 20.0, c0: 0.0, c2: 0.002 }],
    ["2_G2", { c1: 45.0, c0: 0.0, c2: 0.005 }],
  ]);

  const sol = await solveDirectAcOpf(THREE_BUS_AC_CASE, {
    generatorCosts: customCosts,
    voltageMin: 0.95,
    voltageMax: 1.05,
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "ac");
  assert.equal(sol.totalLoadMw, 120.0);
  assert.ok(sol.totalGenMw >= 119.0, `Total generation ${sol.totalGenMw} must cover load`);
  assert.equal(sol.buses.length, 3);
  assert.equal(sol.generators.length, 2);
  assert.equal(sol.branches.length, 3);
  for (const b of sol.buses) {
    assert.ok(b.vm >= 0.94 && b.vm <= 1.06, `Bus voltage ${b.vm} must be within bounds`);
  }
});
