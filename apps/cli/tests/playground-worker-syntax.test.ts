// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCompilerWorkerJs, getLspWorkerJs } from "../src/commands/playground.js";

describe("Playground Worker Syntax", () => {
  it("compiler worker js has valid syntax", () => {
    const code = getCompilerWorkerJs();
    assert.doesNotThrow(() => new Function(code));
  });

  it("lsp worker js has valid syntax", () => {
    const code = getLspWorkerJs();
    assert.doesNotThrow(() => new Function(code));
  });
});
