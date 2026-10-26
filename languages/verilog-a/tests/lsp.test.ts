// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { executeVerilogAAction, getVerilogADocumentSymbols, getVerilogAHover, validateVerilogA } from "../src/lsp.js";

describe("Verilog-A LSP Services", () => {
  const sampleCode = `
    module diode(a, c);
      inout a, c;
      electrical a, c;
      parameter real Is = 1e-14 from (0:inf);
      real Vd, Id;
      analog begin
        Vd = V(a, c);
        Id = Is * (limexp(Vd / 0.02585) - 1.0);
        I(a, c) <+ Id;
      end
    endmodule
  `;

  it("validates clean code without errors", () => {
    const diags = validateVerilogA(sampleCode);
    assert.strictEqual(diags.length, 0);
  });

  it("extracts document symbols", () => {
    const symbols = getVerilogADocumentSymbols(sampleCode);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0].name, "diode");
    assert(symbols[0].children !== undefined);
    assert(symbols[0].children.length >= 3);
  });

  it("provides hover information for module and ports", () => {
    const hover = getVerilogAHover(sampleCode, sampleCode.indexOf("module") + 2);
    assert(hover !== undefined);
    assert(hover.contents.value.includes("diode"));
  });

  it("executes language actions", async () => {
    const daeRes = await executeVerilogAAction("export_verilog_a_dae", sampleCode);
    assert.strictEqual(daeRes.moduleName, "diode");
    assert(daeRes.variableCount > 0);

    const moRes = await executeVerilogAAction("export_verilog_a_modelica", sampleCode);
    assert(moRes.includes("model diode"));

    const spiceRes = await executeVerilogAAction("export_verilog_a_spice", sampleCode);
    assert(spiceRes.includes(".SUBCKT diode"));
  });
});
