// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintIec104Profile } from "../src/lints/index.js";
import { parseIec104 } from "../src/parser/iec104-parser.js";

describe("IEC 60870-5-104 Linter", () => {
  it("validates APCI parameters, common address, and IOA uniqueness", () => {
    const bad = parseIec104(`
station BadRTU ca=70000 k=4 w=8 t1=5 t2=10
point 100 M_SP_NA_1 Pt1
point 100 M_ME_NC_1 Pt2 deadband=-1
`);
    const codes = new Set(lintIec104Profile(bad).map((d) => d.code));
    assert.ok(codes.has("IEC104_1001"));
    assert.ok(codes.has("IEC104_1002"));
    assert.ok(codes.has("IEC104_1003"));
    assert.ok(codes.has("IEC104_2002"));
    assert.ok(codes.has("IEC104_3002"));
  });
});
