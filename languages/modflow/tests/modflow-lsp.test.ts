// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { getModflowDocumentSymbols, ModflowWorkspaceIndex, validateModflow } from "../src/index.js";

const DECK = `
BEGIN DIS6
  NLAY 1
  NROW 2
  NCOL 2
  TOP 20.0
  BOTM 0.0
END DIS6
BEGIN NPF6
  K 10.0
END NPF6
`;

test("MODFLOW Workspace Index — indexes grid and boundary symbols", () => {
  const indexer = new ModflowWorkspaceIndex();
  const idx = indexer.indexFile("file:///aquifer.dis", DECK);
  assert.ok(idx.symbols.size > 0);
  assert.ok(idx.byName.has("MODFLOW_Aquifer"));
});

test("MODFLOW LSP — validates diagnostics and document symbols", () => {
  const diags = validateModflow(DECK);
  assert.strictEqual(diags.length, 0);

  const symbols = getModflowDocumentSymbols(DECK);
  assert.ok(symbols.length >= 2);
});
