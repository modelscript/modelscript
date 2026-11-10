// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runGtfsBenchmark } from "./gtfs-benchmark-runner.js";

test("GTFS Benchmark 43 — Metropolitan Multimodal Transit Network & Electric Bus Depot Charging", () => {
  const metrics = runGtfsBenchmark();

  assert.strictEqual(metrics.routesCount, 2);
  assert.strictEqual(metrics.stopsCount, 4);
  assert.strictEqual(metrics.tripsCount, 2);
  assert.strictEqual(metrics.totalDistanceM, 9700.0);

  // Power and energy verification
  assert.ok(metrics.totalEnergyKWh > 5.0, "Fleet energy consumption should exceed 5 kWh");
  assert.ok(metrics.peakTractionKW > 15.0, "Peak traction power should exceed 15 kW");
  assert.ok(metrics.depotPeakDemandKW > 0.0, "Depot peak demand must be positive");
  assert.strictEqual(metrics.depot24hHoursCount, 24);

  // DAE Arena: 2 trips * 3 vars + 3 depot vars = 9 vars, 9 eqs
  assert.strictEqual(metrics.daeVarCount, 9);
  assert.strictEqual(metrics.daeEqCount, 9);
  assert.strictEqual(metrics.isSquare, true);
});
