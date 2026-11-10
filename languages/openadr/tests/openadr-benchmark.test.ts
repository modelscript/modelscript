// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runOpenAdrBenchmark } from "./openadr-benchmark-runner.js";

test("OpenADR Benchmark: 4-interval industrial demand response curtailment and DAE lowering", () => {
  const metrics = runOpenAdrBenchmark();

  assert.equal(metrics.programsCount, 1);
  assert.equal(metrics.eventsCount, 1);
  assert.equal(metrics.intervalsCount, 4);
  assert.equal(metrics.baselineDemandKW, 600.0);
  assert.equal(metrics.minCurtailmentKW, 150.0);
  assert.equal(metrics.maxEnergyShedKWh, 750.0);
  assert.equal(metrics.eventDurationSeconds, 10800);
  assert.equal(metrics.daeVarCount, 2);
  assert.equal(metrics.daeEqCount, 2);
  assert.equal(metrics.isSquare, true);
});
