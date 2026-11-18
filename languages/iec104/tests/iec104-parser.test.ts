// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIec104 } from "../src/parser/iec104-parser.js";

describe("IEC 60870-5-104 Parser", () => {
  it("parses text and JSON station profiles", () => {
    const src = `
station North_RTU ca=101 oa=1 port=2404 k=12 w=8 t1=15 t2=10
point 1001 M_SP_TB_1 Breaker_52A init=1
point 2001 M_ME_TF_1 Bus_kV units=kV scale=1.0 offset=0.0 deadband=0.2 init=138.0
`;
    const profile = parseIec104(src);
    assert.equal(profile.stationName, "North_RTU");
    assert.equal(profile.commonAddress, 101);
    assert.equal(profile.points.length, 2);

    const jsonProfile = parseIec104(JSON.stringify(profile));
    assert.equal(jsonProfile.points.length, 2);
  });
});
