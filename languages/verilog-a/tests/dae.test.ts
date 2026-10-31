// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { compileVerilogAStamp, lowerVerilogAToDae } from "../src/dae/index.js";
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
    assert.strictEqual(arena.getVarCount(), arena.getEqCount(), "Diode DAE must be structurally square");
  });

  it("accumulates multiple <+ contributions on the same branch and lowers if/else with addIfElse (N_vars === N_eqs)", () => {
    const code = `
      module mosfet_rc(d, g, s);
        inout d, g, s;
        electrical d, g, s;
        parameter real Kp = 2e-4;
        parameter real Vth = 0.7;
        parameter real Cds = 1e-12;
        real Vgs, Vds, Ids, Qds;
        analog begin
          Vgs = V(g, s);
          Vds = V(d, s);
          if (Vgs > Vth) begin
            Ids = Kp * (Vgs - Vth) * Vds;
          end else begin
            Ids = 0.0;
          end
          Qds = Cds * Vds;
          I(d, s) <+ Ids;
          I(d, s) <+ ddt(Qds);
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    assert(doc.modules[0] !== undefined);
    const arena = lowerVerilogAToDae(doc.modules[0]);

    assert.strictEqual(
      arena.getVarCount(),
      arena.getEqCount(),
      `Expected square DAE (N_vars=${arena.getVarCount()} === N_eqs=${arena.getEqCount()})`,
    );
  });

  it("parses power (**) and ternary (?:) operators and computes symbolic automatic differentiation (AD)", () => {
    const code = `
      module shockley_diode(a, c);
        inout a, c;
        electrical a, c;
        parameter real Is = 1e-14;
        parameter real Vt = 0.02585;
        parameter real C0 = 2e-12;
        parameter real Vj = 0.7;
        real Vd, Id, Qd;
        analog begin
          Vd = V(a, c);
          Id = (Vd > -5.0 * Vt) ? Is * (limexp(Vd / Vt) - 1.0) : -Is;
          Qd = C0 * Vd + 1e-12 * (Vd ** 2);
          I(a, c) <+ Id + ddt(Qd);
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const mod = doc.modules[0]!;
    assert(mod !== undefined);

    const stamp = compileVerilogAStamp(mod);
    assert.strictEqual(stamp.branches.length, 1);
    const branch = stamp.branches[0]!;
    assert.strictEqual(branch.posNode, "a");
    assert.strictEqual(branch.negNode, "c");
    assert(branch.conductanceDerivatives.size >= 1);
    assert(branch.capacitanceDerivatives.size >= 1);

    // Evaluate at forward bias V(a,c) = 0.65 V
    const vd = 0.65;
    const isVal = 1e-14;
    const vtVal = 0.02585;
    const c0Val = 2e-12;
    const evalResult = stamp.evaluate({ a: vd, c: 0 });
    const bEval = evalResult.branches[0]!;

    const expectedId = isVal * (Math.exp(vd / vtVal) - 1.0);
    const expectedGd = (isVal / vtVal) * Math.exp(vd / vtVal);
    const expectedCd = c0Val + 2.0 * 1e-12 * vd;

    assert(
      Math.abs(bEval.staticCurrent - expectedId) / expectedId < 1e-9,
      `Expected static current ${expectedId}, got ${bEval.staticCurrent}`,
    );
    const gd = bEval.conductances["V(a,c)"]!;
    assert(
      Math.abs(gd - expectedGd) / expectedGd < 1e-9,
      `Expected symbolic AD conductance dI/dV = ${expectedGd}, got ${gd}`,
    );
    const cd = bEval.capacitances["V(a,c)"]!;
    assert(
      Math.abs(cd - expectedCd) / expectedCd < 1e-9,
      `Expected symbolic AD capacitance dQ/dV = ${expectedCd}, got ${cd}`,
    );
  });
});
