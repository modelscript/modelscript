// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { findVerilogAReferences, verilogALanguage } from "../src/index.js";

describe("Verilog-A UnifiedWorkspace", () => {
  it("indexes modules, ports, parameters, and variables across files", () => {
    const ws = new UnifiedWorkspace(verilogALanguage);
    const uri = "file:///models/diode.va";
    const code = `
      module diode(a, c);
        inout a, c;
        electrical a, c;
        parameter real Is = 1e-14;
        real Vd, Id;
        analog begin
          Vd = V(a, c);
          Id = Is * (limexp(Vd / 0.02585) - 1.0);
          I(a, c) <+ Id;
        end
      endmodule
    `;

    ws.setDocument(uri, code);
    assert.strictEqual(ws.fileCount, 1);
    assert(ws.hasDocument(uri));

    const sym = ws.findSymbolsByName("diode", uri)[0];
    assert(sym !== undefined);
    assert.strictEqual(sym.name, "diode");

    const all = ws.getSymbolsForUri(uri);
    assert(all.length >= 4); // diode, a, c, Is, Vd, Id

    const byName = ws.findSymbolsByName("Is");
    assert.strictEqual(byName.length, 1);
    assert.strictEqual(byName[0]?.name, "Is");

    const refs = findVerilogAReferences(ws, "diode");
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0]?.uri, uri);
  });
});
