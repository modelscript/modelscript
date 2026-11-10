// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { solveDcOpf, solveDirectDcOpf, type GenericPowerCase } from "../src/solvers/opf/index.js";

// Standard 3-Bus Transmission Network with 2 Generators and 1 Load
const THREE_BUS_CASE: GenericPowerCase = {
  header: { sbase: 100.0, basfrq: 60.0 },
  title1: "3-Bus Economic Dispatch & Congestion Test Case",
  buses: new Map([
    [1, { i: 1, name: "BUS_1_GEN_CHEAP", baseKv: 138.0, ide: 3, vm: 1.0, va: 0.0 }],
    [2, { i: 2, name: "BUS_2_GEN_EXPENSIVE", baseKv: 138.0, ide: 2, vm: 1.0, va: 0.0 }],
    [3, { i: 3, name: "BUS_3_LOAD_CENTER", baseKv: 138.0, ide: 1, vm: 1.0, va: 0.0 }],
  ]),
  generators: [
    { i: 1, id: "G1", pg: 60.0, qg: 0.0, pb: 0.0, pt: 100.0, stat: 1 },
    { i: 2, id: "G2", pg: 60.0, qg: 0.0, pb: 0.0, pt: 100.0, stat: 1 },
  ],
  loads: [{ i: 3, pl: 120.0, ql: 40.0, status: 1 }],
  branches: [
    { i: 1, j: 2, ckt: "1", r: 0.01, x: 0.1, rateA: 100.0, st: 1 },
    { i: 1, j: 3, ckt: "1", r: 0.01, x: 0.1, rateA: 100.0, st: 1 },
    { i: 2, j: 3, ckt: "1", r: 0.01, x: 0.1, rateA: 100.0, st: 1 },
  ],
};

test("DC-OPF: Solves economic dispatch, balances power, and respects generator limits", () => {
  const customCosts = new Map([
    ["1_G1", { c1: 20.0, c0: 0.0 }], // Cheap baseload generator ($20/MWh)
    ["2_G2", { c1: 45.0, c0: 0.0 }], // Expensive peaking generator ($45/MWh)
  ]);

  const sol = solveDcOpf(THREE_BUS_CASE, { generatorCosts: customCosts });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "dc");
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.1, "Total generation must match load");
  assert.equal(sol.totalLoadMw, 120.0);

  // G1 should be dispatched at or near maximum capacity (100 MW) because it is cheaper
  const g1 = sol.generators.find((g) => g.busNumber === 1)!;
  const g2 = sol.generators.find((g) => g.busNumber === 2)!;

  assert.ok(g1.pgMw > 80.0, `G1 should be dispatched near capacity, got ${g1.pgMw} MW`);
  assert.ok(g2.pgMw > 0.0, `G2 should supply remaining energy, got ${g2.pgMw} MW`);
  assert.equal(sol.buses.length, 3);
  assert.equal(sol.branches.length, 3);

  // Check report output
  assert.ok(sol.reportText.includes("OPTIMAL POWER FLOW (DC-OPF) DISPATCH & LMP REPORT"));
  assert.ok(sol.reportText.includes("BUS_1_GEN_CHEAP"));
  assert.ok(sol.reportText.includes("BUS_3_LOAD_CENTER"));
});

