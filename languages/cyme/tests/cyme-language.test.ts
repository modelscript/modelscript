// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cymeLanguage } from "../src/language.js";

describe("CYME Language Plugin", () => {
  it("exposes language metadata and actions", () => {
    assert.equal(cymeLanguage.name, "cyme");
    assert.ok(cymeLanguage.fileExtensions.includes(".sxst"));
    assert.ok(cymeLanguage.actions?.some((a) => a.id === "cyme_to_opendss"));
  });
});
