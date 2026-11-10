// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runSbmlBenchmarks } from "./sbml-benchmark-runner.js";

test("SBML Benchmark Suite: Systems Biology Reaction Networks", async (t) => {
  await t.test("executes semantic conformance and stiff limit-cycle benchmark models", async () => {
    await assert.doesNotReject(async () => {
      await runSbmlBenchmarks();
    });
  });
});
