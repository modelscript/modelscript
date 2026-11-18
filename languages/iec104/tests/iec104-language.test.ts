// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { iec104Language } from "../src/language.js";

describe("IEC 60870-5-104 Language Plugin", () => {
  it("exposes language metadata and actions", async () => {
    assert.equal(iec104Language.name, "iec104");
    assert.ok(iec104Language.fileExtensions.includes(".iec104"));
    const lintAction = iec104Language.actions?.find((a) => a.id === "lint_iec104");
    assert.ok(lintAction);
  });
});
