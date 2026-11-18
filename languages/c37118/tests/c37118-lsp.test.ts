// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexC37118 } from "../src/indexing.js";
import { getC37118Diagnostics, getC37118DocumentSymbols } from "../src/lsp.js";

describe("IEEE C37.118 LSP & Indexing", () => {
  it("provides symbols, diagnostics, and URI matching", () => {
    const src = `
pmu PMU_A idcode=10 fnom=60 rate=60
phasor VA V format=polar scale=1.0
analog P_MW units=MW scale=1.0
`;
    assert.equal(canIndexC37118("sub.c37118"), true);
    assert.equal(canIndexC37118("sub.pmu"), true);
    assert.equal(canIndexC37118("sub.raw"), false);
    assert.equal(getC37118DocumentSymbols(src).length, 2);
    assert.equal(getC37118Diagnostics(src).length, 0);
  });
});
