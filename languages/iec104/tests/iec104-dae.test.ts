// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerIec104ToDae } from "../src/dae/iec104-to-dae.js";
import { parseIec104 } from "../src/parser/iec104-parser.js";

describe("IEC 60870-5-104 DAE Lowering", () => {
  it("lowers IOA monitoring and command points into DAEBuilder", () => {
    const profile = parseIec104(`
station RTU1 ca=1
point 1001 M_SP_TB_1 Breaker_52A init=1
point 2001 M_ME_TF_1 Bus_kV units=kV scale=1.0 init=138.0
`);
    const dae = lowerIec104ToDae(profile);
    assert.notEqual(dae.lookupVariable("ioa_1001_Breaker_52A"), -1);
    assert.notEqual(dae.lookupVariable("eng_ioa_2001_Bus_kV"), -1);
    assert.ok(dae.variables().length >= 3);
    assert.ok(dae.equations().length >= 2);
  });
});
