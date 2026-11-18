// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintC37118Config } from "../src/lints/index.js";
import { parseC37118 } from "../src/parser/c37118-parser.js";

describe("IEEE C37.118 Linter", () => {
  it("flags invalid IDCODE, rate, duplicate phasors, and out-of-bounds frequency/ROCOF", () => {
    const bad = parseC37118(`
pmu BadPMU idcode=70000 fnom=60 rate=0
phasor VA V scale=0
phasor VA I scale=1.0
frame 2026-11-17T20:00:00Z 53.0 15.0
`);
    const codes = new Set(lintC37118Config(bad).map((d) => d.code));
    assert.ok(codes.has("C37_1001"));
    assert.ok(codes.has("C37_1002"));
    assert.ok(codes.has("C37_2001"));
    assert.ok(codes.has("C37_2002"));
    assert.ok(codes.has("C37_3001"));
    assert.ok(codes.has("C37_3002"));
  });
});
