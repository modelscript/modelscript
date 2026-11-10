// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintTouchstone, parseTouchstone } from "../src/index.js";
import { TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK } from "./touchstone-benchmark-runner.js";

test("Touchstone Linter: clean differential benchmark reports 0 errors", () => {
  const ts = parseTouchstone(TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK, "benchmark.s4p");
  const diags = lintTouchstone(ts);

  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0);
});

test("Touchstone Linter: flags non-passive active amplifier", () => {
  const amp = `# GHz S MA R 50
1.0 0.1 0.0  4.5 180.0  0.01 0.0  0.15 0.0
`;
  const ts = parseTouchstone(amp, "amp.s2p");
  const diags = lintTouchstone(ts);

  const passivityDiag = diags.find((d) => d.message.toLowerCase().includes("passiv") || d.code.toString().includes("8"));
  assert.ok(passivityDiag !== undefined, "Linter must warn on passivity violation ||S|| > 1");
});
