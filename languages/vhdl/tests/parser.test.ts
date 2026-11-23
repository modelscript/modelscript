// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVhdl, tokenizeVhdl } from "../src/index.js";

describe("@modelscript/vhdl — Lexer & Recursive-Descent Parser", () => {
  it("tokenizes VHDL-87/93 syntax including comments, bit strings, char literals, and attributes", () => {
    const src = `-- VHDL header comment
library ieee;
use ieee.std_logic_1164.all;
-- edge check: clk'event and clk = '1'
signal bus_a : std_logic_vector(7 downto 0) := X"A5";`;

    const tokens = tokenizeVhdl(src);
    assert.ok(tokens.some((t) => t.lower === "library"));
    assert.ok(tokens.some((t) => t.kind === "bitString" && t.value === 'X"A5"'));
    assert.ok(tokens.some((t) => t.kind === "symbol" && t.value === ":="));
  });

  it("parses entity, generics, ports, architecture, signals, constants, types, components, and processes", () => {
    const src = `
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

package my_pkg is
  constant WIDTH : integer := 4;
  type state_t is (IDLE, RUN, DONE);
end package my_pkg;

package body my_pkg is
  constant INTERNAL_C : integer := 1;
end package body my_pkg;

entity demo_unit is
  generic (
    N : integer := 4
  );
  port (
    clk   : in  std_logic;
    rst   : in  std_logic;
    sel   : in  std_logic_vector(1 downto 0);
    a, b  : in  std_logic_vector(3 downto 0);
    y     : out std_logic_vector(3 downto 0)
  );
end entity demo_unit;

architecture rtl of demo_unit is
  signal mux_out : std_logic_vector(3 downto 0);
  signal tmp_s   : std_logic;

  component inv_gate is
    port (
      i : in  std_logic;
      o : out std_logic
    );
  end component inv_gate;
begin
  -- Conditional concurrent assignment (when ... else)
  mux_out <= a when sel = "00" else b;

  -- Selected concurrent assignment (with ... select)
  with sel select
    tmp_s <= '0' when "00",
             '1' when others;

  -- Component instantiation with port map
  u_inv : inv_gate port map (i => rst, o => tmp_s);

  -- Clocked process with variable, if/elsif/else, case, and for loop
  p_main : process(clk, rst)
    variable acc : std_logic_vector(3 downto 0);
  begin
    if rst = '1' then
      y <= (others => '0');
    elsif rising_edge(clk) then
      acc := mux_out;
      case sel is
        when "00" =>
          y <= acc;
        when "01" | "10" =>
          for k in 0 to 3 loop
            y(k) <= acc(k);
          end loop;
        when others =>
          null;
      end case;
    end if;
  end process p_main;
end architecture rtl;
`;

    const design = parseVhdl(src);
    assert.equal(design.parseErrors.length, 0, `Unexpected parse errors: ${JSON.stringify(design.parseErrors)}`);
    assert.equal(design.libraries.length, 1);
    assert.equal(design.uses.length, 2);
    assert.equal(design.packages.length, 1);
    assert.equal(design.packageBodies.length, 1);
    assert.equal(design.entities.length, 1);
    assert.equal(design.architectures.length, 1);

    const ent = design.entities[0]!;
    assert.equal(ent.name, "demo_unit");
    assert.equal(ent.generics.length, 1);
    assert.equal(ent.ports.length, 6);
    assert.equal(ent.ports[3]!.type.width, 4);

    const arch = design.architectures[0]!;
    assert.equal(arch.name, "rtl");
    assert.equal(arch.entityName, "demo_unit");
    assert.equal(arch.signals.length, 2);
    assert.equal(arch.components.length, 1);
    assert.equal(arch.statements.length, 4);
    assert.equal(arch.statements[0]!.kind, "condSignalAssign");
    assert.equal(arch.statements[1]!.kind, "selectedSignalAssign");
    assert.equal(arch.statements[2]!.kind, "componentInst");
    assert.equal(arch.statements[3]!.kind, "process");
  });
});
