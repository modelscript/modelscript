// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexRtds } from "../src/indexing.js";
import { getRtdsDiagnostics, getRtdsDocumentSymbols } from "../src/lsp.js";

describe("RTDS LSP & Indexing", () => {
  it("provides symbols, diagnostics, and URI matching", () => {
    const src = `
TIME_STEP 50e-6
COMPONENT SOURCE SRC1 nodes=N1,0 V=1000
`;
    assert.equal(canIndexRtds("hil.dft"), true);
    assert.equal(canIndexRtds("hil.atp"), false);
    assert.equal(getRtdsDocumentSymbols(src).length, 1);
    assert.equal(getRtdsDiagnostics(src).length, 0);
  });
});
