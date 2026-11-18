// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plscaddLanguage } from "../src/language.js";

describe("PLS-CADD Language Plugin", () => {
  it("exposes language metadata and actions", () => {
    assert.equal(plscaddLanguage.name, "plscadd");
    assert.ok(plscaddLanguage.fileExtensions.includes(".pol"));
    assert.ok(plscaddLanguage.actions?.some((a) => a.id === "lint_plscadd"));
  });
});
