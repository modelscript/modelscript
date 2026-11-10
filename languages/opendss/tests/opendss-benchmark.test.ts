// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runOpenDssBenchmarks } from "./opendss-benchmark-runner.js";

test("OpenDSS Benchmark Suite: EPRI IEEE Test Feeders", async (t) => {
  await t.test("converges multi-phase admittance power flow across benchmark decks", async () => {
    await assert.doesNotReject(async () => {
      await runOpenDssBenchmarks();
    });
  });
});
