// SPDX-License-Identifier: AGPL-3.0-or-later

import * as assert from "node:assert";
import test from "node:test";
import { generateEhvCorridorNetlist, runEhvCorridorBenchmark } from "../src/benchmarking/ehv-corridor.js";

test("500 kV EHV Corridor ULM Benchmark: Netlist synthesis & hybrid line topology", () => {
  const netlist = generateEhvCorridorNetlist();

  // 4 buses: Sending (500 kV), Junction (500 kV), Receiving (500 kV), Tertiary (35 kV)
  assert.strictEqual(netlist.buses.size, 4, "Must synthesize 4 electrical buses");
  assert.strictEqual(netlist.transmissionLines.length, 2, "Must declare 300 km OHL + 50 km subsea cable");
  assert.strictEqual(netlist.transformers.length, 1, "Must declare 500/35 kV tertiary transformer");
  assert.strictEqual(netlist.branches.length, 1, "Must declare 150 Mvar shunt reactor");
  assert.strictEqual(netlist.surgeArresters?.length, 1, "Must declare 420 kV MOV surge arrester");
  assert.strictEqual(netlist.faults?.length, 1, "Must declare 1 transition junction fault");

  // Verify 300 km untransposed OHL
  const ohl = netlist.transmissionLines.find((l) => l.id === "LINE_OHL_300KM");
  assert.ok(ohl, "Must declare 300 km OHL line");
  assert.strictEqual(ohl?.lengthKm, 300.0);
  assert.strictEqual(ohl?.modelType, "ulm");
  assert.strictEqual(ohl?.bundleCount, 4);
  assert.strictEqual(ohl?.towerHeightM, 35.0);

  // Verify 50 km subsea XLPE submarine cable
  const cable = netlist.transmissionLines.find((l) => l.id === "CABLE_SUBSEA_50KM");
  assert.ok(cable, "Must declare 50 km subsea cable");
  assert.strictEqual(cable?.lengthKm, 50.0);
  assert.strictEqual(cable?.modelType, "ulm");
  assert.strictEqual(cable?.isCable, true);
});

test("500 kV EHV Corridor ULM Benchmark: Closed-loop EMT simulation, COMTRADE & PSOUT export", async () => {
  const res = await runEhvCorridorBenchmark({
    timeStepUs: 20.0,
    durationMs: 30.0, // 30 ms for fast test verification
    generateHtml: true,
  });

  assert.strictEqual(res.caseName, "EHV_Corridor_500kV_ULM_Benchmark");
  assert.strictEqual(res.totalLengthKm, 350.0);
  assert.strictEqual(res.ohlLengthKm, 300.0);
  assert.strictEqual(res.cableLengthKm, 50.0);
  assert.ok(res.totalSteps > 1000, `Total steps: ${res.totalSteps}`);
  assert.ok(res.throughputStepsPerSec > 1000, `Throughput: ${res.throughputStepsPerSec} steps/s`);
  assert.ok(res.peakOvervoltageKv > 0, `Peak overvoltage: ${res.peakOvervoltageKv} kV`);
  assert.ok(res.steepestTrvRrrvKvPerUs >= 2.0, `Steepest TRV RRRV: ${res.steepestTrvRrrvKvPerUs} kV/us`);
  assert.strictEqual(res.modalDelaySeparationMs, 0.25);

  // SOTA comparison statistics
  assert.strictEqual(res.comparisonVsSota.parityStatus, "PASS");
  assert.ok(res.comparisonVsSota.speedupFactor > 5.0, `Speedup factor: ${res.comparisonVsSota.speedupFactor}x`);
  assert.ok(res.comparisonVsSota.theilTic < 0.02, `Theil's TIC: ${res.comparisonVsSota.theilTic}`);

  // COMTRADE .cff verification
  assert.ok(res.comtradeCff.includes("--- file type: CFG ---"), "Must include COMTRADE CFG");
  assert.ok(res.comtradeCff.includes("EHV_CORRIDOR_500KV"), "Must include EHV corridor station name");

  // PSCAD .psout binary verification
  assert.ok(res.psoutBinary.byteLength > 1000, `PSCAD .psout binary size: ${res.psoutBinary.byteLength} bytes`);

  // HTML Dashboard verification
  assert.ok(res.htmlDashboard, "Must generate HTML dashboard");
  assert.ok(res.htmlDashboard.includes("500 kV EHV Corridor ULM Benchmark"));
  assert.ok(res.htmlDashboard.includes("CIGRE 33.02 Parity"));
});
