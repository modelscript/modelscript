// SPDX-License-Identifier: AGPL-3.0-or-later

import * as assert from "node:assert";
import test from "node:test";
import {
  ACTIVSG2000_AREAS,
  exportActivSg2000RawString,
  generateActivSg2000Case,
  runActivSg2000Benchmark,
} from "../src/benchmarking/activsg2000.js";
import { calculateSotaDiscrepancy } from "../src/benchmarking/sota-discrepancy.js";

test("ACTIVSg2000: Procedural grid synthesis & topology integrity", () => {
  const grid = generateActivSg2000Case();

  assert.strictEqual(grid.buses.size, 2000, "Must synthesize exactly 2,000 buses");
  assert.strictEqual(grid.areas.length, 8, "Must declare 8 ERCOT geographic control areas");
  assert.ok(grid.generators.length >= 500, `Expected >= 500 generators, got ${grid.generators.length}`);
  assert.ok(grid.branches.length >= 1800, `Expected >= 1800 branches, got ${grid.branches.length}`);
  assert.ok(grid.transformers.length >= 60, `Expected >= 60 transformers, got ${grid.transformers.length}`);

  // Check 500 kV EHV backbone presence
  let ehvBusCount = 0;
  for (const b of grid.buses.values()) {
    if (b.baseKv === 500.0) ehvBusCount++;
  }
  assert.strictEqual(ehvBusCount, 16, "Must synthesize 2 EHV 500 kV hub buses per area (16 total)");

  // Check area names
  const areaNames = grid.areas.map((a) => a.arname);
  for (const name of ACTIVSG2000_AREAS) {
    assert.ok(areaNames.includes(name), `Missing expected area: ${name}`);
  }
});

test("ACTIVSg2000: PSS/E .raw file serialization", () => {
  const rawText = exportActivSg2000RawString();
  assert.ok(rawText.startsWith("0, 100.00, 33"), "Must start with PSS/E v33 Case Identification");
  assert.ok(rawText.includes("0 / END OF BUS DATA"), "Must contain standard PSS/E bus terminator");
  assert.ok(rawText.includes("0 / END OF BRANCH DATA"), "Must contain standard PSS/E branch terminator");
  assert.ok(rawText.includes("0 / END OF TRANSFORMER DATA"), "Must contain standard PSS/E transformer terminator");

  // Verify bus line formatting
  const lines = rawText.split("\n");
  assert.ok(lines.length > 5000, `Expected > 5000 text lines in .raw file, got ${lines.length}`);
});

test("ACTIVSg2000: Statistical Discrepancy & Theil's TIC calculation", () => {
  const n = 100;
  const sim = new Float64Array(n);
  const ref = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const val = 1.0 + 0.05 * Math.sin(i * 0.1);
    ref[i] = val;
    sim[i] = val + 0.0005 * Math.cos(i * 0.2); // Extremely close trajectory
  }

  const metrics = calculateSotaDiscrepancy(sim, ref, { ratedSpan: 0.1 });
  assert.strictEqual(metrics.status, "PASS", "Should pass with high fidelity");
  assert.ok(metrics.nrmsePercent < 1.0, `NRMSE should be < 1.0%, got ${metrics.nrmsePercent}%`);
  assert.ok(metrics.theilTic < 0.01, `Theil's TIC should be < 0.01, got ${metrics.theilTic}`);
  assert.ok(metrics.theilUc > 0.8, `Covariance proportion Uc should dominate random error, got ${metrics.theilUc}`);
});

test("ACTIVSg2000: End-to-end benchmark execution, PSS/E CSV & HTML export", async () => {
  const res = await runActivSg2000Benchmark({
    maxContingencies: 20,
    generateHtml: true,
  });

  assert.strictEqual(res.totalBuses, 2000);
  assert.ok(res.totalGenerationMw > 50000, `Total generation: ${res.totalGenerationMw} MW`);
  assert.strictEqual(res.accc.totalContingencies, 20);
  assert.ok(res.accc.throughputSolvesPerSec > 0);
  assert.strictEqual(res.comparisonVsSota.parityStatus, "PASS");

  // Verify PSS/E Tabulated CSV format
  assert.ok(res.psseTabulatedCsv.includes("CONTINGENCY LABEL,STATUS,ITERATIONS,MAX % LOADING"));
  const csvRows = res.psseTabulatedCsv.trim().split("\n");
  assert.strictEqual(csvRows.length, 21, "Header + 20 contingency records");

  // Verify HTML Dashboard output
  assert.ok(res.htmlDashboard, "Must generate self-contained HTML dashboard");
  assert.ok(res.htmlDashboard.includes("ACTIVSg2000 Texas Grid SOTA Power Flow & ACCC Benchmark"));
  assert.ok(res.htmlDashboard.includes("Theil's Inequality Decomposition"));
  assert.ok(res.htmlDashboard.includes("<svg viewBox="));
});
