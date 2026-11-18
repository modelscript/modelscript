// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerRtdsToDae } from "../src/dae/rtds-to-dae.js";
import { parseRtdsDraft } from "../src/parser/rtds-parser.js";

describe("RTDS DAE Lowering", () => {
  it("lowers RTDS EMT sources, R/L/C branches, and nodal KCL into DAEBuilder", () => {
    const draft = parseRtdsDraft(`
CASE EMT_Sub1
TIME_STEP 50e-6
COMPONENT SOURCE VSRC nodes=N1,0 V=1000
COMPONENT R R1 nodes=N1,N2 R=2.0
COMPONENT L L1 nodes=N2,N3 L=0.005
COMPONENT C C1 nodes=N3,0 C=1e-6
`);
    const dae = lowerRtdsToDae(draft);
    assert.notEqual(dae.lookupVariable("v_N1"), -1);
    assert.notEqual(dae.lookupVariable("v_N2"), -1);
    assert.notEqual(dae.lookupVariable("i_L1"), -1);
    assert.ok(dae.equations().length >= 6);
  });
});
