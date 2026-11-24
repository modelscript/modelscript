// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getTwentySimCompletions,
  getTwentySimDocumentSymbols,
  getTwentySimHover,
  validateTwentySim,
} from "../src/lsp.js";

const SAMPLE_SID = `
model SpringMass
  submodels
    Se F (effort = 5);
    OneJunction j1;
    I m (i = 2);
    C k (c = 0.5);
  connections
    F.p => j1.p;
    j1.p => m.p;
    j1.p => k.p;
end SpringMass;
`;

describe("20-sim LSP Services", () => {
  it("returns clean diagnostics for valid bond graph and errors for conflicting sources", () => {
    assert.strictEqual(validateTwentySim(SAMPLE_SID).length, 0);

    const conflict = `
model Bad
  submodels
    Se A (effort = 1);
    Se B (effort = 2);
    ZeroJunction j0;
  connections
    A.p => j0.p;
    B.p => j0.p;
end Bad;
`;
    const diags = validateTwentySim(conflict);
    assert.ok(diags.some((d) => d.code === "TS4001"));
  });

  it("extracts hierarchical document symbols", () => {
    const syms = getTwentySimDocumentSymbols(SAMPLE_SID);
    assert.strictEqual(syms.length, 1);
    assert.strictEqual(syms[0]?.name, "SpringMass");
    assert.strictEqual(syms[0]?.children?.length, 4);
  });

  it("provides hover docs for Bond Graph elements and submodels", () => {
    const idx = SAMPLE_SID.indexOf("Se");
    const hover = getTwentySimHover(SAMPLE_SID, idx + 1);
    assert.ok(hover?.contents.value.includes("Effort Source"));
  });

  it("provides SIDOPS completion items", () => {
    const items = getTwentySimCompletions();
    assert.ok(items.some((i) => i.label === "equations"));
    assert.ok(items.some((i) => i.label === "ddt"));
  });
});
