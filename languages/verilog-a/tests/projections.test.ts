// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseVerilogA } from "../src/parser/index.js";
import { verilogAToModelica, verilogAToSpice } from "../src/projections/index.js";

describe("Verilog-A Bidirectional Projections", () => {
  it("projects Verilog-A module to Modelica 3.x acausal electrical model", () => {
    const code = `
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
    const doc = parseVerilogA(code);
    const mo = verilogAToModelica(doc.modules[0]);

    assert(mo.includes("model diode"));
    assert(mo.includes("PositivePin a;"));
    assert(mo.includes("NegativePin c;"));
    assert(mo.includes("parameter Real Is = 1e-14;"));
    assert(mo.includes("equation"));
    assert(mo.includes("end diode;"));
  });

  it("projects Verilog-A module to SPICE subcircuit with B-sources", () => {
    const code = `
      module resistor(p, n);
        inout p, n;
        electrical p, n;
        parameter real R = 50.0;
        analog begin
          V(p, n) <+ I(p, n) * R;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const spice = verilogAToSpice(doc.modules[0]);

    assert(spice.includes(".SUBCKT resistor p n"));
    assert(spice.includes(".PARAM R=50"));
    assert(spice.includes(".ENDS resistor"));
  });

  it("accumulates multiple <+ branch contributions and projects I(p, n) flow access in Modelica", () => {
    const code = `
      module parallel_rc(p, n);
        inout p, n;
        electrical p, n;
        parameter real G = 0.01;
        parameter real C = 1e-9;
        real Q;
        analog begin
          Q = C * V(p, n);
          I(p, n) <+ G * V(p, n);
          I(p, n) <+ ddt(Q);
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const mo = verilogAToModelica(doc.modules[0]!);
    const pinIEqCount = mo.split("\n").filter((l) => l.trim().startsWith("p.i =")).length;
    assert.strictEqual(pinIEqCount, 1, "Multiple <+ contributions on (p, n) must be summed into a single p.i equation");
    assert(mo.includes("der(Q)"), "Expected ddt(Q) projected as der(Q)");
  });
});
