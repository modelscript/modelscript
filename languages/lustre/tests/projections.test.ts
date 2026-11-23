// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lustreToModelica, parseLustre } from "../src/index.js";

describe("@modelscript/lustre — Modelica 3.3+ Synchronous Clocks Projection", () => {
  it("projects Lustre nodes with ->, pre, when, current, and assert to Modelica 3.3+ clocked models", () => {
    const src = `
const DT: real = 0.01;

node Controller(u: real; enable: bool) returns (y: real);
var
  acc: real;
let
  acc = 0.0 -> (pre(acc) + DT * u);
  y = if enable then acc else current(acc when enable);
  assert y >= -1000.0;
tel
`;
    const prog = parseLustre(src);
    const mo = lustreToModelica(prog, { samplePeriod: 0.01, packageName: "LustreExport" });

    assert.ok(mo.includes("package LustreExport"));
    assert.ok(mo.includes("constant Real DT = 0.01;"));
    assert.ok(mo.includes("model Controller"));
    assert.ok(mo.includes("Clock clk = Clock(Ts);"));
    assert.ok(mo.includes("sample(u, clk)"));
    assert.ok(mo.includes("previous(acc)"));
    assert.ok(mo.includes("firstTick()"));
    assert.ok(mo.includes("hold(y)"));
    assert.ok(mo.includes("assert("));
    assert.ok(mo.includes("end Controller;"));
    assert.ok(mo.includes("end LustreExport;"));
  });
});
