// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esterelToLustre, esterelToModelica } from "../src/projections/index.js";

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

describe("Esterel Polyglot Projections (Modelica & Lustre)", () => {
  it("projects ABRO to a Modelica 3.3+ clocked synchronous state machine block", () => {
    const mo = esterelToModelica(ABRO, { samplePeriod: 0.02 });
    assert.ok(mo.includes("block ABRO"));
    assert.ok(mo.includes("Clock clk = Clock(samplePeriod);"));
    assert.ok(mo.includes("parameter Real samplePeriod = 0.02;"));
    assert.ok(mo.includes("input Boolean A;"));
    assert.ok(mo.includes("input Boolean B;"));
    assert.ok(mo.includes("input Boolean R;"));
    assert.ok(mo.includes("output Boolean O(start = false);"));
    assert.ok(mo.includes("previous("));
    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("end ABRO;"));
  });

  it("projects ABRO to a Lustre v6 synchronous dataflow node", () => {
    const lus = esterelToLustre(ABRO);
    assert.ok(lus.includes("node ABRO(A: bool; B: bool; R: bool) returns (O: bool);"));
    assert.ok(lus.includes("var"));
    assert.ok(lus.includes("let"));
    assert.ok(lus.includes("->"));
    assert.ok(lus.includes("pre("));
    assert.ok(lus.includes("O ="));
    assert.ok(lus.includes("tel"));
  });
});
