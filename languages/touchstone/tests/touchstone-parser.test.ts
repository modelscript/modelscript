// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseTouchstone } from "../src/index.js";
import { TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK } from "./touchstone-benchmark-runner.js";

test("Touchstone Parser: parses 4-port RI matrix", () => {
  const ts = parseTouchstone(TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK, "benchmark.s4p");

  assert.equal(ts.numPorts, 4);
  assert.equal(ts.options.frequencyUnit, "GHZ");
  assert.equal(ts.options.parameterType, "S");
  assert.equal(ts.options.format, "RI");
  assert.equal(ts.options.referenceResistance, 50.0);
  assert.equal(ts.points.length, 5);

  const pt0 = ts.points[0]!;
  assert.equal(pt0.frequencyHz, 0.5e9);
  assert.equal(pt0.matrix.length, 4);
  assert.equal(pt0.matrix[0]!.length, 4);
});

test("Touchstone Parser: parses Touchstone 2.0 format", () => {
  const ts2 = `[Version] 2.0
[Number of Ports] 2
# GHz S DB R 50
1.0 -20.0 45.0 -1.0 -90.0 -1.0 -90.0 -20.0 45.0
`;
  const parsed = parseTouchstone(ts2);
  assert.equal(parsed.numPorts, 2);
  assert.equal(parsed.options.format, "DB");
  assert.equal(parsed.points.length, 1);
});
