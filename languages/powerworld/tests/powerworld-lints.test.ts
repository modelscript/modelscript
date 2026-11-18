// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPowerWorldAux } from "../src/lints/index.js";
import { parsePowerWorldAux } from "../src/parser/powerworld-parser.js";

describe("PowerWorld AUX Semantic Linter", () => {
  it("reports zero diagnostics on a valid case", () => {
    const aux = `
DATA (Bus, [BusNum, BusName, BusNomVolt, BusSlack])
{
  1 "Bus1" 138.0 YES
  2 "Bus2" 138.0 NO
}
DATA (Branch, [BusNumFrom, BusNumTo, LineCircuit, LineR, LineX, LineAMVA])
{
  1 2 "1" 0.01 0.05 150.0
}
`;
    const diags = lintPowerWorldAux(parsePowerWorldAux(aux));
    assert.equal(diags.length, 0);
  });

  it("flags duplicate buses, unresolved refs, bad ratings, gen limits, and missing slack", () => {
    const aux = `
DATA (Bus, [BusNum, BusName, BusNomVolt, BusSlack])
{
  1 "Bus1" 138.0 NO
  1 "Bus1Dup" -10.0 NO
}
DATA (Gen, [BusNum, GenID, GenStatus, GenMW, GenMWMax, GenMWMin])
{
  99 "1" Closed 50.0 20.0 30.0
}
DATA (Branch, [BusNumFrom, BusNumTo, LineCircuit, LineR, LineX, LineAMVA])
{
  1 88 "1" 0.0 0.0 0.0
}
`;
    const diags = lintPowerWorldAux(parsePowerWorldAux(aux));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("PW2001"));
    assert.ok(codes.has("PW2002"));
    assert.ok(codes.has("PW3001"));
    assert.ok(codes.has("PW3002"));
    assert.ok(codes.has("PW4001"));
    assert.ok(codes.has("PW4002"));
  });
});
