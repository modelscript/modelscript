// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runToughBenchmark } from "./tough-benchmark-runner.js";

test("TOUGH Benchmark: 5-block non-isothermal geothermal reservoir simulation and DAE lowering", () => {
  const metrics = runToughBenchmark();

  assert.equal(metrics.rocksCount, 2);
  assert.equal(metrics.elementsCount, 5);
  assert.equal(metrics.connectionsCount, 4);
  assert.equal(metrics.generatorsCount, 2);
  assert.equal(metrics.incondsCount, 5);
  assert.equal(metrics.wellsCount, 2);
  assert.ok(metrics.totalThermalPowerMW > 0, "Thermal power must be positive");
  assert.ok(metrics.prodSteamFraction >= 0, "Steam fraction must be >= 0");
  assert.equal(metrics.daeVarCount, 16);
  assert.equal(metrics.daeEqCount, 16);
  assert.equal(metrics.isSquare, true);
});
