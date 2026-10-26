// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseVerilogA, tokenizeVerilogA } from "../src/parser/index.js";

describe("Verilog-A Parser & Lexer", () => {
  it("tokenizes keywords, identifiers, numbers, and operators", () => {
    const code = `
      module res(p, n);
        inout p, n;
        electrical p, n;
        parameter real R = 100.0 from (0:inf);
        analog begin
          V(p, n) <+ I(p, n) * R;
        end
      endmodule
    `;
    const tokens = tokenizeVerilogA(code);
    assert(tokens.length > 10);
    assert(tokens.some((t) => t.value === "module"));
    assert(tokens.some((t) => t.value === "<+"));
    assert(tokens.some((t) => t.value === "100.0"));
  });

  it("parses linear resistor module", () => {
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
    assert.strictEqual(doc.modules.length, 1);
    const mod = doc.modules[0];
    assert.strictEqual(mod.name, "resistor");
    assert.strictEqual(mod.ports.length, 2);
    assert.strictEqual(mod.ports[0].name, "p");
    assert.strictEqual(mod.ports[0].discipline, "electrical");
    assert.strictEqual(mod.parameters.length, 1);
    assert.strictEqual(mod.parameters[0].name, "R");
    assert.strictEqual(mod.parameters[0].defaultValue, 1000.0);
    assert(mod.analogBlock !== undefined);
    assert.strictEqual(mod.analogBlock.statements.length, 1);
    const stmt = mod.analogBlock.statements[0];
    assert.strictEqual(stmt.kind, "contribution");
  });

  it("parses non-linear diode with limexp and ddt", () => {
    const code = `
      \`include "disciplines.vams"

      module diode(a, c);
        inout a, c;
        electrical a, c;

        parameter real Is = 1e-14 from (0:inf);
        parameter real N = 1.0 from (0:inf);
        parameter real Cj0 = 1e-12 from [0:inf);

        real Vd, Id, Qd;

        analog begin
          Vd = V(a, c);
          Id = Is * (limexp(Vd / (N * $vt)) - 1.0);
          Qd = Cj0 * Vd;
          I(a, c) <+ Id + ddt(Qd);
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    assert.strictEqual(doc.includes.length, 1);
    assert.strictEqual(doc.includes[0], "disciplines.vams");
    assert.strictEqual(doc.modules.length, 1);

    const mod = doc.modules[0];
    assert.strictEqual(mod.name, "diode");
    assert.strictEqual(mod.variables.length, 3);
    assert.strictEqual(mod.parameters.length, 3);
    assert(mod.analogBlock !== undefined);
    assert.strictEqual(mod.analogBlock.statements.length, 4);
  });

  it("parses MOS transistor with conditional if-else branches", () => {
    const code = `
      module mos_n(d, g, s, b);
        inout d, g, s, b;
        electrical d, g, s, b;

        parameter real W = 10e-6;
        parameter real L = 1e-6;
        parameter real Vto = 0.7;
        parameter real Kp = 50e-6;
        parameter real Lambda = 0.02;

        real Vgs, Vds, Ids, beta;

        analog begin
          Vgs = V(g, s);
          Vds = V(d, s);
          beta = Kp * W / L;
          if (Vgs <= Vto) begin
            Ids = 0.0;
          end else begin
            Ids = beta * (Vgs - Vto) * Vds;
          end
          I(d, s) <+ Ids;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const mod = doc.modules[0];
    assert.strictEqual(mod.name, "mos_n");
    assert.strictEqual(mod.ports.length, 4);
    assert.strictEqual(mod.parameters.length, 5);
    assert(mod.analogBlock !== undefined);
  });
});
