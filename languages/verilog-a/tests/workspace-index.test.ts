// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { VerilogAWorkspaceIndex } from "../src/workspace-index.js";

describe("Verilog-A Workspace Index", () => {
  it("indexes modules, ports, parameters, and variables across files", () => {
    const index = new VerilogAWorkspaceIndex();
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

    index.indexFile(uri, code);
    assert.strictEqual(index.fileCount, 1);
    assert(index.has(uri));

    const sym = index.findSymbol(uri, "diode");
    assert(sym !== undefined);
    assert.strictEqual(sym.name, "diode");

    const all = index.getAllSymbols(uri);
    assert(all.length >= 4); // diode, a, c, Is, Vd, Id

    const byName = index.findSymbolsByName("Is");
    assert.strictEqual(byName.length, 1);
    assert.strictEqual(byName[0].name, "Is");

    const refs = index.findReferences("diode");
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].uri, uri);
  });
});
