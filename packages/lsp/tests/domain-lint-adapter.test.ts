// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintMacromodelPassivity } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toLspDomainDiagnostics } from "../src/services/domain-lint-adapter.js";

describe("LSP domain lint adapter", () => {
  it("maps runtime domain diagnostics to LSP diagnostics", () => {
    const domainDiags = lintMacromodelPassivity({
      id: "s2p_port1",
      kind: "scattering",
      frequenciesHz: [1e9],
      values: [1.08],
    });
    const lspDiags = toLspDomainDiagnostics(domainDiags);
    assert.equal(lspDiags.length, 1);
    assert.equal(lspDiags[0]!.code, "M5102");
    assert.ok(lspDiags[0]!.message.includes("s2p_port1"));
  });
});
