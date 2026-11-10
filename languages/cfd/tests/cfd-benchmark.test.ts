// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runCfdBenchmark } from "./cfd-benchmark-runner.js";

test("CFD Benchmark: NASA Langley NACA 0012 transonic aerodynamics and 1D FVM streamtube DAE lowering", () => {
  const metrics = runCfdBenchmark();

  assert.equal(metrics.dialect, "su2");
  assert.equal(metrics.mathProblem, "NAVIER_STOKES");
  assert.equal(metrics.machNumber, 0.799);
  assert.equal(metrics.aoaDeg, 1.25);
  assert.ok(metrics.clEstimated > 0.1 && metrics.clEstimated < 0.2);
  assert.ok(metrics.cdEstimated > 0.015 && metrics.cdEstimated < 0.03);
  assert.ok(metrics.liftNewtons > metrics.dragNewtons);
  assert.equal(metrics.daeVarCount, 19);
  assert.equal(metrics.daeEqCount, 19);
  assert.equal(metrics.isSquare, true);
});
