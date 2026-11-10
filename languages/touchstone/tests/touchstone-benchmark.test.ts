// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runTouchstoneBenchmark } from "./touchstone-benchmark-runner.js";

test("Touchstone Benchmark: 4-port differential transmission line SI analysis", () => {
  const metrics = runTouchstoneBenchmark();

  assert.equal(metrics.portsCount, 4, "Must parse 4 ports");
  assert.equal(metrics.frequenciesCount, 5, "Must parse 5 frequency points");
  assert.equal(metrics.isPassive, true, "Differential pair must be strictly passive");
  assert.ok(metrics.maxSingularValue <= 1.05, `Max singular value ${metrics.maxSingularValue} must be <= 1.05`);
  assert.ok(metrics.insertionLossDbAt1GHz > -3.0 && metrics.insertionLossDbAt1GHz < 0.0);
  assert.ok(metrics.nearEndCrosstalkDbAt1GHz < -25.0);
  assert.ok(metrics.fittedPolesCount >= 2, "Must fit stable poles");
  assert.ok(metrics.daeVarCount > 0, "DAE variables must be positive");
  assert.ok(metrics.daeEqCount > 0, "DAE equations must be positive");
});