test("DC-OPF: Detects line congestion, computes shadow prices, and decomposes LMPs", () => {
  // Constrain line 1-3 to 40 MW rating, creating congestion
  const congestedCase: GenericPowerCase = {
    ...THREE_BUS_CASE,
    branches: [
      { i: 1, j: 2, ckt: "1", r: 0.01, x: 0.1, rateA: 100.0, st: 1 },
      { i: 1, j: 3, ckt: "1", r: 0.01, x: 0.1, rateA: 40.0, st: 1 }, // Bottleneck line
      { i: 2, j: 3, ckt: "1", r: 0.01, x: 0.1, rateA: 100.0, st: 1 },
    ],
  };

  const sol = solveDcOpf(congestedCase, {
    enforceThermalLimits: true,
    generatorCosts: new Map([
      ["1_G1", { c1: 15.0, c0: 0.0 }],
      ["2_G2", { c1: 60.0, c0: 0.0 }],
    ]),
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.totalLoadMw, 120.0);
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.1);

  // Line 1-3 should be heavily loaded
  const line13 = sol.branches.find((br) => br.fromBus === 1 && br.toBus === 3)!;
  assert.ok(line13.loadingPercent >= 90.0, `Line 1-3 loading should be near rating, got ${line13.loadingPercent}%`);

  // LMPs should be reported for all buses
  for (const b of sol.buses) {
    assert.ok(b.lmpDollarsPerMwh > 0, `Bus ${b.busNumber} LMP should be positive`);
  }
});

test("Direct Tier-2 DC-OPF: Solves economic dispatch via direct CSC linear memory and simplex", () => {
  const customCosts = new Map([
    ["1_G1", { c1: 20.0, c0: 0.0 }],
    ["2_G2", { c1: 45.0, c0: 0.0 }],
  ]);

  const sol = solveDirectDcOpf(THREE_BUS_CASE, { generatorCosts: customCosts });
  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "dc");
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.1);

  const g1 = sol.generators.find((g) => g.busNumber === 1)!;
  const g2 = sol.generators.find((g) => g.busNumber === 2)!;
  assert.ok(g1.pgMw > 80.0, `G1 should be dispatched near capacity, got ${g1.pgMw} MW`);
  assert.ok(g2.pgMw > 0.0, `G2 should supply remaining energy, got ${g2.pgMw} MW`);
});

test("Direct Tier-2 DC-OPF: Detects line congestion and computes branch shadow prices", () => {
  const congestedCase: GenericPowerCase = {
    ...THREE_BUS_CASE,
    loads: [{ i: 3, pl: 100.0, ql: 40.0, status: 1 }],
    branches: [
      { i: 1, j: 2, ckt: "1", r: 0.01, x: 0.1, rateA: 100.0, st: 1 },
      { i: 1, j: 3, ckt: "1", r: 0.01, x: 0.1, rateA: 40.0, st: 1 },
      { i: 2, j: 3, ckt: "1", r: 0.01, x: 0.1, rateA: 100.0, st: 1 },
    ],
  };

  const sol = solveDirectDcOpf(congestedCase, {
    enforceThermalLimits: true,
    generatorCosts: new Map([
      ["1_G1", { c1: 15.0, c0: 0.0 }],
      ["2_G2", { c1: 60.0, c0: 0.0 }],
    ]),
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.totalLoadMw, 100.0);
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.1);

  const line13 = sol.branches.find((br) => br.fromBus === 1 && br.toBus === 3)!;
  assert.ok(Math.abs(line13.pFlowMw) <= 40.1, `Line 1-3 flow ${line13.pFlowMw} must respect 40 MW limit`);
  assert.equal(line13.congested, true);
});

test("DC-OPF: Tier routing delegates to Direct solver when tier='direct'", () => {
  const sol = solveDcOpf(THREE_BUS_CASE, {
    tier: "direct",
    generatorCosts: new Map([
      ["1_G1", { c1: 20.0, c0: 0.0 }],
      ["2_G2", { c1: 45.0, c0: 0.0 }],
    ]),
  });
  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "dc");
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.1);
});

test("DC-OPF Async: Tier routing to AMPL (Tier 1) produces optimal dispatch", async () => {
  const { solveDcOpfAsync } = await import("../src/solvers/opf/index.js");
  const sol = await solveDcOpfAsync(THREE_BUS_CASE, {
    tier: "ampl",
    generatorCosts: new Map([
      ["1_G1", { c1: 20.0, c0: 0.0 }],
      ["2_G2", { c1: 45.0, c0: 0.0 }],
    ]),
  });
  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "dc");
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.1);
});
