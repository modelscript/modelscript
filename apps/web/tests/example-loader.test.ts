// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadExampleById, loadLanguageExamples } from "../src/pages/ansatz-editor/generated/example-loader.js";

describe("example-loader lazy chunk loading", () => {
  it("loads multi-file psse-03-ieee9-dynamics with both ieee9.raw and ieee9.dyr", async () => {
    const ex = await loadExampleById("psse-03-ieee9-dynamics");
    assert.ok(ex, "loadExampleById('psse-03-ieee9-dynamics') must return the example");
    assert.equal(ex.fileCount, 2);
    assert.equal(ex.activeFile, "ieee9.raw");
    assert.ok(ex.files?.["ieee9.raw"]?.includes("GEN1_230"), "ieee9.raw must be populated");
    assert.ok(ex.files?.["ieee9.dyr"]?.includes("GENROU"), "ieee9.dyr must be populated");
  });

  it("loads non-empty example chunks for psse, modelica, pscad, and sysml2", async () => {
    for (const lang of ["psse", "modelica", "pscad", "sysml2"]) {
      const items = await loadLanguageExamples(lang);
      assert.ok(items.length > 0, `expected loaded examples for ${lang}`);
    }
  });
});
