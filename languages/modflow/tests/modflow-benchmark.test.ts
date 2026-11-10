// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runModflowBenchmark } from "./modflow-benchmark-runner.js";

test("USGS MODFLOW 6 Benchmark: 3D Multi-Layer Aquifer Flow & Pumping Drawdown", () => {
  const rep = runModflowBenchmark();

  assert.equal(rep.totalCells, 75);
  assert.equal(rep.totalPumpingRateM3Day, 1800.0);
  assert.ok(rep.maxDrawdownM > 0.2 && rep.maxDrawdownM < 1.0, `Drawdown ${rep.maxDrawdownM} m`);
  assert.equal(rep.activeWellsCount, 2);
  assert.equal(rep.activeRiversCount, 3);
  assert.equal(rep.daeVariablesCount, 75);
  assert.equal(rep.daeEquationsCount, 75, "Darcy flow balance DAE must be structurally square");
});
