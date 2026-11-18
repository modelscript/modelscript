// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pypsaLanguage } from "../src/language.js";

describe("PyPSA Language Plugin", () => {
  it("exposes language metadata and actions", () => {
    assert.equal(pypsaLanguage.name, "pypsa");
    assert.ok(pypsaLanguage.fileExtensions.includes(".pypsa"));
    assert.ok(pypsaLanguage.actions?.some((a) => a.id === "pypsa_to_ampl"));
  });
});
