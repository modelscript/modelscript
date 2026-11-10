// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runRocetsBenchmark } from "./rocets-benchmark-runner.js";

test("NASA ROCETS Benchmark: Staged Combustion Liquid Rocket Propulsion Cycle", () => {
  const rep = runRocetsBenchmark();

  assert.equal(rep.converged, true);
  assert.ok(rep.iterations <= 6, `Converged in ${rep.iterations} iterations`);
  assert.equal(rep.pcPa, 20.64e6);
  assert.ok(rep.totalMassFlowKgS > 450.0 && rep.totalMassFlowKgS < 500.0, `Mass flow ${rep.totalMassFlowKgS} kg/s`);
  assert.ok(rep.thrustVacN > 1.7e6 && rep.thrustVacN < 2.0e6, `Vacuum thrust ${rep.thrustVacN} N`);
  assert.ok(rep.ispVacSec > 380.0, `Vacuum Isp ${rep.ispVacSec} s`);
  assert.ok(rep.machExit > 4.5, `Exit Mach number ${rep.machExit} > 4.5`);
  assert.ok(rep.bartzHgcW_m2K > 50000.0, `Bartz coefficient ${rep.bartzHgcW_m2K} W/m^2-K`);
  assert.ok(rep.transientFinalThrustN > 1.7e6, `Transient final thrust ${rep.transientFinalThrustN} N`);
});
