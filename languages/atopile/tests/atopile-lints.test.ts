// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintAtopile } from "../src/lints/index.js";
import { parseAtopile } from "../src/parser/atopile-parser.js";

describe("@modelscript/atopile — Static & Tolerance Constraint Linter", () => {
  it("catches duplicate instances (A2001), unresolved types (A2002), and worst-case tolerance violations (A3001)", () => {
    const file = parseAtopile(`
module BadDesign:
    r1 = new Resistor
    r1 = new Resistor
    u1 = new UnknownIC

    r1.resistance = 10kohm +/- 5%
    assert r1.resistance within 9.8kohm to 10.2kohm
`);
    const diags = lintAtopile(file);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has("A2001"), "Expected A2001 duplicate instance");
    assert(codes.has("A2002"), "Expected A2002 unresolved type");
    assert(codes.has("A3001"), "Expected A3001 worst-case tolerance violation (9.5k..10.5k exceeds 9.8k..10.2k)");
  });

  it("passes when worst-case tolerance range satisfies assert bounds", () => {
    const file = parseAtopile(`
module GoodDesign:
    r1 = new Resistor
    r1.resistance = 10kohm +/- 1%
    assert r1.resistance within 9.8kohm to 10.2kohm
`);
    const diags = lintAtopile(file);
    assert.strictEqual(diags.length, 0);
  });
});
