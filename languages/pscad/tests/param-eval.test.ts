// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evalParamExpr } from "../src/netlist/param-eval.js";

describe("PSCAD parameter evaluation", () => {
  it("parses units with SI prefixes", () => {
    const s = new Map<string, number>();
    assert.equal(evalParamExpr("1.0 [uF]", s), 1e-6);
    assert.equal(evalParamExpr("0.05 [s]", s), 0.05);
    assert.equal(evalParamExpr("100 [MVAR]", s), 1e8);
    assert.equal(evalParamExpr("2.5 [kV]", s), 2500);
    assert.equal(evalParamExpr("30 [deg]", s), 30);
  });
  it("resolves identifiers and arithmetic", () => {
    const s = new Map([
      ["Vb", 10],
      ["k", 2],
    ]);
    assert.equal(evalParamExpr("Vb*k+1", s), 21);
    assert.equal(evalParamExpr("(Vb-4)/k", s), 3);
    assert.equal(evalParamExpr("1E+6", s), 1e6);
  });
  it("returns undefined for unresolved names", () => {
    assert.equal(evalParamExpr("mystery*2", new Map()), undefined);
  });
});
