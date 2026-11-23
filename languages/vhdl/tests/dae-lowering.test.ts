// SPDX-License-Identifier: AGPL-3.0-or-later

import { EqKind, VarType } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerVhdlToDae } from "../src/index.js";

function createMockDaeBuilder() {
  const variables: Array<{ name: string; type: number; variability: number; causality: number; startVal: number }> = [];
  const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];
  let nextExprId = 100;

  const builder: Record<string, unknown> = {
    addVariable: (name: string, type: number, variability: number, causality: number, startVal: number) => {
      variables.push({ name, type, variability, causality, startVal });
      return variables.length - 1;
    },
    addEquation: (kind: number, lhs: number, rhs: number) => {
      equations.push({ kind, lhs, rhs });
      return equations.length - 1;
    },
    addBinaryExpr: () => nextExprId++,
    addUnaryExpr: () => nextExprId++,
    addRealLiteral: () => nextExprId++,
    addIntLiteral: () => nextExprId++,
    addName: (varId: number) => 1000 + varId,
    addIfElse: () => nextExprId++,
    lookupVariable: (name: string) => variables.findIndex((v) => v.name === name),
  };

  return { builder: builder as unknown as Parameters<typeof lowerVhdlToDae>[0], variables, equations };
}

describe("@modelscript/vhdl — DAE Arena Lowering", () => {
  it("lowers clocked synchronous D-flip-flop with VarType.Clock and EqKind.When equations", () => {
    const src = `
library ieee;
use ieee.std_logic_1164.all;

entity dff is
  port (
    clk : in  std_logic;
    rst : in  std_logic;
    d   : in  std_logic;
    q   : out std_logic
  );
end entity dff;

architecture rtl of dff is
begin
  process(clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        q <= '0';
      else
        q <= d;
      end if;
    end if;
  end process;
end architecture rtl;
`;

    const { builder, variables, equations } = createMockDaeBuilder();
    const res = lowerVhdlToDae(builder, src);

    assert.equal(res.entityName, "dff");
    assert.equal(res.clockVarIndices.length, 1);
    assert.ok(res.registerVarIndices.length >= 1);
    assert.ok(res.equationCount >= 2);

    const clkVar = variables.find((v) => v.name === "clk");
    assert.ok(clkVar);
    assert.equal(clkVar.type, VarType.Clock);

    assert.ok(equations.some((e) => e.kind === EqKind.When));
  });

  it("lowers combinational conditional assignments into EqKind.Simple algebraic equations", () => {
    const src = `
entity mux2 is
  port (
    sel : in  std_logic;
    a   : in  std_logic;
    b   : in  std_logic;
    y   : out std_logic
  );
end entity mux2;

architecture rtl of mux2 is
begin
  y <= a when sel = '0' else b;
end architecture rtl;
`;

    const { builder, variables, equations } = createMockDaeBuilder();
    const res = lowerVhdlToDae(builder, src);

    assert.equal(res.entityName, "mux2");
    assert.equal(variables.length, 4);
    assert.equal(res.equationCount, 1);
    assert.equal(equations[0]!.kind, EqKind.Simple);
  });
});
