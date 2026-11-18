// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPypsaNetwork } from "../src/lints/index.js";
import { parsePypsa } from "../src/parser/pypsa-parser.js";

describe("PyPSA Semantic Linter", () => {
  it("flags duplicate buses, unresolved refs, negative p_nom, zero impedance, and bad efficiencies", () => {
    const bad = parsePypsa(`
bus B1 v_nom=380
bus B1 v_nom=-10
generator G1 bus=Missing p_nom=-50
line L1 bus0=B1 bus1=Missing r=0 x=0
storage_unit S1 bus=B1 p_nom=10 efficiency_store=1.5
`);
    const codes = new Set(lintPypsaNetwork(bad).map((d) => d.code));
    assert.ok(codes.has("PYPSA2001"));
    assert.ok(codes.has("PYPSA2002"));
    assert.ok(codes.has("PYPSA3001"));
    assert.ok(codes.has("PYPSA3002"));
    assert.ok(codes.has("PYPSA3003"));
    assert.ok(codes.has("PYPSA3004"));
  });
});
