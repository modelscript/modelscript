// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexGridlabd } from "../src/indexing.js";
import {
  getGridlabdCompletions,
  getGridlabdDiagnostics,
  getGridlabdDocumentSymbols,
  getGridlabdHover,
} from "../src/lsp.js";

describe("GridLAB-D LSP & Indexing", () => {
  const sample = `clock {
  timezone PST+8PDT;
  starttime '2000-01-01 00:00:00';
}
module powerflow;
object node {
  name bus1;
  bustype SWING;
  nominal_voltage 7200;
}`;

  it("provides document symbols, diagnostics, completions, hover, and URI check", () => {
    assert.equal(canIndexGridlabd("feeder.glm"), true);
    assert.equal(canIndexGridlabd("feeder.dss"), false);

    const symbols = getGridlabdDocumentSymbols(sample);
    assert.equal(symbols.length, 3);
    assert.equal(symbols[0]?.name, "clock");
    assert.equal(symbols[1]?.name, "module powerflow");
    assert.equal(symbols[2]?.name, "bus1");

    const diags = getGridlabdDiagnostics(sample);
    assert.equal(diags.length, 0);

    const completions = getGridlabdCompletions();
    assert.ok(completions.some((c) => c.label === "object node"));

    const hover = getGridlabdHover(sample, 6);
    assert.ok(hover && hover.includes("bus1"));
  });
});
