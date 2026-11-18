// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexPowerWorldAux } from "../src/indexing.js";
import { getPowerWorldCompletions, getPowerWorldDiagnostics, getPowerWorldDocumentSymbols } from "../src/lsp.js";

describe("PowerWorld AUX LSP & Indexing", () => {
  const sample = `
DATA (Bus, [BusNum, BusName, BusNomVolt, BusSlack])
{
  1 "Bus1" 138.0 YES
}
SCRIPT
{
  SolvePowerFlow(RECTNEWT);
}
`;

  it("provides document symbols, diagnostics, completions, and URI check", () => {
    assert.equal(canIndexPowerWorldAux("case.aux"), true);
    assert.equal(canIndexPowerWorldAux("case.raw"), false);

    const symbols = getPowerWorldDocumentSymbols(sample);
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0]?.name, "DATA (Bus)");
    assert.equal(symbols[1]?.name, "SCRIPT");

    assert.equal(getPowerWorldDiagnostics(sample).length, 0);
    assert.ok(getPowerWorldCompletions().some((c) => c.label.includes("Bus")));
  });
});
