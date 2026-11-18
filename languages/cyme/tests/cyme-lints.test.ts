// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintCymeNetwork } from "../src/lints/index.js";
import { parseCyme } from "../src/parser/cyme-parser.js";

describe("CYME Semantic Linter", () => {
  it("flags duplicate nodes, missing sources, unresolved refs, and negative lengths/voltages", () => {
    const bad = parseCyme(`
[NODES]
N1 0 0 12.47
N1 0 0 -5
[SECTIONS]
L1 N1 MISSING ABC -10 OverheadLine
[LOADS]
LD1 MISSING ABC 50 10
`);
    const codes = new Set(lintCymeNetwork(bad).map((d) => d.code));
    assert.ok(codes.has("CYME2001"));
    assert.ok(codes.has("CYME2002"));
    assert.ok(codes.has("CYME3001"));
    assert.ok(codes.has("CYME3002"));
    assert.ok(codes.has("CYME4001"));
  });
});
