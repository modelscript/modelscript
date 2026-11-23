// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VerilogErrorCode } from "../src/errors.js";
import { lintVerilog } from "../src/lints/index.js";
import { parseVerilog } from "../src/parser/index.js";

describe("Verilog Lints & Diagnostics (VLOG1001–VLOG5006)", () => {
  it("returns zero diagnostics for clean sequential + combinational RTL", () => {
    const design = parseVerilog(`
      module clean_dff (
        input clk,
        input rst,
        input [3:0] d,
        output reg [3:0] q,
        output wire [3:0] q_inv
      );
        assign q_inv = ~q;
        always @(posedge clk) begin
          if (rst)
            q <= 4'b0000;
          else
            q <= d;
        end
      endmodule
    `);
    const diags = lintVerilog(design);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("reports VLOG1001 on syntax errors", () => {
    const design = parseVerilog(`module broken (input a; endmodule`);
    const diags = lintVerilog(design);
    assert.ok(diags.some((d) => d.code === VerilogErrorCode.SYNTAX_ERROR.code));
  });

  it("reports VLOG2001 (duplicate port) and VLOG2002 (duplicate net)", () => {
    const design = parseVerilog(`
      module dup_mod (input a, input a, output y);
        wire w;
        wire w;
        assign y = a & w;
      endmodule
    `);
    const diags = lintVerilog(design);
    assert.ok(diags.some((d) => d.code === VerilogErrorCode.DUPLICATE_PORT.code));
    assert.ok(diags.some((d) => d.code === VerilogErrorCode.DUPLICATE_NET.code));
  });

  it("reports VLOG2003 on undeclared identifiers", () => {
    const design = parseVerilog(`
      module undef_mod (input a, output y);
        assign y = a & missing_sig;
      endmodule
    `);
    const diags = lintVerilog(design);
    assert.ok(
      diags.some((d) => d.code === VerilogErrorCode.UNDECLARED_IDENTIFIER.code && d.symbolName === "missing_sig"),
    );
  });

  it("reports VLOG3001 (blocking in sequential) and VLOG3002 (non-blocking in combinational)", () => {
    const design = parseVerilog(`
      module style_bad (input clk, input d, output reg q1, output reg q2);
        always @(posedge clk) begin
          q1 = d;
        end
        always @(*) begin
          q2 <= d;
        end
      endmodule
    `);
    const diags = lintVerilog(design);
    assert.ok(diags.some((d) => d.code === VerilogErrorCode.BLOCKING_IN_SEQUENTIAL.code && d.symbolName === "q1"));
    assert.ok(
      diags.some((d) => d.code === VerilogErrorCode.NONBLOCKING_IN_COMBINATIONAL.code && d.symbolName === "q2"),
    );
  });

  it("reports VLOG4001 (assigning to wire inside always) and VLOG4002 (multiple drivers on non-tri net)", () => {
    const design = parseVerilog(`
      module driver_bad (input a, input b, output wire y, output wire z);
        always @(*) begin
          y = a;
        end
        assign z = a;
        assign z = b;
      endmodule
    `);
    const diags = lintVerilog(design);
    assert.ok(diags.some((d) => d.code === VerilogErrorCode.ASSIGN_TO_WIRE_IN_ALWAYS.code && d.symbolName === "y"));
    assert.ok(diags.some((d) => d.code === VerilogErrorCode.MULTIPLE_DRIVERS.code && d.symbolName === "z"));
  });

  it("allows multiple drivers on tri nets without VLOG4002", () => {
    const design = parseVerilog(`
      module tri_bus (input a, input b, input en1, input en2, output tri bus_out);
        bufif1 b1 (bus_out, a, en1);
        bufif1 b2 (bus_out, b, en2);
      endmodule
    `);
    const diags = lintVerilog(design);
    assert.strictEqual(diags.filter((d) => d.code === VerilogErrorCode.MULTIPLE_DRIVERS.code).length, 0);
  });

  it("reports VLOG5006 bit-width truncation warning", () => {
    const design = parseVerilog(`
      module trunc_mod (input [7:0] wide_in, output [3:0] narrow_out);
        assign narrow_out = wide_in;
      endmodule
    `);
    const diags = lintVerilog(design);
    assert.ok(
      diags.some((d) => d.code === VerilogErrorCode.BIT_WIDTH_TRUNCATION.code && d.symbolName === "narrow_out"),
    );
  });
});
