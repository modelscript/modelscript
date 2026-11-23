// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getVhdlCompletions, getVhdlDocumentSymbols, getVhdlHover, validateVhdl, vhdlIndexing } from "../src/index.js";

const SAMPLE_VHDL = `library ieee;
use ieee.std_logic_1164.all;

entity reg1 is
  port (
    clk : in  std_logic;
    d   : in  std_logic;
    q   : out std_logic
  );
end entity reg1;

architecture rtl of reg1 is
  signal state_q : std_logic;
begin
  p_reg : process(clk)
  begin
    if rising_edge(clk) then
      state_q <= d;
    end if;
  end process p_reg;
  q <= state_q;
end architecture rtl;
`;

describe("@modelscript/vhdl — Workspace Indexing & LSP Services", () => {
  it("validates VHDL via validateVhdl and surfaces LSP diagnostics on errors", () => {
    const cleanDiags = validateVhdl(SAMPLE_VHDL);
    assert.equal(cleanDiags.filter((d) => d.severity === 1).length, 0);

    const broken = SAMPLE_VHDL.replace("state_q <= d;", "d <= state_q;");
    const errDiags = validateVhdl(broken);
    assert.ok(errDiags.some((d) => d.code === "VHDL3001" && d.source === "modelscript-vhdl"));
  });

  it("extracts hierarchical document symbols (entity, ports, architecture, signals, processes)", () => {
    const symbols = getVhdlDocumentSymbols(SAMPLE_VHDL);
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0]!.name, "reg1");
    assert.equal(symbols[0]!.children?.length, 3);
    assert.equal(symbols[1]!.name, "rtl of reg1");
    assert.ok(symbols[1]!.children?.some((c) => c.name === "state_q"));
    assert.ok(symbols[1]!.children?.some((c) => c.name === "p_reg"));
  });

  it("provides hover documentation for local ports, IEEE stdlib types, and VHDL keywords", () => {
    // Hover over 'std_logic' on line 5 (`    clk : in  std_logic;`)
    const stdHover = getVhdlHover(SAMPLE_VHDL, { line: 5, character: 16 });
    assert.ok(stdHover && stdHover.contents.value.includes("IEEE.STD_LOGIC_1164.STD_LOGIC"));

    // Hover over 'clk' port on line 5
    const portHover = getVhdlHover(SAMPLE_VHDL, { line: 5, character: 5 });
    assert.ok(portHover && portHover.contents.value.includes("port") && portHover.contents.value.includes("clk"));

    // Hover over 'entity' keyword on line 3
    const kwHover = getVhdlHover(SAMPLE_VHDL, { line: 3, character: 2 });
    assert.ok(kwHover && kwHover.contents.value.includes("VHDL keyword"));
  });

  it("provides completions and UnifiedWorkspace indexing", () => {
    const completions = getVhdlCompletions(SAMPLE_VHDL);
    assert.ok(completions.some((c) => c.label === "state_q"));
    assert.ok(completions.some((c) => c.label === "std_logic"));
    assert.ok(completions.some((c) => c.label === "architecture"));

    assert.equal(vhdlIndexing.canIndex("top.vhd", ""), true);
    assert.equal(vhdlIndexing.canIndex("top.vhdl", ""), true);
    assert.equal(vhdlIndexing.canIndex("top.txt", SAMPLE_VHDL), true);
    assert.equal(vhdlIndexing.canIndex("top.txt", "hello world"), false);

    const added: string[] = [];
    let parsed: unknown;
    vhdlIndexing.indexFile({
      uri: "reg1.vhd",
      text: SAMPLE_VHDL,
      setParsedModel: (m) => {
        parsed = m;
      },
      addSymbol: (name) => {
        added.push(name);
        return added.length;
      },
    } as Parameters<typeof vhdlIndexing.indexFile>[0]);

    assert.ok(parsed);
    assert.ok(added.includes("reg1"));
    assert.ok(added.includes("clk"));
    assert.ok(added.includes("state_q"));
  });
});
