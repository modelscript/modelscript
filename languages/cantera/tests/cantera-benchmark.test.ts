// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runCanteraBenchmarks } from "./cantera-benchmark-runner.js";

test("Cantera Benchmark Suite: Upstream GRI-Mech 3.0 & Batch Reactor Kinetics", async (t) => {
  await t.test("converges multi-reaction combustion mechanisms and validates DAE lowering", async () => {
    await assert.doesNotReject(async () => {
      await runCanteraBenchmarks();
    });
  });
});
