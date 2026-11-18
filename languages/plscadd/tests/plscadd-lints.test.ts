// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPlsCadd } from "../src/lints/index.js";
import { parsePlsCadd } from "../src/parser/plscadd-parser.js";

describe("PLS-CADD Mechanical & Clearance Linter", () => {
  it("flags duplicate structures, unresolved refs, clearance violations, and over-tension", () => {
    const bad = parsePlsCadd(`
CONDUCTOR ACSR weight_n_per_m=20.0 rated_tension_n=50000
STRUCTURE T1 x=0 y=0 z_base=0 height_m=15
STRUCTURE T1 x=0 y=0 z_base=0 height_m=15
STRUCTURE T2 x=400 y=0 z_base=0 height_m=15
SPAN S_LOW from=T1 to=T2 conductor=ACSR tension_n=20000 min_clearance_m=10.0
SPAN S_OVER from=T1 to=T2 conductor=ACSR tension_n=80000 min_clearance_m=5.0
SPAN S_BAD from=T1 to=MISSING conductor=ACSR tension_n=25000
`);
    const codes = new Set(lintPlsCadd(bad).map((d) => d.code));
    assert.ok(codes.has("PLSCADD2001"));
    assert.ok(codes.has("PLSCADD2002"));
    assert.ok(codes.has("PLSCADD4001"));
    assert.ok(codes.has("PLSCADD4002"));
  });
});
