// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintVhdl } from "../src/index.js";

describe("@modelscript/vhdl — Static Analysis & Lints (VHDL1001–VHDL5006)", () => {
  it("reports zero errors on clean synthesizable VHDL", () => {
    const clean = `
library ieee;
use ieee.std_logic_1164.all;

entity and_gate is
  port (
    a : in  std_logic;
    b : in  std_logic;
    y : out std_logic
  );
end entity and_gate;

architecture rtl of and_gate is
begin
  y <= a and b;
end architecture rtl;
`;
    const diags = lintVhdl(clean);
    const errors = diags.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(errors)}`);
  });

  it("detects VHDL1001 syntax error and VHDL1002 mismatched entity/architecture end names", () => {
    const src = `
entity foo is
  port (a : in std_logic);
end entity bar;

architecture rtl of foo is
begin
end architecture wrong_arch;
`;
    const diags = lintVhdl(src);
    const mismatched = diags.filter((d) => d.id === "VHDL1002");
    assert.equal(mismatched.length, 2);

    const syntaxBad = `entity broken is port (`;
    const syntaxDiags = lintVhdl(syntaxBad);
    assert.ok(syntaxDiags.some((d) => d.id === "VHDL1001"));
  });

  it("detects VHDL2001 duplicate port/signal and VHDL2002 undefined signal", () => {
    const src = `
entity dup_test is
  port (
    a : in std_logic;
    a : out std_logic
  );
end entity dup_test;

architecture rtl of dup_test is
  signal s1 : std_logic;
  signal s1 : std_logic;
begin
  s1 <= ghost_sig;
end architecture rtl;
`;
    const diags = lintVhdl(src);
    assert.ok(diags.filter((d) => d.id === "VHDL2001").length >= 2);
    assert.ok(diags.some((d) => d.id === "VHDL2002" && d.message.includes("ghost_sig")));
  });

  it("detects VHDL3001 port direction violations (driving in port / reading out port)", () => {
    const src = `
entity dir_test is
  port (
    inp  : in  std_logic;
    outp : out std_logic
  );
end entity dir_test;

architecture rtl of dir_test is
  signal tmp : std_logic;
begin
  inp <= '1';
  tmp <= outp;
  outp <= tmp;
end architecture rtl;
`;
    const diags = lintVhdl(src);
    const violations = diags.filter((d) => d.id === "VHDL3001");
    assert.equal(violations.length, 2);
    assert.ok(violations.some((d) => d.message.includes("driven")));
    assert.ok(violations.some((d) => d.message.includes("read")));
  });

  it("detects VHDL3002 vector width mismatch in assignment", () => {
    const src = `
entity width_test is
  port (
    a : in  std_logic_vector(7 downto 0);
    y : out std_logic_vector(3 downto 0)
  );
end entity width_test;

architecture rtl of width_test is
begin
  y <= a;
end architecture rtl;
`;
    const diags = lintVhdl(src);
    assert.ok(diags.some((d) => d.id === "VHDL3002" && d.message.includes("4 bits") && d.message.includes("8 bits")));
  });

  it("detects VHDL4001 incomplete sensitivity list and VHDL4002 inferred latch", () => {
    const src = `
entity latch_test is
  port (
    en : in  std_logic;
    d  : in  std_logic;
    q  : out std_logic
  );
end entity latch_test;

architecture rtl of latch_test is
begin
  p_comb : process(en)
  begin
    if en = '1' then
      q <= d;
    end if;
  end process p_comb;
end architecture rtl;
`;
    const diags = lintVhdl(src);
    assert.ok(diags.some((d) => d.id === "VHDL4001" && d.message.includes("'d'")));
    assert.ok(diags.some((d) => d.id === "VHDL4002" && d.message.includes("'q'")));
  });

  it("detects VHDL5001 multiple concurrent drivers on unresolved std_ulogic signal", () => {
    const src = `
entity multi_drv is
  port (
    a : in  std_ulogic;
    b : in  std_ulogic;
    y : out std_ulogic
  );
end entity multi_drv;

architecture rtl of multi_drv is
begin
  y <= a;
  y <= b;
end architecture rtl;
`;
    const diags = lintVhdl(src);
    assert.ok(diags.some((d) => d.id === "VHDL5001" && d.message.includes("'y'")));
  });
});
