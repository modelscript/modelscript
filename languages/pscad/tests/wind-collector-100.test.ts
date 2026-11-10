// SPDX-License-Identifier: AGPL-3.0-or-later

import * as assert from "node:assert";
import test from "node:test";
import { generateWindCollector100Netlist, runWindCollectorBenchmark } from "../src/benchmarking/wind-collector-100.js";

test("100-Turbine Offshore Wind Collector: Netlist synthesis & feeder topology", () => {
  const netlist = generateWindCollector100Netlist({ scr: 2.0 });

  // 1 POI bus + 1 Substation 220kV bus + 1 Substation 33kV bus + 10 String Heads + 100 WTG 33kV + 100 WTG 0.69kV = 213 buses
  assert.strictEqual(
    netlist.buses.size,
    213,
    "Must synthesize exactly 213 electrical buses for 100-turbine offshore collector",
  );
  assert.strictEqual(
    netlist.transformers.length,
    101,
    "Must synthesize 100 WTG transformers + 1 main offshore substation transformer",
  );
  assert.strictEqual(netlist.converterBridges?.length, 100, "Must synthesize 100 Type-4 WTG converter bridges");
  assert.strictEqual(
    netlist.transmissionLines.length,
    101,
    "Must synthesize 100 inter-array cable segments + 1 45km export cable",
  );
  assert.strictEqual(netlist.faults?.length, 1, "Must declare 1 POI LVRT fault");

  // Verify export cable
  const exportCable = netlist.transmissionLines.find((l) => l.id === "EXPORT_CABLE_45KM");
  assert.ok(exportCable, "Must declare 45 km 220 kV export cable");
  assert.strictEqual(exportCable?.lengthKm, 45.0);

  // Verify main offshore transformer
  const mainXfr = netlist.transformers.find((t) => t.id === "XFR_MAIN_OFFSHORE");
  assert.ok(mainXfr, "Must declare main 900 MVA offshore transformer");
  assert.strictEqual(mainXfr?.mvaRating, 900.0);
  assert.strictEqual(mainXfr?.primaryKv, 220.0);
  assert.strictEqual(mainXfr?.secondaryKv, 33.0);
});

test("100-Turbine Offshore Wind Collector: Closed-loop EMT simulation, COMTRADE & PSOUT export", async () => {
  const res = await runWindCollectorBenchmark({
    timeStepUs: 20.0,
    durationMs: 25.0, // 25 ms for fast test run
    generateHtml: true,
  });

  assert.strictEqual(res.caseName, "Offshore_Wind_100_Turbine_800MW");
  assert.strictEqual(res.totalTurbines, 100);
  assert.strictEqual(res.totalCollectorStrings, 10);
  assert.ok(res.totalSteps > 1000, `Total steps: ${res.totalSteps}`);
  assert.ok(res.throughputStepsPerSec > 1000, `Throughput: ${res.throughputStepsPerSec} steps/s`);
  assert.ok(res.poiResidualVoltagePu >= 0, `POI residual voltage: ${res.poiResidualVoltagePu} pu`);

  // SOTA comparison statistics
  assert.strictEqual(res.comparisonVsSota.parityStatus, "PASS");
  assert.ok(res.comparisonVsSota.speedupFactor > 5.0, `Speedup factor: ${res.comparisonVsSota.speedupFactor}x`);
  assert.ok(res.comparisonVsSota.theilTic < 0.02, `Theil's TIC: ${res.comparisonVsSota.theilTic}`);

  // COMTRADE .cff verification
  assert.ok(res.comtradeCff.includes("--- file type: CFG ---"), "Must include COMTRADE CFG");
  assert.ok(res.comtradeCff.includes("OFFSHORE_WIND_800MW"), "Must include wind farm station name");

  // PSCAD .psout binary verification
  assert.ok(res.psoutBinary.byteLength > 1000, `PSCAD .psout binary size: ${res.psoutBinary.byteLength} bytes`);

  // HTML Dashboard verification
  assert.ok(res.htmlDashboard, "Must generate HTML dashboard");
  assert.ok(res.htmlDashboard.includes("100-Turbine Offshore Wind Collector Network"));
  assert.ok(res.htmlDashboard.includes("IEEE 2800 Compliance"));
});
