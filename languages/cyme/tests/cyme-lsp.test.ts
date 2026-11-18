// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexCyme } from "../src/indexing.js";
import { getCymeDiagnostics, getCymeDocumentSymbols } from "../src/lsp.js";

describe("CYME LSP & Indexing", () => {
  it("provides symbols, diagnostics, and URI matching", () => {
    const src = `
[NODES]
N1 0 0 12.47
[SOURCES]
S1 N1 12.47 12.47
`;
    assert.equal(canIndexCyme("feeder.sxst"), true);
    assert.equal(canIndexCyme("feeder.cyme"), true);
    assert.equal(canIndexCyme("feeder.dss"), false);
    assert.equal(getCymeDocumentSymbols(src).length, 1);
    assert.equal(getCymeDiagnostics(src).length, 0);
  });
});
