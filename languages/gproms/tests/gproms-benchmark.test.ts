// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runGpromsBenchmark } from "./gproms-benchmark-runner.js";

test("gPROMS Benchmark: 1D tubular reactor PDE-DAE Method-of-Lines simulation and DAE lowering", () => {
  const m = runGpromsBenchmark();

  assert.equal(m.modelName, "AxialDispersionPFR");
  assert.equal(m.processName, "PfrSimulation");
  assert.equal(m.gridPoints, 11);
  assert.equal(m.inletConcentration, 10.0);
  assert.ok(m.outletConcentration > 4.0 && m.outletConcentration < 5.0);
  assert.ok(m.conversionPercent > 50.0 && m.conversionPercent < 60.0);
  assert.equal(m.isMonotonic, true);
  assert.ok(m.daeVarCount >= 10);
  assert.equal(m.daeVarCount, m.daeEqCount);
  assert.equal(m.isSquare, true);
});
