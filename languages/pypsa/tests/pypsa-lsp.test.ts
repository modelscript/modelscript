// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexPypsa } from "../src/indexing.js";
import { getPypsaDiagnostics, getPypsaDocumentSymbols } from "../src/lsp.js";

describe("PyPSA LSP & Indexing", () => {
  it("provides symbols, diagnostics, and URI matching", () => {
    const src = `
bus B1 v_nom=380
generator G1 bus=B1 p_nom=100
`;
    assert.equal(canIndexPypsa("grid.pypsa"), true);
    assert.equal(canIndexPypsa("grid.dss"), false);
    assert.equal(getPypsaDocumentSymbols(src).length, 2);
    assert.equal(getPypsaDiagnostics(src).length, 0);
  });
});
