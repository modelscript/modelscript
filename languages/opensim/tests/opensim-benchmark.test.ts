// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runOpenSimBenchmarks } from "./opensim-benchmark-runner.js";

test("OpenSim Benchmark: runs musculoskeletal benchmark models and DAE lowering", async () => {
  await assert.doesNotReject(async () => {
    await runOpenSimBenchmarks();
  });
});
