// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runOpticalBenchmark } from "./optical-benchmark-runner.js";

test("Optical Benchmark: 6-span 800 Gbps DWDM link transmission, GN-model NLI, and EDFA DAE lowering", () => {
  const metrics = runOpticalBenchmark();

  assert.equal(metrics.totalSpans, 6);
  assert.equal(metrics.totalLengthKm, 600.0);
  assert.equal(metrics.baudRateGbaud, 64.0);
  assert.ok(metrics.nliEfficiencyPerW2 > 100.0);
  assert.ok(metrics.gsnrDb > 20.0, `GSNR must exceed 20 dB, got ${metrics.gsnrDb}`);
  assert.ok(metrics.osnrMarginDb > 2.0, `OSNR margin must exceed 2 dB, got ${metrics.osnrMarginDb}`);
  assert.equal(metrics.edfaDaeVarCount, 6);
  assert.equal(metrics.edfaDaeEqCount, 5);
});
