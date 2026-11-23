// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { vhdlToModelica, vhdlToVerilog } from "../src/index.js";

const SAMPLE_COUNTER = `
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity counter4 is
  generic (
    WIDTH : integer := 4
  );
  port (
    clk : in  std_logic;
    rst : in  std_logic;
    q   : out std_logic_vector(3 downto 0)
  );
end entity counter4;

architecture rtl of counter4 is
  signal cnt : std_logic_vector(3 downto 0);
begin
  process(clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        cnt <= "0000";
      else
        cnt <= std_logic_vector(unsigned(cnt) + 1);
      end if;
    end if;
  end process;

  q <= cnt;
end architecture rtl;
`;

describe("@modelscript/vhdl — Cross-Language Projections (Modelica Synchronous Clocks & Verilog)", () => {
  it("projects VHDL synchronous counter to Modelica 3.3+ clocked model", () => {
    const mo = vhdlToModelica(SAMPLE_COUNTER);
    assert.ok(mo.includes("model counter4"));
    assert.ok(mo.includes("Clock clk_sync = Clock(clkPeriod);"));
    assert.ok(mo.includes("input discrete Boolean clk;"));
    assert.ok(mo.includes("output discrete Integer q;"));
    assert.ok(mo.includes("when sample(0, clkPeriod) then"));
    assert.ok(mo.includes("end counter4;"));
  });

  it("projects VHDL synchronous counter to synthesizable IEEE 1364 Verilog", () => {
    const v = vhdlToVerilog(SAMPLE_COUNTER);
    assert.ok(v.includes("module counter4"));
    assert.ok(v.includes("parameter WIDTH = 4"));
    assert.ok(v.includes("input wire clk"));
    assert.ok(v.includes("output wire [3:0] q"));
    assert.ok(v.includes("reg [3:0] cnt;"));
    assert.ok(v.includes("always @(posedge clk) begin"));
    assert.ok(v.includes("assign q = cnt;"));
    assert.ok(v.includes("endmodule"));
  });
});
