// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esterelToDae, lowerEsterelToDae } from "../src/dae/index.js";

const ABRO = `
module ABRO:
input A, B, R;
output O;
loop
  [ await A || await B ];
  emit O
each R
end module
`;

describe("Esterel Mealy FSM / Clocked DAE Lowering", () => {
  it("lowers ABRO into DAEBuilder with signals, control registers, and clocked equations", () => {
    const { builder, result } = esterelToDae(ABRO);
    assert.strictEqual(result.moduleName, "ABRO");
    assert.ok(result.variableMap.has("A"));
    assert.ok(result.variableMap.has("B"));
    assert.ok(result.variableMap.has("R"));
    assert.ok(result.variableMap.has("O"));
    assert.ok(result.controlRegisters.length >= 3, "Expected boot + loop_each + 2 await registers");
    assert.ok(result.equationCount >= 4, "Expected register transition + signal status equations");
    assert.ok(builder.varCount >= result.variableMap.size);
    assert.ok(builder.eqCount >= result.equationCount);
  });

  it("supports direct lowering into an existing DAEBuilder instance", () => {
    const src = `
      module Arbiter:
      input REQ1, REQ2;
      output GNT1, GNT2;
      loop
        present REQ1 then emit GNT1
        else present REQ2 then emit GNT2 end
        end;
        pause
      end
      end module
    `;
    const builder = new DAEBuilder(undefined, "ArbiterDAE");
    const res = lowerEsterelToDae(builder, src);
    assert.strictEqual(res.moduleName, "Arbiter");
    assert.ok(res.variableMap.has("GNT1"));
    assert.ok(res.variableMap.has("GNT2"));
    assert.ok(res.stateVarIndices.length >= 2);
    assert.ok(res.equationCount >= 3);
  });
});
