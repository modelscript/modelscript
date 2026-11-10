// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runFebioBenchmarks } from "./febio-benchmark-runner.js";

test("FEBio Benchmark: runs nonlinear hyperelasticity & biphasic cartilage compression benchmarks", async () => {
  await assert.doesNotReject(async () => {
    await runFebioBenchmarks();
  });
});
