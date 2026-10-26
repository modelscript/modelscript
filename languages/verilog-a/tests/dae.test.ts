// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerVerilogAToDae } from "../src/dae/index.js";
import { parseVerilogA } from "../src/parser/index.js";

describe("Verilog-A Linear DAE Lowering", () => {
  it("lowers linear resistor into DAEBuilder", () => {
    const code = `
      module resistor(p, n);
        inout p, n;
        electrical p, n;
        parameter real R = 1000.0 from (0:inf);
        analog begin
          V(p, n) <+ I(p, n) * R;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    assert(doc.modules[0] !== undefined);
    const arena = lowerVerilogAToDae(doc.modules[0]);

    assert(arena.getVarCount() >= 3, `Expected at least 3 variables, got ${arena.getVarCount()}`);
    assert(arena.getEqCount() >= 1, `Expected at least 1 equation, got ${arena.getEqCount()}`);
  });

  it("lowers dynamic diode with ddt into DAE equations", () => {
    const code = `
      module diode(a, c);
        inout a, c;
        electrical a, c;
        parameter real Is = 1e-14;
        parameter real Cj0 = 1e-12;
        real Vd, Id, Qd;
        analog begin
          Vd = V(a, c);
          Id = Is * (limexp(Vd / 0.02585) - 1.0);
          Qd = Cj0 * Vd;
          I(a, c) <+ Id + ddt(Qd);
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    assert(doc.modules[0] !== undefined);
    const arena = lowerVerilogAToDae(doc.modules[0]);

    assert(arena.getVarCount() >= 5);
    assert(arena.getEqCount() >= 3);
  });
});
