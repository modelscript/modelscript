// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rtdsLanguage } from "../src/language.js";

describe("RTDS Language Plugin", () => {
  it("exposes language metadata and actions", () => {
    assert.equal(rtdsLanguage.name, "rtds");
    assert.ok(rtdsLanguage.fileExtensions.includes(".dft"));
    assert.ok(rtdsLanguage.actions?.some((a) => a.id === "rtds_to_atp"));
  });
});
