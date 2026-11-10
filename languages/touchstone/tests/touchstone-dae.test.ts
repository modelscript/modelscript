// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerTouchstoneToDae, parseTouchstone } from "../src/index.js";
import { TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK } from "./touchstone-benchmark-runner.js";

test("Touchstone DAE Lowering: builds state-space DAE arena for 4-port network", () => {
  const ts = parseTouchstone(TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK, "benchmark.s4p");
  const dae = lowerTouchstoneToDae(ts);

  assert.ok(dae.getVarCount() > 0, "DAE must declare state and port variables");
  assert.ok(dae.getEqCount() > 0, "DAE must declare linear differential/algebraic equations");
});
