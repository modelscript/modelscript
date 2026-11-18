// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerCymeToDae } from "../src/dae/cyme-to-dae.js";
import { parseCyme } from "../src/parser/cyme-parser.js";

describe("CYME DAE Lowering", () => {
  it("lowers CYME nodes, sections, and spot loads into DAEBuilder", () => {
    const net = parseCyme(`
[NODES]
N1 0 0 12.47
N2 100 0 12.47
[SOURCES]
S1 N1 12.47 12.47
[SECTIONS]
SEC1 N1 N2 ABC 300 OverheadLine 0.2 0.4
[LOADS]
LD1 N2 ABC 250 50
`);
    const dae = lowerCymeToDae(net);
    assert.notEqual(dae.lookupVariable("V_N1"), -1);
    assert.notEqual(dae.lookupVariable("V_N2"), -1);
    assert.notEqual(dae.lookupVariable("I_sec_SEC1"), -1);
    assert.notEqual(dae.lookupVariable("I_load_LD1"), -1);
    assert.ok(dae.equations().length >= 5);
  });
});
