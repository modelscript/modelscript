// SPDX-License-Identifier: AGPL-3.0-or-later

import * as assert from "node:assert";
import test from "node:test";
import { generatePegase9241Case, PEGASE_REGIONS, runPegase9241Benchmark } from "../src/benchmarking/pegase9241.js";
import { solveMultiIslandPowerFlow } from "../src/solver/island-solver.js";

test("PEGASE 9241: Procedural synthesis & European multi-tier topology integrity", () => {
  const grid = generatePegase9241Case();

  assert.strictEqual(grid.buses.size, 9241, "Must synthesize exactly 9,241 buses");
  assert.strictEqual(grid.areas.length, 8, "Must declare 8 European regional sync areas");
  assert.ok(grid.generators.length >= 1400, `Expected >= 1400 generators, got ${grid.generators.length}`);
  assert.ok(grid.branches.length >= 10000, `Expected >= 10,000 branches, got ${grid.branches.length}`);
  assert.ok(grid.transformers.length >= 30, `Expected >= 30 inter-tier transformers, got ${grid.transformers.length}`);

  // Voltage tier verification
  let v400Count = 0;
  let v220Count = 0;
  let v150Count = 0;
  let v110Count = 0;

  for (const b of grid.buses.values()) {
    if (b.basekv === 400.0) v400Count++;
    else if (b.basekv === 220.0) v220Count++;
    else if (b.basekv === 150.0) v150Count++;
    else if (b.basekv === 110.0) v110Count++;
  }

  assert.ok(v400Count > 1000, `Expected > 1000 400 kV buses, got ${v400Count}`);
  assert.ok(v220Count > 2500, `Expected > 2500 220 kV buses, got ${v220Count}`);
  assert.ok(v150Count > 2000, `Expected > 2000 150 kV buses, got ${v150Count}`);
  assert.ok(v110Count > 2000, `Expected > 2000 110 kV buses, got ${v110Count}`);

  // Check region names
  const areaNames = grid.areas.map((a) => a.arname);
  for (const name of PEGASE_REGIONS) {
    assert.ok(areaNames.includes(name), `Missing expected region: ${name}`);
  }
});

test("PEGASE 9241: Ill-conditioned power flow solve, ACCC screening & honest parity reporting", async () => {
  const res = await runPegase9241Benchmark({
    stressMultiplier: 1.0,
    contingencyScreenCount: 20, // 20 contingencies for fast test verification
    generateHtml: true,
  });

  assert.strictEqual(res.caseName, "PEGASE_9241_Pan_European_Grid");
  assert.strictEqual(res.totalBuses, 9241);
  assert.ok(res.totalBranches >= 10000);
  assert.ok(res.totalGenerators >= 1400);
  assert.ok(res.totalLoads >= 5000);
  assert.strictEqual(res.stressFactor, 1.0);
  assert.ok(res.conditionNumberEstimate > 1.0, `Condition ratio: ${res.conditionNumberEstimate}`);

  // Real sparse Newton-Raphson base power flow convergence
  assert.strictEqual(res.basePowerFlow.converged, true, "Newton-Raphson must converge on PEGASE 9,241");
  assert.ok(res.basePowerFlow.iterations <= 15, `Iterations: ${res.basePowerFlow.iterations}`);
  assert.ok(res.basePowerFlow.solveTimeMs > 0);

  // Real ACCC linear DFAX screening
  assert.strictEqual(res.accc.totalContingencies, 20);
  assert.strictEqual(res.accc.convergedContingencies, 20);
  assert.ok(res.accc.throughputSolvesPerSec > 5, `Throughput: ${res.accc.throughputSolvesPerSec} solves/sec`);

  // PSS/E Tabulated CSV export
  assert.ok(res.psseTabulatedCsv.includes("CONTINGENCY LABEL,STATUS,ITERATIONS"), "Must include PSS/E CSV headers");
  assert.ok(res.psseTabulatedCsv.includes("CONVERGED"), "Must record converged contingencies");

  // Without external reference data, SOTA comparison must remain UNVERIFIED with null deltas
  assert.strictEqual(res.comparisonVsSota.parityStatus, "UNVERIFIED");
  assert.strictEqual(res.comparisonVsSota.speedupFactor, null);
  assert.strictEqual(res.comparisonVsSota.sotaEstimatedDurationMs, null);
  assert.strictEqual(res.comparisonVsSota.theilTic, null);

  // HTML Dashboard verification
  assert.ok(res.htmlDashboard, "Must generate HTML dashboard");
  assert.ok(res.htmlDashboard.includes("PEGASE 9,241-Bus"));
  assert.ok(res.htmlDashboard.includes("UNVERIFIED"));

  // With external reference trace, real comparison metrics must be computed
  const refSol = solveMultiIslandPowerFlow(generatePegase9241Case(), {
    maxIterations: 25,
    tolerance: 1e-4,
    enforceQLimits: false,
  });
  const refVoltages = refSol.buses.slice(0, 500).map((b) => b.vm);
  const verified = await runPegase9241Benchmark({
    contingencyScreenCount: 5,
    generateHtml: false,
    referenceTrace: refVoltages,
    referenceWallClockMs: 5000.0,
    referenceTool: "External Reference",
  });
  assert.strictEqual(verified.comparisonVsSota.parityStatus, "PASS");
  assert.ok((verified.comparisonVsSota.speedupFactor ?? 0) > 0);
  assert.strictEqual(verified.comparisonVsSota.theilTic, 0);
});
