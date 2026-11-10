// SPDX-License-Identifier: AGPL-3.0-or-later

import * as assert from "node:assert";
import test from "node:test";
import { generate70kEasternInterconnectionCase } from "../src/benchmarking/accc-benchmarker.js";
import { runMmwg70kBenchmark } from "../src/benchmarking/mmwg-70k.js";

test("MMWG 70,000-Bus: System topology & scale verification", () => {
  const grid = generate70kEasternInterconnectionCase();

  assert.strictEqual(grid.buses.size, 70000, "Must synthesize 70,000 buses");
  assert.ok(grid.branches.length >= 69000, `Expected >= 69,000 branches, got ${grid.branches.length}`);
  assert.ok(grid.generators.length >= 70, `Expected >= 70 generators, got ${grid.generators.length}`);
  assert.ok(grid.loads.length >= 20000, `Expected >= 20,000 loads, got ${grid.loads.length}`);
});

test("MMWG 70,000-Bus: Turnkey benchmark solve, ACCC screening & HTML export", async () => {
  const res = await runMmwg70kBenchmark({
    numContingencies: 15,
    generateHtml: true,
  });

  assert.strictEqual(res.caseName, "MMWG_70000_Eastern_Interconnection");
  assert.strictEqual(res.totalBuses, 70000);
  assert.strictEqual(res.accc.totalContingencies, 15);
  assert.ok(res.powerFlow.converged, "Base power flow must converge");
  assert.ok(res.powerFlow.memoryRssMb > 0, "Must record memory footprint");
  assert.ok(res.comparisonVsSota.speedupFactor > 5.0, "Speedup factor must exceed 5.0x");
  assert.strictEqual(res.comparisonVsSota.parityStatus, "PASS");

  // Verify PSS/E Tabulated CSV format
  assert.ok(res.psseTabulatedCsv.includes("CONTINGENCY LABEL,STATUS,ITERATIONS,MAX % LOADING"));
  const csvRows = res.psseTabulatedCsv.trim().split("\n");
  assert.strictEqual(csvRows.length, 16, "Header + 15 contingency records");

  // Verify HTML Dashboard
  assert.ok(res.htmlDashboard, "Must generate self-contained HTML dashboard");
  assert.ok(res.htmlDashboard.includes("70,000-Bus US Eastern Interconnection"));
});
