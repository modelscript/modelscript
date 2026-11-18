// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexIec104 } from "../src/indexing.js";
import { getIec104Diagnostics, getIec104DocumentSymbols } from "../src/lsp.js";

describe("IEC 60870-5-104 LSP & Indexing", () => {
  it("provides symbols, diagnostics, and URI matching", () => {
    const src = `
station RTU1 ca=1
point 1001 M_SP_TB_1 Breaker_52A
point 2001 M_ME_TF_1 Bus_kV units=kV
`;
    assert.equal(canIndexIec104("rtu.iec104"), true);
    assert.equal(canIndexIec104("rtu.dnp3"), false);
    assert.equal(getIec104DocumentSymbols(src).length, 2);
    assert.equal(getIec104Diagnostics(src).length, 0);
  });
});
