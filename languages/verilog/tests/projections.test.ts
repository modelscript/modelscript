// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVerilog } from "../src/parser/index.js";
import { verilogToModelica, verilogToVhdl } from "../src/projections/index.js";

const SAMPLE_RTL = `
  module dff_en #(parameter WIDTH = 4) (
    input clk,
    input rst,
    input en,
    input [3:0] d,
    output reg [3:0] q
  );
    always @(posedge clk) begin
      if (rst)
        q <= 4'b0000;
      else if (en)
        q <= d;
    end
  endmodule
`;

describe("Verilog Cross-Language Projections (Modelica Synchronous Clocks & VHDL)", () => {
  it("projects Verilog clocked module to Modelica 3.6 synchronous Clock model", () => {
    const design = parseVerilog(SAMPLE_RTL);
    const mo = verilogToModelica(design, { clockPeriodSec: 1e-3 });

    assert.ok(mo.includes("model dff_en"));
    assert.ok(mo.includes("Clock clk_sync = Clock(0.001);"));
    assert.ok(mo.includes("parameter Integer WIDTH = 4;"));
    assert.ok(mo.includes("when clk_sync then"));
    assert.ok(mo.includes("end when;"));
    assert.ok(mo.includes("end dff_en;"));
  });

  it("projects Verilog clocked module to IEEE 1076 VHDL entity & rtl architecture", () => {
    const design = parseVerilog(SAMPLE_RTL);
    const vhdl = verilogToVhdl(design);

    assert.ok(vhdl.includes("library ieee;"));
    assert.ok(vhdl.includes("use ieee.std_logic_1164.all;"));
    assert.ok(vhdl.includes("entity dff_en is"));
    assert.ok(vhdl.includes("WIDTH : integer := 4"));
    assert.ok(vhdl.includes("d : in std_logic_vector(3 downto 0)"));
    assert.ok(vhdl.includes("q : out std_logic_vector(3 downto 0)"));
    assert.ok(vhdl.includes("architecture rtl of dff_en is"));
    assert.ok(vhdl.includes("if rising_edge(clk) then"));
    assert.ok(vhdl.includes("end architecture rtl;"));
  });
});
