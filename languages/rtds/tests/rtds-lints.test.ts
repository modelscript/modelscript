// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintRtdsDraft } from "../src/lints/index.js";
import { parseRtdsDraft } from "../src/parser/rtds-parser.js";

describe("RTDS Semantic Linter", () => {
  it("flags invalid time step, duplicate components, unconnected nodes, negative RLC, and missing source", () => {
    const bad = parseRtdsDraft(`
TIME_STEP 0
COMPONENT R R1 nodes=A,B R=-1
COMPONENT R R1
`);
    const codes = new Set(lintRtdsDraft(bad).map((d) => d.code));
    assert.ok(codes.has("RTDS1001"));
    assert.ok(codes.has("RTDS2001"));
    assert.ok(codes.has("RTDS2002"));
    assert.ok(codes.has("RTDS3001"));
    assert.ok(codes.has("RTDS4001"));
  });
});
