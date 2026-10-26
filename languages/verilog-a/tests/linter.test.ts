// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintVerilogA } from "../src/lints/index.js";
import { parseVerilogA } from "../src/parser/index.js";

describe("Verilog-A Pre-Flight Linter (M7601-M7620)", () => {
  it("passes clean model with zero diagnostics", () => {
    const code = `
      module resistor(p, n);
        inout p, n;
        electrical p, n;
        parameter real R = 100.0 from (0:inf);
        analog begin
          V(p, n) <+ I(p, n) * R;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const diags = lintVerilogA(doc);
    assert.strictEqual(diags.length, 0);
  });

  it("detects M7603: invalid parameter range default value", () => {
    const code = `
      module bad_param(p, n);
        inout p, n;
        electrical p, n;
        parameter real R = -5.0 from (0:inf);
        analog begin
          V(p, n) <+ I(p, n) * R;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const diags = lintVerilogA(doc);
    const d = diags.find((x) => x.code === "M7603");
    assert(d !== undefined);
    assert(d.message.includes("'R'"));
    assert(d.message.endsWith("."));
  });

  it("detects M7604: unbounded exp() usage", () => {
    const code = `
      module bad_exp(p, n);
        inout p, n;
        electrical p, n;
        real Id;
        analog begin
          Id = exp(V(p, n));
          I(p, n) <+ Id;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const diags = lintVerilogA(doc);
    const d = diags.find((x) => x.code === "M7604");
    assert(d !== undefined);
    assert(d.message.includes("'exp()'"));
    assert(d.quickFix !== undefined);
  });

  it("detects M7605: missing port discipline", () => {
    const code = `
      module no_disc(p, n);
        inout p, n;
        // missing electrical p, n;
        analog begin
          V(p, n) <+ 1.0;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const diags = lintVerilogA(doc);
    const d = diags.find((x) => x.code === "M7605");
    assert(d !== undefined);
    assert(d.message.includes("'p'"));
  });

  it("detects M7606: undefined node reference", () => {
    const code = `
      module undef_node(p, n);
        inout p, n;
        electrical p, n;
        analog begin
          V(p, unknown_node) <+ 1.0;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const diags = lintVerilogA(doc);
    const d = diags.find((x) => x.code === "M7606");
    assert(d !== undefined);
    assert(d.message.includes("'unknown_node'"));
  });

  it("detects M7607: duplicate module declaration", () => {
    const code = `
      module dup(p, n);
        inout p, n; electrical p, n;
        analog V(p, n) <+ 1.0;
      endmodule
      module dup(a, b);
        inout a, b; electrical a, b;
        analog V(a, b) <+ 2.0;
      endmodule
    `;
    const doc = parseVerilogA(code);
    const diags = lintVerilogA(doc);
    const d = diags.find((x) => x.code === "M7607");
    assert(d !== undefined);
    assert(d.message.includes("'dup'"));
  });

  it("detects M7608: zero-resistance branch short circuit", () => {
    const code = `
      module short_circuit(p, n);
        inout p, n;
        electrical p, n;
        analog begin
          V(p, n) <+ 0.0;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const diags = lintVerilogA(doc);
    const d = diags.find((x) => x.code === "M7608");
    assert(d !== undefined);
    assert(d.message.includes("V(p, n) <+ 0.0"));
  });

  it("detects M7609: floating internal node", () => {
    const code = `
      module floating(p, n);
        inout p, n;
        electrical p, n, internal_unused;
        analog begin
          V(p, n) <+ 1.0;
        end
      endmodule
    `;
    const doc = parseVerilogA(code);
    const diags = lintVerilogA(doc);
    const d = diags.find((x) => x.code === "M7609");
    assert(d !== undefined);
    assert(d.message.includes("'internal_unused'"));
  });
});
