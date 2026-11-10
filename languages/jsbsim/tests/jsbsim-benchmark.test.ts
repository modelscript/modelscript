// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runJsbsimBenchmark } from "./jsbsim-benchmark-runner.js";

test("JSBSim Flight Dynamics Benchmark: 6-DOF Equations of Motion & Longitudinal Modes", () => {
  const rep = runJsbsimBenchmark();

  assert.equal(rep.aircraftName, "c172p_benchmark");
  assert.equal(rep.trimConverged, true);
  assert.ok(rep.trimThrottle > 0.2 && rep.trimThrottle < 0.6, `Throttle ${rep.trimThrottle}`);
  assert.ok(rep.shortPeriodOmegaRadSec > 3.0, `Short-period omega ${rep.shortPeriodOmegaRadSec}`);
  assert.ok(rep.shortPeriodZeta > 0.4 && rep.shortPeriodZeta < 0.9, `Short-period damping ${rep.shortPeriodZeta}`);
  assert.ok(rep.phugoidOmegaRadSec > 0.05 && rep.phugoidOmegaRadSec < 0.4, `Phugoid omega ${rep.phugoidOmegaRadSec}`);
  assert.ok(rep.simStepsCount >= 450);
  assert.equal(rep.isSquare, true);
});
