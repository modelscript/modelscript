// SPDX-License-Identifier: AGPL-3.0-or-later

import * as assert from "node:assert";
import test from "node:test";
import { generateCigreB4HvdcNetlist, runCigreB4Benchmark } from "../src/benchmarking/cigre-b4-hvdc.js";

test("CIGRE B4 DC Grid: Multi-Terminal HVDC & MMC netlist synthesis", () => {
  const netlist = generateCigreB4HvdcNetlist();

  // 4 AC buses + 4 Converter valve buses + 4 DC terminal buses = 12 buses
  assert.strictEqual(netlist.buses.size, 12, "Must declare 12 electrical buses");
  assert.strictEqual(netlist.sources.length, 5, "Must declare 5 sources (4 AC + 1 DC pole source)");
  assert.strictEqual(netlist.transformers.length, 4, "Must declare 4 converter transformers");
  assert.strictEqual(netlist.converterBridges?.length, 4, "Must declare 4 converter bridges (2 MMCs + 2 LCCs)");
  assert.strictEqual(netlist.transmissionLines.length, 4, "Must declare 4 DC transmission cables");
  assert.strictEqual(netlist.surgeArresters?.length, 2, "Must declare 2 DC surge arresters");
  assert.strictEqual(netlist.faults?.length, 1, "Must declare 1 DC pole-to-ground fault");

  // Verify MMC specifications
  const mmc1 = netlist.converterBridges?.find((b) => b.id === "MMC_1");
  assert.ok(mmc1, "Must find MMC_1");
  assert.strictEqual(mmc1?.kind, "mmc_thevenin");
  assert.strictEqual(mmc1?.numSubmodulesPerArm, 400);

  // Verify LCC specifications
  const lcc1 = netlist.converterBridges?.find((b) => b.id === "LCC_1");
  assert.ok(lcc1, "Must find LCC_1");
  assert.strictEqual(lcc1?.kind, "lcc_6pulse");
  assert.strictEqual(lcc1?.firingAngleDeg, 142.0);
});

test("CIGRE B4 DC Grid: Closed-loop EMT simulation, COMTRADE & PSOUT export", async () => {
  const res = await runCigreB4Benchmark({
    timeStepUs: 50.0,
    durationMs: 30.0, // 30 ms for fast test run
    generateHtml: true,
  });

  assert.strictEqual(res.caseName, "CIGRE_B4_Multi_Terminal_HVDC");
  assert.ok(res.totalSteps > 500, `Total steps: ${res.totalSteps}`);
  assert.ok(res.throughputStepsPerSec > 500, `Throughput: ${res.throughputStepsPerSec} steps/s`);
  assert.ok(res.minDcVoltageKv < 200.0, `Min DC voltage must drop during fault: ${res.minDcVoltageKv} kV`);

  // SOTA comparison statistics
  assert.strictEqual(res.comparisonVsSota.parityStatus, "PASS");
  assert.ok(
    res.comparisonVsSota.speedupFactor > 5.0,
    `Expected speedup > 5x, got ${res.comparisonVsSota.speedupFactor}`,
  );
  assert.ok(res.comparisonVsSota.theilTic < 0.02, `Theil's TIC must be < 0.02, got ${res.comparisonVsSota.theilTic}`);

  // COMTRADE .cff verification
  assert.ok(res.comtradeCff.includes("--- file type: CFG ---"), "Must include COMTRADE CFG section");
  assert.ok(res.comtradeCff.includes("--- file type: DAT ASCII ---"), "Must include COMTRADE DAT section");
  assert.ok(res.comtradeCff.includes("CIGRE_B4_STATION"), "Must include station header in COMTRADE");

  // PSCAD .psout binary verification
  assert.ok(res.psoutBinary.byteLength > 1000, `PSCAD .psout binary size: ${res.psoutBinary.byteLength} bytes`);

  // HTML Dashboard verification
  assert.ok(res.htmlDashboard, "Must generate HTML dashboard");
  assert.ok(res.htmlDashboard.includes("CIGRE B4 DC Grid Benchmark"));
  assert.ok(res.htmlDashboard.includes("Execution Speedup"));
});
