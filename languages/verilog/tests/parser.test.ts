// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVerilog } from "../src/parser/index.js";

describe("Verilog IEEE 1364 Parser", () => {
  it("parses ANSI module with parameters, bit-vectors, assign, always, if/else, and case", () => {
    const src = `
      // 4-bit ALU module
      /* Multi-line
         block comment */
      module alu4 #(parameter WIDTH = 4) (
        input [3:0] a,
        input [3:0] b,
        input [2:0] op,
        output reg [3:0] y,
        output wire zero
      );
        localparam ADD = 3'b000;
        assign zero = (y == 4'h0);
        always @(*) begin
          case (op)
            3'b000: y = a + b;
            3'b001: y = a - b;
            default: y = 4'b0000;
          endcase
        end
      endmodule
    `;
    const design = parseVerilog(src);
    assert.strictEqual(design.syntaxErrors.length, 0);
    assert.strictEqual(design.modules.length, 1);

    const mod = design.modules[0]!;
    assert.strictEqual(mod.name, "alu4");
    assert.deepStrictEqual(mod.portOrder, ["a", "b", "op", "y", "zero"]);
    assert.strictEqual(mod.parameters.get("WIDTH")?.isLocal, false);
    assert.strictEqual(mod.parameters.get("ADD")?.isLocal, true);
    assert.deepStrictEqual(mod.ports.get("a")?.range, { msb: 3, lsb: 0 });
    assert.strictEqual(mod.ports.get("y")?.netKind, "reg");
    assert.strictEqual(mod.items.length, 2);
    assert.strictEqual(mod.items[0]?.kind, "assign");
    assert.strictEqual(mod.items[1]?.kind, "always");
  });

  it("parses non-ANSI Verilog-1995 port lists, gate primitives, and module instantiations", () => {
    const src = `
      module full_adder (a, b, cin, sum, cout);
        input a, b, cin;
        output sum, cout;
        wire s1, c1, c2;

        xor g1 (s1, a, b);
        xor g2 (sum, s1, cin);
        and g3 (c1, a, b);
        and g4 (c2, s1, cin);
        or  g5 (cout, c1, c2);
      endmodule

      module top (input x, input y, input ci, output s, output co);
        full_adder u0 (.a(x), .b(y), .cin(ci), .sum(s), .cout(co));
      endmodule
    `;
    const design = parseVerilog(src);
    assert.strictEqual(design.syntaxErrors.length, 0);
    assert.strictEqual(design.modules.length, 2);

    const fa = design.modules[0]!;
    assert.strictEqual(fa.ports.size, 5);
    assert.strictEqual(fa.items.filter((i) => i.kind === "gate").length, 5);

    const top = design.modules[1]!;
    const inst = top.items[0];
    assert.strictEqual(inst?.kind, "instantiation");
    if (inst?.kind === "instantiation") {
      assert.strictEqual(inst.moduleType, "full_adder");
      assert.strictEqual(inst.instanceName, "u0");
      assert.strictEqual(inst.connections.length, 5);
    }
  });

  it("parses sized literals (binary, hex, octal, decimal, X/Z) and initial/always posedge blocks", () => {
    const src = `
      module reg_file (input clk, input rst, input [7:0] d, output reg [7:0] q);
        integer count;
        initial begin
          q = 8'hFF;
          count = 0;
        end
        always @(posedge clk or posedge rst) begin
          if (rst)
            q <= 8'b0000_0000;
          else
            q <= d;
        end
      endmodule
    `;
    const design = parseVerilog(src);
    assert.strictEqual(design.syntaxErrors.length, 0);
    const mod = design.modules[0]!;
    assert.strictEqual(mod.nets.get("count")?.kind, "integer");
    assert.strictEqual(mod.items[0]?.kind, "initial");
    const alwaysItem = mod.items[1];
    assert.strictEqual(alwaysItem?.kind, "always");
    if (alwaysItem?.kind === "always") {
      assert.strictEqual(alwaysItem.sensitivity.length, 2);
      assert.strictEqual(alwaysItem.sensitivity[0]?.kind, "posedge");
    }
  });
});
