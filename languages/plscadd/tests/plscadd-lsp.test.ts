// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexPlsCadd } from "../src/indexing.js";
import { getPlsCaddDiagnostics, getPlsCaddDocumentSymbols } from "../src/lsp.js";

describe("PLS-CADD LSP & Indexing", () => {
  it("provides symbols, diagnostics, and URI matching", () => {
    const src = `
CONDUCTOR Drake weight_n_per_m=16.0
STRUCTURE T1 x=0 y=0 height_m=30
STRUCTURE T2 x=200 y=0 height_m=30
SPAN S1 from=T1 to=T2 conductor=Drake tension_n=30000 min_clearance_m=8.0
`;
    assert.equal(canIndexPlsCadd("line.pol"), true);
    assert.equal(canIndexPlsCadd("line.plscadd"), true);
    assert.equal(canIndexPlsCadd("line.raw"), false);
    assert.equal(getPlsCaddDocumentSymbols(src).length, 3);
    assert.equal(getPlsCaddDiagnostics(src).length, 0);
  });
});
