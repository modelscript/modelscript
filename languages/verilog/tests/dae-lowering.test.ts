// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerVerilogToDae, verilogToDae } from "../src/dae/index.js";
import { parseVerilog } from "../src/parser/index.js";

describe("Verilog Linear-Memory DAE Lowering", () => {
  it("lowers combinational assign and gate primitives into DAEBuilder", () => {
    const design = parseVerilog(`
      module comb_logic (
        input a,
        input b,
        output y_and,
        output y_sum
      );
        and g1 (y_and, a, b);
        assign y_sum = a + b;
      endmodule
    `);

    const builder = new DAEBuilder(undefined, "comb_logic");
    const res = lowerVerilogToDae(builder, design);

    assert.strictEqual(res.moduleName, "comb_logic");
    assert.strictEqual(res.equationCount, 2);
    assert.ok(res.variableMap.has("a"));
    assert.ok(res.variableMap.has("b"));
    assert.ok(res.variableMap.has("y_and"));
    assert.ok(res.variableMap.has("y_sum"));
    assert.strictEqual(builder.eqCount, 2);
    assert.ok(builder.varCount >= 4);
  });

  it("lowers clocked registers and parameters into discrete DAE variables and next-state equations", () => {
    const design = parseVerilog(`
      module counter4 #(parameter INIT = 0) (
        input clk,
        input rst,
        output reg [3:0] count
      );
        always @(posedge clk) begin
          if (rst)
            count <= INIT;
          else
            count <= count + 1;
        end
      endmodule
    `);

    const dae = verilogToDae(design);
    assert.ok(dae.varCount >= 5, `Expected >= 5 variables (INIT, clk, rst, count, count_next), got ${dae.varCount}`);
    assert.ok(dae.eqCount >= 1, `Expected >= 1 equation, got ${dae.eqCount}`);
    assert.notStrictEqual(dae.lookupVariable("count"), -1);
    assert.notStrictEqual(dae.lookupVariable("count_next"), -1);
  });
});
