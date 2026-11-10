// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTouchstone,
  fitStateSpaceModel,
  verifyPassivity,
} from "../src/index.js";
import { TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK } from "./touchstone-benchmark-runner.js";

test("Touchstone Vector Fitting: fits stable poles from S-parameters", () => {
  const ts = parseTouchstone(TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK, "benchmark.s4p");
  const ss = fitStateSpaceModel(ts, 4);

  assert.ok(ss.poles.length >= 2, "Must identify poles");
  for (const p of ss.poles) {
    assert.ok(p.re < 0, "Poles must be in left half-plane (stable)");
  }
});

test("Touchstone Passivity: verifies unitary bounds on passive line", () => {
  const ts = parseTouchstone(TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK, "benchmark.s4p");
  const passivity = verifyPassivity(ts);

  assert.equal(passivity.isPassive, true);
  assert.ok(passivity.maxNorm <= 1.05);
});
