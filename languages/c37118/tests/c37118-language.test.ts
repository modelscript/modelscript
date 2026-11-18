// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { c37118Language } from "../src/language.js";

describe("IEEE C37.118 Language Plugin", () => {
  it("exposes language metadata and actions", () => {
    assert.equal(c37118Language.name, "c37118");
    assert.ok(c37118Language.fileExtensions.includes(".c37118"));
    assert.ok(c37118Language.actions?.some((a) => a.id === "lint_c37118"));
  });
});
